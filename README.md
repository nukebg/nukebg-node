# nukebg

Official Node.js client for the [NukeBG](https://nukebg.com) background removal API: transparent cutouts, white and marketplace-ready backgrounds, object removal, upscaling, batches, video jobs and webhooks. Zero dependencies, Node 18+, works with both `import` and `require`.

Also a **drop-in replacement for the `remove.bg` package**. remove.bg's self-serve API closes on 1 December 2026; change one import and keep your code.

```bash
npm install nukebg
```

Create an API key at [nukebg.com/account](https://nukebg.com/account). New accounts get 50 free credits plus 20 a month, and one standard cutout is one credit.

## Remove a background

```js
import { writeFile } from "node:fs/promises";
import { NukeBG } from "nukebg";

const nukebg = new NukeBG({ apiKey: process.env.NUKEBG_API_KEY });

// A file path, an https URL, a Buffer or a Blob
const result = await nukebg.removeBackground("product.jpg");
await writeFile("product.png", result.data);

console.log(result.width, result.height, result.creditsRemaining);
```

### On white, at Amazon size

```js
const listing = await nukebg.removeBackground("https://example.com/shoe.jpg", {
  background: "white", // or "#F4F4F4", "gradient:#fff,#eee", "scene:marble"
  size: "amazon",      // original | amazon | shopify | etsy | ebay | instagram | story
  shadow: "soft",
  format: "jpg",
});
```

All options: `quality` (`preview` | `standard` | `hd` | `ultra`), `background`, `size`, `width`, `height`, `padding`, `crop`, `shadow`, `subject` (`all` | `main`), `despill`, `format`, `jpegQuality`, `channels` (`rgba` | `alpha`), `idempotencyKey`.

## Switching from remove.bg

```diff
- import { removeBackgroundFromImageFile } from "remove.bg";
+ import { removeBackgroundFromImageFile } from "nukebg/removebg";

  const result = await removeBackgroundFromImageFile({
    path: "photo.jpg",
-   apiKey: process.env.REMOVEBG_API_KEY,
+   apiKey: process.env.NUKEBG_API_KEY,
    size: "auto",
    outputFile: "photo-no-bg.png",
  });
```

`removeBackgroundFromImageUrl`, `removeBackgroundFromImageFile` and `removeBackgroundFromImageBase64` take remove.bg's options and return its result shape (`base64img`, `resultWidth`, `resultHeight`, `creditsCharged`, `foreground*`). Errors are thrown as an array of `{ code, title }`, as before. See the [migration guide](https://nukebg.com/migrate-from-remove-bg).

## Other tools

```js
// Remove objects by description (or pass a mask: white = remove)
const clean = await nukebg.erase("desk.jpg", { prompt: "the cables on the desk" });

// Upscale 2× or 4× (paid credits)
const big = await nukebg.upscale("small.jpg", { scale: 4 });

// Balance
const { credits, balance } = await nukebg.account();
```

## Batches, video and webhooks

```js
// Up to 500 images with the same settings
const batch = await nukebg.createBatch({
  tool: "cutout",
  items: urls.map((image_url) => ({ image_url })),
  params: { background: "white", size: "shopify" },
  webhookUrl: "https://example.com/hooks/nukebg",
});
const status = await nukebg.getBatch(batch.batch_id);
const zip = await nukebg.batchZip(batch.batch_id);

// Video background removal (upload large files first)
const { file_id } = await nukebg.upload("clip.mp4");
const job = await nukebg.createJob({ tool: "video", input: { file_id }, params: { format: "webm" } });
const done = await nukebg.waitForJob(job.id);
console.log(done.result?.url);

// Verify a webhook (use the raw body)
const ok = NukeBG.verifyWebhook(rawBody, req.headers["x-nukebg-signature"], webhookSecret);
```

## Errors and retries

Failed calls throw `NukeBGError` with `status`, `code` (for example `insufficient_credits`, `invalid_api_key`, `no_subject`) and `requestId`. Rate limits (429) and temporary engine errors (5xx) are retried twice, honouring `Retry-After`. Every POST sends an idempotency key, so a retry is never charged twice. Failed jobs are never charged.

## Links

- [API reference](https://nukebg.com/docs)
- [MCP server](https://nukebg.com/mcp-server) for Claude, Cursor, VS Code and other AI assistants
- [Pricing](https://nukebg.com/pricing)

MIT licensed. NukeBG is a product of VOLODS LTD. Not affiliated with remove.bg.
