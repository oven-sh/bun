import { expect, test } from "bun:test";

test("async transform() parse errors do not use arena memory after free", async () => {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const promises: Promise<string>[] = [];
  for (let i = 0; i < 1200; i++) {
    promises.push(
      transpiler.transform("const x = ;", "ts").then(
        () => {
          throw new Error("expected parse error");
        },
        e => String(e.message ?? e),
      ),
    );
  }
  const results = await Promise.all(promises);
  for (const msg of results) {
    expect(msg).toContain("Unexpected");
  }
});
