import { expect, test } from "bun:test";

test("async transform() parse errors do not read freed arena memory", async () => {
  const transpiler = new Bun.Transpiler();
  const promises: Promise<unknown>[] = [];
  for (let i = 0; i < 200; i++) {
    promises.push(transpiler.transform("\x00\x01\x02").catch(e => e));
    Bun.gc(true);
  }
  const results = await Promise.all(promises);
  for (const result of results) {
    expect((result as { message: string }).message).toBe("Unexpected \x00");
  }
});
