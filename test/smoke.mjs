// Smoke test against a running NukeBG (local or production). Uses real credits on production.
//   npm run build && NUKEBG_API_KEY=... NUKEBG_BASE_URL=http://localhost:3000 node test/smoke.mjs
import { createHmac } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { NukeBG, NukeBGError } from "../dist/esm/index.js";
import { removeBackgroundFromImageUrl } from "../dist/esm/removebg.js";

const SAMPLE = process.env.SAMPLE_URL ?? "https://nukebg.com/samples/shoe.jpg";
const client = new NukeBG();
let failed = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? ` ${extra}` : ""}`);
  if (!cond) failed++;
};

const before = await client.account();
check("account()", typeof before.credits === "number", `${before.credits} credits`);

const cut = await client.removeBackground(SAMPLE, { background: "white", size: "amazon", format: "jpg" });
check("removeBackground(url)", cut.data.length > 1000 && cut.width > 0 && cut.creditsCharged === 1, `${cut.width}x${cut.height} ${cut.mime}, ${cut.creditsCharged} credit`);
await writeFile("test/out-cutout.jpg", cut.data);

const sample = Buffer.from(await (await fetch(SAMPLE)).arrayBuffer());
const fromBytes = await client.removeBackground(sample, { quality: "preview" });
check("removeBackground(bytes)", fromBytes.mime === "image/png" && fromBytes.foreground !== undefined, `${fromBytes.width}x${fromBytes.height}`);

const rb = await removeBackgroundFromImageUrl({ url: SAMPLE, size: "preview", baseUrl: client.baseUrl, outputFile: "test/out-removebg.png" });
check("removebg shim", rb.base64img.length > 1000 && rb.resultWidth > 0, `${rb.resultWidth}x${rb.resultHeight}, charged ${rb.creditsCharged}`);

try {
  await client.removeBackground(SAMPLE, { size: /** @type {any} */ ("nope") });
  check("errors throw NukeBGError", false);
} catch (e) {
  check("errors throw NukeBGError", e instanceof NukeBGError && e.code === "invalid_size", `${e.status} ${e.code}`);
}

const secret = before.webhook_secret;
const body = JSON.stringify({ type: "job.succeeded", data: { id: "job_x" } });
const t = Math.floor(Date.now() / 1000);
const sig = `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
check("verifyWebhook(valid)", NukeBG.verifyWebhook(body, sig, secret));
check("verifyWebhook(tampered)", !NukeBG.verifyWebhook(body + " ", sig, secret));

console.log(failed ? `\n${failed} failed` : "\nAll passed");
process.exit(failed ? 1 : 0);
