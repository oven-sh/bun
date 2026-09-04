import { describe, expect, test } from "bun:test";

describe(".resolves and .rejects return promises (Jest semantics)", () => {
  test("a pending promise does not block the thread", async () => {
    let reject!: (e: unknown) => void;
    const pending = new Promise((_, r) => {
      reject = r;
    });
    // Under the old blocking semantics this line never returned.
    const assertion = expect(pending).rejects.toThrow("later");
    expect(assertion).toBeInstanceOf(Promise);
    reject(new Error("later"));
    await assertion;
  });

  test("resolves with a value", async () => {
    await expect(Promise.resolve(1)).resolves.toBe(1);
    await expect(Promise.resolve({ a: 1 })).resolves.toEqual({ a: 1 });
    await expect(Promise.resolve(1)).resolves.not.toBe(2);
    await expect(Promise.resolve(2)).not.resolves.toBe(1);
  });

  test("rejects with a value", async () => {
    await expect(Promise.reject(new Error("boom"))).rejects.toThrow("boom");
    await expect(Promise.reject("x")).rejects.toBe("x");
    await expect(Promise.reject("x")).rejects.not.toBe("y");
  });

  test("a thenable is accepted", async () => {
    const thenable = { then: (resolve: (v: number) => void) => resolve(5) };
    await expect(thenable).resolves.toBe(5);
  });

  test("mismatched settlement rejects with a matcher error", async () => {
    await expect(expect(Promise.resolve(1)).rejects.toBe(1)).rejects.toThrow("Expected promise that rejects");
    await expect(expect(Promise.reject(1)).resolves.toBe(1)).rejects.toThrow("Expected promise that resolves");
  });

  test("a non-promise rejects with Jest's matcher error", async () => {
    await expect(expect(4).resolves.toBe(4)).rejects.toThrow("received value must be a promise");
    await expect(expect(4).rejects.toBe(4)).rejects.toThrow("received value must be a promise");
  });

  test("a failing matcher rejects the returned promise", async () => {
    await expect(expect(Promise.resolve(1)).resolves.toBe(2)).rejects.toThrow();
  });

  test("resolves cannot be chained with rejects", () => {
    expect(() => (expect(Promise.resolve(1)).resolves as any).rejects).toThrow(
      "Cannot chain .rejects() after .resolves()",
    );
    expect(() => (expect(Promise.resolve(1)).rejects as any).resolves).toThrow(
      "Cannot chain .resolves() after .rejects()",
    );
  });

  test("unknown matcher names reject", async () => {
    await expect((expect(Promise.resolve(1)).resolves as any).toBeWhatever()).rejects.toThrow("is not a function");
  });

  test("custom labels are kept", async () => {
    await expect(expect(Promise.resolve(1), "my label").resolves.toBe(2)).rejects.toThrow("my label");
  });

  test("custom labels are kept on failures raised before the matcher runs", async () => {
    await expect(expect(4, "my label").resolves.toBe(4)).rejects.toThrow(/^my label\n\nexpect\(received\)\.resolves/);
    await expect(expect(Promise.resolve(1), "my label").rejects.toBe(1)).rejects.toThrow(
      /^my label\n\nexpect\(received\)\.rejects/,
    );
    await expect(expect(Promise.reject(1), "my label").resolves.toBe(1)).rejects.toThrow(
      /^my label\n\nexpect\(received\)\.resolves/,
    );
  });

  test("negation is captured per matcher call", async () => {
    let resolve!: (v: number) => void;
    const p = new Promise<number>(r => {
      resolve = r;
    });
    const matchers = expect(p).resolves;
    const plain = matchers.toBe(1);
    const negated = matchers.not.toBe(1);
    resolve(1);
    await plain;
    await expect(negated).rejects.toThrow();
  });

  test("unawaited chains do not block and settle later", async () => {
    let resolve!: (v: number) => void;
    const p = new Promise<number>(r => {
      resolve = r;
    });
    const unawaited = expect(p).resolves.toBe(3);
    let settled = false;
    unawaited.then(() => {
      settled = true;
    });
    expect(settled).toBe(false);
    resolve(3);
    await unawaited;
    expect(settled).toBe(true);
  });
});
