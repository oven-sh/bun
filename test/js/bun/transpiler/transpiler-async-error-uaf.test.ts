import { describe, expect, test } from "bun:test";

describe("Transpiler async transform() error lifetime", () => {
  test.concurrent("concurrent async transform() parse errors do not read freed memory", async () => {
    const transpiler = new Bun.Transpiler();
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 50; i++) {
      promises.push(
        transpiler.transform("const x = @@@", "js").then(
          () => null,
          e => e,
        ),
      );
    }
    const results = await Promise.all(promises);
    for (const r of results) {
      expect(r).toBeInstanceOf(BuildMessage);
      const msg = r as BuildMessage;
      expect(msg.message).toBe('Expected identifier but found "@"');
      expect(msg.position).toEqual({
        lineText: "const x = @@@",
        file: "input.js",
        namespace: "file",
        line: 1,
        column: 12,
        length: 1,
        offset: 11,
      });
    }
  });

  test.concurrent("async transform() rejects with a usable BuildMessage after arena is freed", async () => {
    const transpiler = new Bun.Transpiler();
    const err = await transpiler.transform("1 + ", "js").then(
      () => null,
      e => e,
    );
    expect(err).toBeInstanceOf(BuildMessage);
    expect((err as BuildMessage).message).toBe("Unexpected end of file");
  });
});
