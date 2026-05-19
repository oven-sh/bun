import { expect, test } from "bun:test";

test("concurrent async transform() rejections do not use-after-free", async () => {
  const transpiler = new Bun.Transpiler({ loader: "tsx" });

  const inputs = [
    "const {a, a} = b",
    "class X { @invalid }",
    "const x: string = ;",
    "@#$%^ invalid syntax !!!",
    "function (",
  ];

  const promises: Promise<unknown>[] = [];
  for (let i = 0; i < 20; i++) {
    for (const input of inputs) {
      promises.push(transpiler.transform(input).catch(e => e));
    }
  }

  const results = await Promise.all(promises);
  expect(results).toHaveLength(20 * inputs.length);
  for (const result of results) {
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  }
});

test("async transform() error preserves message and notes", async () => {
  const transpiler = new Bun.Transpiler({ loader: "tsx" });

  const errors = await Promise.all(
    Array.from({ length: 8 }, () => transpiler.transform("const {a, a} = b").catch(e => e)),
  );

  for (const err of errors) {
    expect(err.message).toBe('"a" has already been declared');
    expect(err.position?.file).toBe("input.tsx");
    expect(err.position?.lineText).toBe("const {a, a} = b");
    expect(err.notes).toHaveLength(1);
    expect(err.notes[0].message).toBe('"a" was originally declared here');
    expect(err.notes[0].position?.lineText).toBe("const {a, a} = b");
  }
});
