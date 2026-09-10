import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import path from "node:path";

// https://github.com/oven-sh/bun/issues/41120
// ::details-content, ::picker(), ::checkmark and ::picker-icon are known
// pseudo-elements (css-pseudo-4 and css-forms-1, also in lightningcss's
// tables). Bundling them must not emit an "Unsupported pseudo-class or
// pseudo-element" warning.
describe("css", () => {
  test("known form pseudo-elements do not warn (#41120)", async () => {
    using dir = tempDir("css-41120", {
      "in.css": `
        .a::details-content { height: auto }
        .b::picker(select) { border: none }
        .c::checkmark { color: teal }
        .d::picker-icon { rotate: 90deg }
      `,
    });
    const result = await Bun.build({
      entrypoints: [path.join(String(dir), "in.css")],
      minify: true,
      throw: true,
    });
    expect(result.logs.map(String)).toEqual([]);
    const out = await result.outputs[0].text();
    expect(out.trim()).toBe(
      ".a::details-content{height:auto}.b::picker(select){border:none}.c::checkmark{color:teal}.d::picker-icon{rotate:90deg}",
    );
  });

  test("the pseudo-element lookup is case-insensitive (#41120)", async () => {
    using dir = tempDir("css-41120-case", {
      "in.css": `
        .a::DETAILS-CONTENT { height: auto }
        .b::Checkmark { color: teal }
      `,
    });
    const result = await Bun.build({
      entrypoints: [path.join(String(dir), "in.css")],
      minify: true,
      throw: true,
    });
    expect(result.logs.map(String)).toEqual([]);
    const out = await result.outputs[0].text();
    expect(out.trim()).toBe(".a::details-content{height:auto}.b::checkmark{color:teal}");
  });
});
