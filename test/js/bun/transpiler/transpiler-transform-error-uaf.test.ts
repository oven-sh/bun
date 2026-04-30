import { expect, test } from "bun:test";

test("async transform() with parse errors does not read freed arena memory", async () => {
  const transpiler = new Bun.Transpiler();

  // Parse errors are allocated in a per-task arena that is freed when the
  // worker thread finishes. Before the fix, the error text was read from
  // that freed arena on the JS thread when rejecting the promise.
  const results = await Promise.allSettled(
    Array.from({ length: 64 }, () => transpiler.transform("const x = ;;;")),
  );

  for (const result of results) {
    expect(result.status).toBe("rejected");
    const reason = (result as PromiseRejectedResult).reason;
    expect(reason.message).toBe("Unexpected ;");
    expect(reason.position?.line).toBe(1);
    expect(reason.position?.lineText).toBe("const x = ;;;");
  }
});
