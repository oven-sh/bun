import { test, expect } from "bun:test";
import { Resvg } from "@resvg/resvg-js";

const opts = {
  fitTo: {
    mode: "width",
    value: 500,
  },
  font: {
    loadSystemFonts: false,
  },
};

const svg = `<svg viewBox="-40 0 180 260" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<g fill="green" transform="rotate(-10 50 100) translate(-36 45.5) skewX(40) scale(1 0.5)">
  <path id="heart" d="M 10,30 A 20,20 0,0,1 50,30 A 20,20 0,0,1 90,30 Q 90,60 50,90 Q 10,60 10,30 z" />
</g>
<use xlink:href="#heart" fill="none" stroke="red" stroke-width="1" />
</svg>`;
for (let Class of [
  Resvg,
  // Test that subclasses work as well.
  class ResvgSubclass extends Resvg {
    constructor(...args) {
      super(...args);
    }
    iShouldExist() {
      return true;
    }
  },
]) {
  test(`bbox ${Class.name}`, () => {
    const resvg = new Class(svg, opts);
    const bbox = resvg.getBBox();

    expect(resvg.width).toBe(180);
    expect(resvg.height).toBe(260);

    if (bbox) resvg.cropByBBox(bbox);

    expect(bbox.width).toBe(112.20712208389321);
    expect(bbox.height).toBe(81);

    const pngData = resvg.render();

    expect(pngData.width).toBe(500);
    expect(pngData.height).toBe(362);

    if (Class !== Resvg) {
      expect(resvg).toHaveProperty("iShouldExist");
      expect(resvg.iShouldExist()).toBeTrue();
    }
  });
}

test("napi_create_external_buffer", () => {
  const resvg = new Resvg(svg, opts);
  for (let i = 0; i < 10; i++) {
    resvg.render().asPng();
    Bun.gc();
  }
});
