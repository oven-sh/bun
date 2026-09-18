import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import path from "node:path";

// https://github.com/oven-sh/bun/issues/42909
// :state(), ::highlight(), ::target-text, ::search-text, ::spelling-error,
// ::grammar-error, @position-try and @font-feature-values are all in a CSS
// specification and in lightningcss's tables. Bundling them must not emit an
// "Unsupported pseudo-class or pseudo-element" or "invalid @ rule" warning.
describe("css", () => {
  test("known pseudo-classes and pseudo-elements do not warn (#42909)", async () => {
    using dir = tempDir("css-42909-selectors", {
      "in.css": `
        my-el:state(checked) { color: red }
        .a::highlight(search) { background: yellow }
        .b::target-text { background: yellow }
        .c::search-text { background: yellow }
        .d::spelling-error { text-decoration: wavy underline red }
        .e::grammar-error { text-decoration: wavy underline green }
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
      "my-el:state(checked){color:red}" +
        ".a::highlight(search){background:#ff0}" +
        ".b::target-text{background:#ff0}" +
        ".c::search-text{background:#ff0}" +
        ".d::spelling-error{text-decoration:wavy underline red}" +
        ".e::grammar-error{text-decoration:wavy underline green}",
    );
  });

  test("the pseudo-element lookup is case-insensitive (#42909)", async () => {
    using dir = tempDir("css-42909-case", {
      "in.css": `
        .a::TARGET-TEXT { background: yellow }
        .b::Grammar-Error { color: green }
      `,
    });
    const result = await Bun.build({
      entrypoints: [path.join(String(dir), "in.css")],
      minify: true,
      throw: true,
    });
    expect(result.logs.map(String)).toEqual([]);
    const out = await result.outputs[0].text();
    expect(out.trim()).toBe(".a::target-text{background:#ff0}.b::grammar-error{color:green}");
  });

  test("@position-try and @font-feature-values do not warn (#42909)", async () => {
    using dir = tempDir("css-42909-at-rules", {
      "in.css": `
        @position-try --flip { top: anchor(bottom); inset-area: bottom }
        @font-feature-values Font One, "Font Two" {
          font-display: swap;
          @styleset { nice-style: 12; fancy: 1 2 3 }
          @swash { swishy: 1 }
          @styleset { nice-style: 13; later: 4 }
        }
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
      "@position-try --flip{top:anchor(bottom);inset-area:bottom}" +
        "@font-feature-values Font One,Font Two{font-display:swap;@styleset{nice-style:13;fancy:1 2 3;later:4}@swash{swishy:1}}",
    );
  });

  // Same as `@page`: an unknown block or a bad value inside the rule is a
  // parse error, not a warning.
  test("@font-feature-values rejects an unknown block and a value with no index (#42909)", async () => {
    using dir = tempDir("css-42909-ffv-invalid", {
      "bogus.css": `
        @font-feature-values Font One {
          @bogus { x: 1 }
        }
      `,
      "no-index.css": `
        @font-feature-values Font One {
          @swash { missing: ; }
        }
      `,
    });
    const bogus = await Bun.build({
      entrypoints: [path.join(String(dir), "bogus.css")],
      throw: false,
    });
    expect(bogus.logs.map(String)).toEqual(["BuildMessage: Unknown at-rule @bogus"]);
    expect(bogus.success).toBe(false);

    const noIndex = await Bun.build({
      entrypoints: [path.join(String(dir), "no-index.css")],
      throw: false,
    });
    expect(noIndex.logs.map(String)).toEqual(["BuildMessage: Invalid value"]);
    expect(noIndex.success).toBe(false);
  });

  test("@font-feature-values and @position-try keep their shape when not minified (#42909)", async () => {
    using dir = tempDir("css-42909-pretty", {
      "in.css": `
        @font-feature-values Font One {
          @styleset { nice-style: 12 }
        }
        @position-try --flip { top: anchor(bottom) }
      `,
    });
    const result = await Bun.build({
      entrypoints: [path.join(String(dir), "in.css")],
      throw: true,
    });
    expect(result.logs.map(String)).toEqual([]);
    const out = await result.outputs[0].text();
    // Drop the `/* <path> */` header line.
    expect(out.slice(out.indexOf("\n") + 1)).toBe(
      "@font-feature-values Font One {\n" +
        "  @styleset {\n" +
        "    nice-style: 12;\n" +
        "  }\n" +
        "}\n" +
        "\n" +
        "@position-try --flip {\n" +
        "  top: anchor(bottom);\n" +
        "}\n",
    );
  });

  test(":state() and ::highlight() names are not hashed in CSS modules (#42909)", async () => {
    using dir = tempDir("css-42909-modules", {
      "entry.js": `import styles from "./styles.module.css"; console.log(styles.card);`,
      "styles.module.css": `
        .card:state(checked) { color: red }
        .card::highlight(search) { background: yellow }
      `,
    });
    const result = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      minify: true,
      throw: true,
    });
    expect(result.logs.map(String)).toEqual([]);
    const css = await result.outputs.find(o => o.path.endsWith(".css"))!.text();
    const card = css.match(/\.card_([A-Za-z0-9_-]+):state/);
    expect(card, ".card should be scoped").not.toBeNull();
    const hash = card![1];
    expect(css.trim()).toBe(`.card_${hash}:state(checked){color:red}.card_${hash}::highlight(search){background:#ff0}`);
  });
});
