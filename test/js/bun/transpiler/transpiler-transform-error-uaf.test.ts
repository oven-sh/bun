import { expect, test } from "bun:test";

test("concurrent async transform() with parse errors produces correct error messages", async () => {
  const transpiler = new Bun.Transpiler();

  const promises: Promise<unknown>[] = [];
  for (let i = 0; i < 100; i++) {
    promises.push(transpiler.transform("const x = ;", "js").catch(e => e));
  }

  const errors = await Promise.all(promises);
  for (const err of errors) {
    expect(String(err)).toContain("Unexpected");
  }
});

test("concurrent async transform() with redeclaration errors produces correct error messages", async () => {
  const transpiler = new Bun.Transpiler();

  const promises: Promise<unknown>[] = [];
  for (let i = 0; i < 100; i++) {
    promises.push(transpiler.transform("const x = 1; const x = 2;", "js").catch(e => e));
  }

  const errors = await Promise.all(promises);
  for (const err of errors) {
    expect(String(err)).toContain(`"x"`);
  }
});
