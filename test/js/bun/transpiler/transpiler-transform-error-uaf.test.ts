import { expect, test } from "bun:test";

test("async transform() rejecting with parse errors does not read freed memory", async () => {
  const transpiler = new Bun.Transpiler();
  const bad = Buffer.alloc(1000, "const a = 1;\n").toString() + "const x = ;";

  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      transpiler.transform(bad).then(
        () => null,
        e => e,
      ),
    ),
  );

  for (const e of results) {
    expect(e).toBeInstanceOf(Error);
    const text = e.errors ? e.errors.map(String).join("\n") : String(e);
    expect(text).toMatch(/already been declared|Unexpected/);
  }
});
