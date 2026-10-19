// Bump the version in src/manifest.json and package.json, commit, and tag.
// Usage: pnpm release <x.y.z>
// Pushing the tag (`git push --follow-tags`) starts the release workflow.

import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage: pnpm release <x.y.z>");
  process.exit(1);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

if (git("status", "--porcelain")) {
  console.error("Working tree is not clean — commit or stash first.");
  process.exit(1);
}
const tag = `v${version}`;
if (git("tag", "--list", tag)) {
  console.error(`Tag ${tag} already exists.`);
  process.exit(1);
}

// Replace only the "version" value so the files keep their formatting.
async function bump(file) {
  const text = await readFile(file, "utf8");
  const re = /^(\s*"version":\s*")[^"]*(")/m;
  if (!re.test(text)) throw new Error(`No "version" in ${file}`);
  await writeFile(file, text.replace(re, `$1${version}$2`));
}

const files = ["src/manifest.json", "package.json"];
for (const f of files) await bump(f);

git("add", ...files);
git("commit", "-m", `Release ${tag}`);
git("tag", "-a", tag, "-m", tag);

console.log(`Tagged ${tag}. Push it to start the release:\n  git push --follow-tags`);
