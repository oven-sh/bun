import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import path from "node:path";

// A browser drops a whole style rule when it does not support one selector in
// the list. Browser hacks such as `_:-ms-lang(x), .ie-only {}` and vendor
// pseudo-element lists in CSS resets rely on that. The default browser targets
// made the bundler split such a list into one rule per selector, which turned
// the other selectors live in every browser and duplicated the declarations.
describe("css", () => {
  test("a selector list with a vendor-prefixed member is not split", async () => {
    using dir = tempDir("css-unsupported-selector-list", {
      "in.css": `
        x:-moz-any-link, .b { border-style: solid }
        _:-ms-lang(x), .c { color: red }
        .e, ::-webkit-foo { color: red }
        .i, input::-moz-placeholder { color: red }
        button::-moz-focus-inner, [type="button"]::-moz-focus-inner { border-style: none }
        .p::placeholder, .p::-moz-placeholder { opacity: 1 }
      `,
    });
    const result = await Bun.build({
      entrypoints: [path.join(String(dir), "in.css")],
      minify: true,
      throw: true,
    });
    const out = await result.outputs[0].text();
    expect(out.trim().split("}")).toEqual([
      "x:-moz-any-link,.b{border-style:solid",
      "_:-ms-lang(x),.c{color:red",
      ".e,::-webkit-foo{color:red",
      ".i,input::-moz-placeholder{color:red",
      "button::-moz-focus-inner,[type=button]::-moz-focus-inner{border-style:none",
      ".p::placeholder,.p::-moz-placeholder{opacity:1",
      "",
    ]);
  });
});
