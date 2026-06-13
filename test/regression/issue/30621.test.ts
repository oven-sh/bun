import { expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import { join } from "node:path";

// Regression test for https://github.com/oven-sh/bun/issues/30621
// bun build crashes with "index out of bounds: index 0, len 0" when CSS
// contains a malformed data URL like `url(data:)`. The CSS resolver's
// `DataURL.parse` rejected these, the error was silently swallowed, the
// AST was discarded, and doStep5 then indexed into an empty parts array.
// Malformed data URLs in CSS should be preserved as-is (matching the
// behavior for other unresolvable URLs like http://, https://, and //).
test("issue 30621: CSS url(data:) with no comma should not crash", async () => {
  const dir = tempDirWithFiles("30621-css-entry", {
    "style.css": `a{background:url(data:)}`,
  });

  const result = await Bun.build({
    entrypoints: [join(dir, "style.css")],
    outdir: join(dir, "out"),
  });

  expect(result.success).toBeTrue();
  expect(result.outputs.length).toBe(1);
  const css = await result.outputs[0].text();
  // URL is preserved as-is, like other external URLs in CSS.
  expect(css).toContain("data:");
});

test("issue 30621: JS importing CSS with url(data:) should not crash", async () => {
  const dir = tempDirWithFiles("30621-js-entry", {
    "index.js": `import "./style.css";`,
    "style.css": `a{background:url(data:)}`,
  });

  const result = await Bun.build({
    entrypoints: [join(dir, "index.js")],
    outdir: join(dir, "out"),
  });

  expect(result.success).toBeTrue();
  const cssOutput = result.outputs.find(o => o.path.endsWith(".css"));
  expect(cssOutput).toBeDefined();
  const css = await cssOutput!.text();
  expect(css).toContain("data:");
});

test("issue 30621: JS import of malformed data URL produces a clean resolve error", async () => {
  const dir = tempDirWithFiles("30621-js-import", {
    "index.js": `import "data:";`,
  });

  const result = await Bun.build({
    entrypoints: [join(dir, "index.js")],
    outdir: join(dir, "out"),
    throw: false,
  });

  expect(result.success).toBeFalse();
  expect(result.logs.length).toBeGreaterThan(0);
  // Error surfaces with a real resolve diagnostic rather than panicking.
  const messages = result.logs.map(l => String(l.message)).join("\n");
  expect(messages).toMatch(/data URL|Could not resolve/);
});
