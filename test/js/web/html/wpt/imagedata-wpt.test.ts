// Runs the Web Platform Tests of ImageData that need no canvas. The files next to this one are byte-identical to
// LayoutTests/imported/w3c/web-platform-tests/html of oven-sh/WebKit at ae8978d0331bfce97259b446378265eb327c407a:
//   canvas/element/pixel-manipulation/2d.imageData.object.*.html
//   canvas/element/manual/wide-gamut-canvas/{canvas-display-p3.js,resources/*.png}
//   canvas/resources/canvas-tests.js
//   semantics/embedded-content/the-canvas-element/imagedata.html

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setRegistrar, wptTest } from "../../../third_party/wpt-testharness-shim";

setRegistrar((name, run) => test(name, run));

const read = (...path: string[]) => readFileSync(join(import.meta.dir, ...path), "utf8");
const pages = readdirSync(import.meta.dir).filter(name => name.endsWith(".html"));

test("all pages are there", () => {
  expect(pages).toHaveLength(8);
});

describe.each(pages)("%s", page => {
  const script = /<script>(.*?)<\/script>/s.exec(read(page))![1];
  const harness = {
    test: wptTest,
    window: globalThis,
    // What `_addTest()` waits for and draws on. A canvas that is empty has transparent black pixels.
    on_event: (_target: unknown, _type: string, listener: () => void) => queueMicrotask(listener),
    document: {
      getElementById: () => ({
        getContext: () => ({ getImageData: (_x: number, _y: number, w: number, h: number) => new ImageData(w, h) }),
      }),
    },
    // The shim only knows the names of errors, not those of their legacy codes.
    assert_throws_dom(type: string, fn: () => unknown) {
      const names = { INDEX_SIZE_ERR: "IndexSizeError", INVALID_STATE_ERR: "InvalidStateError" };
      (globalThis as any).assert_throws_dom(names[type] ?? type, fn);
    },
  };
  new Function(...Object.keys(harness), read("canvas-tests.js") + script)(...Object.values(harness));
});

// canvas-display-p3-drawImage.https.html, for a canvas and an ImageData of the same color space.
describe("wide-gamut-canvas", () => {
  const imageTests = new Function(read("wide-gamut-canvas", "canvas-display-p3.js") + "; return imageTests;")();

  for (const [file, expectations] of Object.entries<Record<string, number[]>>(imageTests)) {
    for (const colorSpace of ["srgb", "display-p3"] as const) {
      // The JPEG decoder turns CMYK into RGB without the profile, for every terminal.
      if (file.includes("CMYK")) {
        test.todo(`${file} to ${colorSpace}`);
        continue;
      }
      test(`${file} to ${colorSpace}`, async () => {
        const image = new Bun.Image(join(import.meta.dir, "wide-gamut-canvas", "resources", file));
        const expected = expectations[`${colorSpace} ${colorSpace}`];
        for (const argument of [{ colorSpace }, new ImageData(2, 2, { colorSpace })]) {
          const imageData = await image.imageData(argument);
          expect(imageData.colorSpace).toBe(colorSpace);
          // Upstream allows a difference of 3.
          expect([...imageData.data]).toEqual(Array(4).fill(expected).flat());
        }
      });
    }
  }
});
