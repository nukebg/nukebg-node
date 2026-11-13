/**
 * Official Node.js client for the NukeBG API (https://nukebg.com/docs).
 * Zero dependencies; needs Node 18+ (global fetch, FormData and Blob).
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

export const DEFAULT_BASE_URL = "https://api.nukebg.com";
export const VERSION = "1.0.0";

/** A file path, an http(s) URL, raw bytes or a Blob. */
export type ImageInput = string | Uint8Array | ArrayBuffer | Blob;

export type SizePreset = "original" | "amazon" | "shopify" | "etsy" | "ebay" | "instagram" | "story";
export type Format = "png" | "webp" | "jpg";

export interface RemoveBackgroundOptions {
  /** preview 0.25 MP · standard 4 MP (default) · hd 25 MP · ultra 50 MP. */
  quality?: "preview" | "standard" | "hd" | "ultra";
  /** transparent (default), white, "#RRGGBB", "gradient:#a,#b", "scene:<id>" or "url:https://…". */
  background?: string;
  size?: SizePreset;
  width?: number;
  height?: number;
  /** Padding around the subject, 0–45 (% of the shorter side). */
  padding?: number;
  crop?: boolean;
  shadow?: "none" | "soft" | "contact";
  /** "main" drops small stray objects. */
  subject?: "all" | "main";
  despill?: boolean;
  format?: Format;
  jpegQuality?: number;
  /** "alpha" returns a greyscale mask instead of the cutout. */
  channels?: "rgba" | "alpha";
  idempotencyKey?: string;
}

export interface EraseOptions {
  /** What to remove, in plain words. */
  prompt?: string;
  /** PNG/JPG mask, white = remove. */
  mask?: ImageInput;
  quality?: "fast" | "enhance";
  format?: Format;
  idempotencyKey?: string;
}

export interface UpscaleOptions {
  scale?: 2 | 4;
  format?: Format;
  idempotencyKey?: string;
}

export interface ImageResult {
  data: Buffer;
  mime: string;
  width: number;
  height: number;
  /** Subject bounding box in the result (cutouts only). */
  foreground?: { left: number; top: number; width: number; height: number };
  creditsCharged: number;
  creditsRemaining: number | null;
  requestId: string | null;
}

export interface Account {
  account: string;
  credits: number;
  balance: { free: number; subscription: number; paid: number };
  plan: string;
  webhook_secret: string;
}

export type JobTool = "cutout" | "erase" | "upscale" | "video" | "video-clean";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface Job {
  id: string;
  tool: JobTool;
  status: JobStatus;
  progress: number;
  batch_id: string | null;
  credits_held: number;
  credits_charged: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: { code: string; message: string } | null;
  result: { url: string; mime: string; bytes: number; width: number | null; height: number | null; seconds: number | null; [k: string]: unknown } | null;
}

export interface JobInput {
  file_id?: string;
  image_url?: string;
}

export interface Batch {
  batch_id: string;
  status: "processing" | "completed";
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  queued: number;
  credits_charged: number;
  zip_url: string | null;
  jobs: Job[];
}

export class NukeBGError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = "NukeBGError";
  }
}

