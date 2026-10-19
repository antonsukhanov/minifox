// Add a release to updates.json — the update manifest that installed copies
// poll via browser_specific_settings.gecko.update_url.
// Usage: node scripts/updates-json.mjs <x.y.z> <signed.xpi> <download url>

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const [version, xpi, link] = process.argv.slice(2);
if (!version || !xpi || !link) {
  console.error("Usage: node scripts/updates-json.mjs <x.y.z> <signed.xpi> <download url>");
  process.exit(1);
}

const manifest = JSON.parse(await readFile("src/manifest.json", "utf8"));
const id = manifest.browser_specific_settings.gecko.id;
const hash = createHash("sha256").update(await readFile(xpi)).digest("hex");

const file = "updates.json";
const data = JSON.parse(await readFile(file, "utf8"));
const addon = (data.addons[id] ??= { updates: [] });
addon.updates = addon.updates.filter((u) => u.version !== version);
addon.updates.push({ version, update_link: link, update_hash: `sha256:${hash}` });

await writeFile(file, JSON.stringify(data, null, 2) + "\n");
console.log(`${file}: ${id} ${version} sha256:${hash}`);
