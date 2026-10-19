// Render the PNG icons in src/icons/ from the SVG sources in assets/icons/.
// Run `npm run icons` after editing an SVG and commit the PNGs.

import { readFile, writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

const ICONS = [
  { src: "assets/icons/icon.svg", out: "src/icons/icon-{size}.png", sizes: [48, 96] },
  { src: "assets/icons/page-action.svg", out: "src/icons/page-action-{size}.png", sizes: [16, 32] },
];

for (const { src, out, sizes } of ICONS) {
  const svg = await readFile(src);
  for (const size of sizes) {
    const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
    const file = out.replace("{size}", size);
    await writeFile(file, png);
    console.log(`${file} (${size}×${size})`);
  }
}
