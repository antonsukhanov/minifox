// Shared options for `web-ext` (lint, build, run, sign). Only src/ is packaged.
export default {
  sourceDir: "src",
  artifactsDir: "web-ext-artifacts",
  build: {
    overwriteDest: true,
  },
  lint: {
    selfHosted: true,
  },
};
