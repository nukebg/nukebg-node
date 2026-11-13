/**
 * Drop-in replacement for the `remove.bg` npm package: same function names, options and result shape,
 * backed by NukeBG's remove.bg-compatible endpoint (POST https://api.nukebg.com/v1.0/removebg).
 *
 *   - import { removeBackgroundFromImageFile } from "remove.bg";
 *   + import { removeBackgroundFromImageFile } from "nukebg/removebg";
 *
 * Use a NukeBG API key as apiKey. Errors are thrown as an array of { code, title, detail? }, like remove.bg.
 */
import { readFile, writeFile } from "node:fs/promises";
import { DEFAULT_BASE_URL, VERSION } from "./index.js";

export interface RemoveBgOptions {
  /** Your NukeBG API key (defaults to process.env.NUKEBG_API_KEY). */
  apiKey?: string;
  size?: "preview" | "small" | "regular" | "medium" | "hd" | "full" | "4k" | "auto" | "50mp";
  type?: string;
  type_level?: string;
  format?: "auto" | "png" | "jpg" | "webp" | "zip";
  roi?: string;
  crop?: boolean;
  crop_margin?: string;
  scale?: string;
  position?: string;
  channels?: "rgba" | "alpha";
  add_shadow?: boolean;
  semitransparency?: boolean;
  bg_color?: string;
  bg_image_url?: string;
  /** Also write the result to this path. */
  outputFile?: string;
  /** Override the API host (default https://api.nukebg.com). */
  baseUrl?: string;
}
export interface RemoveBgUrlOptions extends RemoveBgOptions {
  url: string;
}
export interface RemoveBgFileOptions extends RemoveBgOptions {
  path: string;
}
export interface RemoveBgBase64Options extends RemoveBgOptions {
  base64img: string;
}
export interface RemoveBgResult {
  base64img: string;
  resultWidth: number;
  resultHeight: number;
  creditsCharged: number;
  detectedType: string;
  foregroundTop?: number;
  foregroundLeft?: number;
  foregroundWidth?: number;
  foregroundHeight?: number;
}
export interface RemoveBgError {
  code: string;
  title: string;
  detail?: string;
}

const PASS = ["size", "type", "type_level", "format", "roi", "crop", "crop_margin", "scale", "position", "channels", "add_shadow", "semitransparency", "bg_color", "bg_image_url"] as const;

export function removeBackgroundFromImageUrl(options: RemoveBgUrlOptions): Promise<RemoveBgResult> {
  return call(options, { image_url: options.url });
}

export async function removeBackgroundFromImageFile(options: RemoveBgFileOptions): Promise<RemoveBgResult> {
  return call(options, { image_file_b64: (await readFile(options.path)).toString("base64") });
}

export function removeBackgroundFromImageBase64(options: RemoveBgBase64Options): Promise<RemoveBgResult> {
  return call(options, { image_file_b64: options.base64img });
}

async function call(options: RemoveBgOptions, image: Record<string, string>): Promise<RemoveBgResult> {
  const apiKey = options.apiKey ?? process.env.NUKEBG_API_KEY;
  if (!apiKey) throw [{ code: "auth_failed", title: "Missing API key. Create one at https://nukebg.com/account." }] satisfies RemoveBgError[];
  const body: Record<string, unknown> = { ...image };
  for (const k of PASS) if (options[k] !== undefined) body[k] = options[k];

  const res = await fetch(`${(options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "")}/v1.0/removebg`, {
    method: "POST",
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json", Accept: "application/json", "User-Agent": `nukebg-node/${VERSION} (removebg-compat)` },
    body: JSON.stringify(body),
  }).catch((e: Error) => {
    throw [{ code: "network_error", title: e.message }] satisfies RemoveBgError[];
  });
  const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; errors?: RemoveBgError[] };
  if (!res.ok) throw json.errors ?? ([{ code: String(res.status), title: res.statusText || "Request failed" }] satisfies RemoveBgError[]);

  const d = json.data ?? {};
  const result: RemoveBgResult = {
    base64img: String(d.result_b64 ?? ""),
    resultWidth: Number(res.headers.get("x-width")),
    resultHeight: Number(res.headers.get("x-height")),
    creditsCharged: Number(res.headers.get("x-credits-charged") ?? 0),
    detectedType: res.headers.get("x-type") ?? "product",
    foregroundTop: num(d.foreground_top),
    foregroundLeft: num(d.foreground_left),
    foregroundWidth: num(d.foreground_width),
    foregroundHeight: num(d.foreground_height),
  };
  if (options.outputFile) await writeFile(options.outputFile, Buffer.from(result.base64img, "base64"));
  return result;
}

const num = (v: unknown) => (v == null ? undefined : Number(v));
