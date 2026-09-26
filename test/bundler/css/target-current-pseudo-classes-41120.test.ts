import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import path from "node:path";

// https://github.com/oven-sh/bun/issues/41120
// :target-current, :target-before and :target-after are css-overflow-5
// pseudo-classes, and lightningcss carries all three. Bun's table did not, so
// they parsed as unknown custom pseudo-classes and were emitted verbatim.
//
// A pseudo-class name is ASCII case-insensitive, so the canonical spelling is
// the observable difference: :target-within, which Bun already knows, is
// lowercased today and sits in this fixture as the control for what the other
// three should do.
describe("css", () => {
  test("the scroll navigation control pseudo-classes are recognized (#41120)", async () => {
    using dir = tempDir("css-41120-target", {
      "in.css": `
        .a:TARGET-CURRENT { color: red }
        .b:Target-Before { color: green }
        .c:target-AFTER { color: teal }
        .d:TARGET-WITHIN { color: olive }
        li:target-current { color: red }
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
      ".a:target-current{color:red}.b:target-before{color:green}.c:target-after{color:teal}" +
        ".d:target-within{color:olive}li:target-current{color:red}",
    );
  });
});
