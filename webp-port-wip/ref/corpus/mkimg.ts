// Turns real images of the repo into lossless WebP files (made by released Bun = libwebp) that the harness reads as pixel sources.
import { basename } from "node:path";
const root = "/root/repos/oven-sh/bun/";
const srcs = [
  "docs/images/cat.jpg", "test/js/node/test/fixtures/person.jpg", "test/js/node/test/fixtures/person-large.jpg",
  "docs/images/buntest.jpeg", "test/integration/sharp/bun.png", "test/integration/expo-app/assets/images/react-logo.png",
  "test/integration/expo-app/assets/images/adaptive-icon.png", "test/integration/expo-app/assets/images/splash.png",
  "packages/bun-vscode/assets/icon.png", "test/js/web/fetch/fixture.png", "docs/images/bundling.png",
  "docs/images/exception_page.png", "docs/images/ffi.png", "docs/images/guides/upstash-1.png", "test/js/node/test/fixtures/sample.png",
  "docs/images/templates/bun-tanstack-todo.png", "docs/images/guides/lambda4.png",
];
for (const s of srcs) {
  const bytes = await Bun.file(root + s).bytes();
  const meta = await new Bun.Image(bytes).metadata();
  const name = basename(s).replace(/\.[a-z]+$/, "");
  for (const w of [meta.width, 640, 257, 96, 33]) {
    if (w > meta.width) continue;
    let img = new Bun.Image(bytes);
    if (w !== meta.width) img = img.resize(w);
    const out = await img.webp({ lossless: true }).bytes();
    await Bun.write(`/root/ref/corpus/img/${name}-${w}.webp`, out);
  }
}
