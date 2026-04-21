import { expect, test } from "bun:test";
import { tempDir } from "harness";

test("bun build produces valid JS for unused dynamic imports", async () => {
  using dir = tempDir("issue-24709", {
    "void-import.ts": `
export function main() {
    void import("./dep.ts");
}
`,
    "bare-import.ts": `
export function main() {
    import("./dep.ts");
}
`,
    "dep.ts": `export const x = 1;`,
  });

  const transpiler = new Bun.Transpiler();

  // Test void import("...")
  {
    const result = await Bun.build({
      entrypoints: [`${dir}/void-import.ts`],
    });

    expect(result.success).toBe(true);
    const output = await result.outputs[0].text();

    // The output must not contain an empty arrow function body like "() => )"
    expect(output).not.toContain("() => )");

    // Validate the output is syntactically valid JS by scanning it
    expect(() => transpiler.scanImports(output)).not.toThrow();
  }

  // Test bare import("...")
  {
    const result = await Bun.build({
      entrypoints: [`${dir}/bare-import.ts`],
    });

    expect(result.success).toBe(true);
    const output = await result.outputs[0].text();

    expect(output).not.toContain("() => )");
    expect(() => transpiler.scanImports(output)).not.toThrow();
  }
});