export interface NukeBGOptions {
  /** Defaults to process.env.NUKEBG_API_KEY. */
  apiKey?: string;
  baseUrl?: string;
  /** Retries for 429 and 5xx responses (with Retry-After). Default 2. */
  maxRetries?: number;
  /** Per-request timeout in ms. Default 120 000. */
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class NukeBG {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(opts: NukeBGOptions = {}) {
    const key = opts.apiKey ?? process.env.NUKEBG_API_KEY;
    if (!key) throw new Error("NukeBG: pass { apiKey } or set NUKEBG_API_KEY. Create a key at https://nukebg.com/account.");
    this.apiKey = key;
    this.baseUrl = (opts.baseUrl ?? process.env.NUKEBG_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.maxRetries = opts.maxRetries ?? 2;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  /** Remove the background. Returns the image bytes plus size, subject box and credits. */
  async removeBackground(image: ImageInput, opts: RemoveBackgroundOptions = {}): Promise<ImageResult> {
    const form = await imageForm(image);
    setFields(form, {
      quality: opts.quality,
      background: opts.background,
      size: opts.size,
      width: opts.width,
      height: opts.height,
      padding: opts.padding,
      crop: opts.crop,
      shadow: opts.shadow,
      subject: opts.subject,
      despill: opts.despill,
      format: opts.format,
      jpeg_quality: opts.jpegQuality,
      channels: opts.channels,
    });
    return this.imageCall("/v1/cutouts", form, opts.idempotencyKey);
  }

  /** Remove objects by prompt and/or mask. Pixels outside the edit are returned unchanged. */
  async erase(image: ImageInput, opts: EraseOptions): Promise<ImageResult> {
    if (!opts.prompt && !opts.mask) throw new Error("NukeBG.erase: pass a prompt, a mask, or both.");
    const form = await imageForm(image);
    if (opts.mask) form.append("mask_file", await toBlob(opts.mask), "mask.png");
    setFields(form, { prompt: opts.prompt, quality: opts.quality, format: opts.format });
    return this.imageCall("/v1/erase", form, opts.idempotencyKey);
  }

  /** Upscale 2× (source up to 16 MP) or 4× (source up to 4 MP). Needs paid credits. */
  async upscale(image: ImageInput, opts: UpscaleOptions = {}): Promise<ImageResult> {
    const form = await imageForm(image);
    setFields(form, { scale: opts.scale, format: opts.format });
    return this.imageCall("/v1/upscale", form, opts.idempotencyKey);
  }

  /** Credit balance and plan for this key. */
  account(): Promise<Account> {
    return this.json<Account>("GET", "/v1/account");
  }

  /** Upload a large file straight to storage; pass the returned file_id to createJob or createBatch. */
  async upload(file: ImageInput, contentType?: string): Promise<{ file_id: string }> {
    const blob = await toBlob(file);
    const type = contentType ?? (blob.type || guessType(typeof file === "string" ? file : ""));
    const slot = await this.json<{ file_id: string; upload_url: string; headers: Record<string, string> }>("POST", "/v1/uploads", { content_type: type, size: blob.size });
    const put = await fetch(slot.upload_url, { method: "PUT", headers: slot.headers, body: blob });
    if (!put.ok) throw new NukeBGError(`Upload failed (${put.status}).`, put.status, "upload_failed");
    return { file_id: slot.file_id };
  }

  /** Start a background job (video, or any image tool). Credits are held now and charged on success. */
  createJob(job: { tool: JobTool; input: JobInput; params?: Record<string, unknown>; webhookUrl?: string; idempotencyKey?: string }): Promise<Job> {
    return this.json<Job>("POST", "/v1/jobs", { tool: job.tool, input: job.input, params: job.params, webhook_url: job.webhookUrl }, job.idempotencyKey ?? randomUUID());
  }

  getJob(id: string): Promise<Job> {
    return this.json<Job>("GET", `/v1/jobs/${encodeURIComponent(id)}`);
  }

  cancelJob(id: string): Promise<Job> {
    return this.json<Job>("DELETE", `/v1/jobs/${encodeURIComponent(id)}`);
  }

  /** Poll until the job succeeds, fails or is cancelled. */
  async waitForJob(id: string, { intervalMs = 2000, timeoutMs = 15 * 60_000 } = {}): Promise<Job> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const job = await this.getJob(id);
      if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") return job;
      if (Date.now() > until) throw new NukeBGError(`Job ${id} is still ${job.status} after ${timeoutMs} ms.`, 408, "timeout");
      await sleep(intervalMs);
    }
  }

  /** Up to 500 cutout or upscale items with the same params. */
  createBatch(batch: { tool: "cutout" | "upscale"; items: JobInput[]; params?: Record<string, unknown>; webhookUrl?: string }): Promise<{ batch_id: string; queued: number; rejected: { index: number; error: { code: string; message: string } }[]; jobs: Job[] }> {
    return this.json("POST", "/v1/batches", { tool: batch.tool, items: batch.items, params: batch.params, webhook_url: batch.webhookUrl });
  }

  getBatch(id: string): Promise<Batch> {
    return this.json<Batch>("GET", `/v1/batches/${encodeURIComponent(id)}`);
  }

  /** Every successful result of a finished batch as one ZIP. */
  async batchZip(id: string): Promise<Buffer> {
    const res = await this.request("GET", `/v1/batches/${encodeURIComponent(id)}/zip`);
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * Check a webhook's X-NukeBG-Signature ("t=<unix>,v1=<hex>"): HMAC-SHA256 of "t.body" with the
   * webhook_secret from account(). Pass the raw request body, not re-serialised JSON.
   */
  static verifyWebhook(rawBody: string | Buffer, signatureHeader: string | null | undefined, secret: string, toleranceSeconds = 300): boolean {
    if (!signatureHeader) return false;
    const parts = Object.fromEntries(signatureHeader.split(",").map((p) => p.trim().split("=") as [string, string]));
    const t = Number(parts.t);
    if (!parts.v1 || !Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
    const want = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody.toString()}`).digest("hex"));
    const got = Buffer.from(parts.v1);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  // ---------- internals ----------

  private async imageCall(path: string, form: FormData, idempotencyKey?: string): Promise<ImageResult> {
    const res = await this.request("POST", path, form, idempotencyKey ?? randomUUID());
    const h = (k: string) => res.headers.get(k);
    const fg = h("x-foreground")?.split(",").map(Number);
    const remaining = Number(h("x-credits-remaining"));
    return {
      data: Buffer.from(await res.arrayBuffer()),
      mime: h("content-type") ?? "image/png",
      width: Number(h("x-width")),
      height: Number(h("x-height")),
      foreground: fg?.length === 4 ? { left: fg[0], top: fg[1], width: fg[2], height: fg[3] } : undefined,
      creditsCharged: Number(h("x-credits-charged") ?? 0),
      creditsRemaining: Number.isFinite(remaining) ? remaining : null,
      requestId: h("x-request-id"),
    };
  }

  private async json<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const res = await this.request(method, path, body === undefined ? undefined : JSON.stringify(body), idempotencyKey);
    return (await res.json()) as T;
  }

  private async request(method: string, path: string, body?: FormData | string, idempotencyKey?: string): Promise<Response> {
    const headers: Record<string, string> = { "X-Api-Key": this.apiKey, "User-Agent": `nukebg-node/${VERSION}` };
    if (typeof body === "string") headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${this.baseUrl}${path}`, { method, headers, body, signal: AbortSignal.timeout(this.timeoutMs) });
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < this.maxRetries) {
        const after = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 500 * 2 ** attempt);
        continue;
      }
      const j = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string; request_id?: string } };
      throw new NukeBGError(j.error?.message ?? `HTTP ${res.status}`, res.status, j.error?.code ?? "http_error", j.error?.request_id ?? res.headers.get("x-request-id"));
    }
  }
}

async function imageForm(image: ImageInput): Promise<FormData> {
  const form = new FormData();
  if (typeof image === "string" && /^https?:\/\//i.test(image)) form.append("image_url", image);
  else form.append("image_file", await toBlob(image), typeof image === "string" ? image.split(/[\\/]/).pop() : "image");
  return form;
}

async function toBlob(input: ImageInput): Promise<Blob> {
  if (input instanceof Blob) return input;
  if (typeof input === "string") return new Blob([new Uint8Array(await readFile(input))], { type: guessType(input) });
  return new Blob([input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input)]);
}

function guessType(name: string): string {
  const ext = name.toLowerCase().split(".").pop();
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" } as Record<string, string>)[ext ?? ""] ?? "application/octet-stream";
}

function setFields(form: FormData, fields: Record<string, string | number | boolean | undefined>) {
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) form.append(k, String(v));
}

export default NukeBG;
