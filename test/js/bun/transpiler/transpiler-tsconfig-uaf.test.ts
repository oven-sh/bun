import { describe, expect, test } from "bun:test";

describe("Transpiler tsconfig lifetime", () => {
  test("multiple async transform() calls with tsconfig do not crash", async () => {
    const transpiler = new Bun.Transpiler({
      loader: "tsx",
      tsconfig: JSON.stringify({
        compilerOptions: {
          experimentalDecorators: true,
          jsx: "react",
          jsxFactory: "React.createElement",
        },
      }),
    });

    // First async transform
    const result1 = await transpiler.transform("const x: number = 1;");
    expect(result1).toContain("const x = 1");

    // Second async transform — would crash before the fix due to use-after-free
    // on the tsconfig pointer that was freed by the first TransformTask.deinit
    const result2 = await transpiler.transform("const y: number = 2;");
    expect(result2).toContain("const y = 2");

    // Third call to be safe
    const result3 = await transpiler.transform("const z: number = 3;");
    expect(result3).toContain("const z = 3");
  });

  test("async transform() followed by transformSync() with tsconfig does not crash", async () => {
    const transpiler = new Bun.Transpiler({
      loader: "tsx",
      tsconfig: JSON.stringify({
        compilerOptions: {
          experimentalDecorators: true,
          jsx: "react",
          jsxFactory: "React.createElement",
        },
      }),
    });

    // Before this fix, async transform freed tsconfig in TransformTask.deinit
    const result1 = await transpiler.transform("const a: string = 'hello';");
    expect(result1).toContain('const a = "hello"');

    // Sync transform would read freed memory without the fix
    const result2 = transpiler.transformSync("const b: string = 'world';");
    expect(result2).toContain('const b = "world"');
  });

  test("tsconfig jsx settings are preserved across multiple async transforms", async () => {
    const transpiler = new Bun.Transpiler({
      loader: "tsx",
      tsconfig: JSON.stringify({
        compilerOptions: {
          jsx: "react",
          jsxFactory: "h",
          jsxFragmentFactory: "Fragment",
        },
      }),
    });

    const code = "export default <div>hello</div>;";

    const result1 = await transpiler.transform(code);
    expect(result1).toContain("h(");

    // After the first async transform, tsconfig should still be valid
    const result2 = await transpiler.transform(code);
    expect(result2).toContain("h(");

    // Sync should also work
    const result3 = transpiler.transformSync(code);
    expect(result3).toContain("h(");
  });
});
