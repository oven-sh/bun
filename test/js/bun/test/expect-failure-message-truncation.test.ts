import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/37310
// Rendering the received value into a matcher failure message used to be
// unbounded: a wide object graph (e.g. a happy-dom tree) expanded to
// gigabytes, and past JSC's maximum string length the assertion error could
// not be created at all, so the failed assertion returned without throwing.

function tree(depth: number, fanout: number): any {
  const node: any = { tag: "div", className: `level-${depth}`, children: [] };
  if (depth > 0) {
    for (let i = 0; i < fanout; i++) node.children.push(tree(depth - 1, fanout));
  }
  return node;
}

function messageOf(fn: () => void): string {
  let err: Error | undefined;
  try {
    fn();
  } catch (e: any) {
    err = e;
  }
  expect(err).toBeDefined();
  return err!.message;
}

test("failure message for a huge object graph is truncated and still throws", () => {
  const root = tree(4, 14); // ~41k nodes, renders several MB untruncated
  const message = messageOf(() => expect(root).toBeNull());
  expect(message.length).toBeLessThan(2 * 1024 * 1024);
  expect(message).toContain("[value truncated]");
});

test("failure message for a huge string is truncated and still throws", () => {
  // Strings render through a different path than object properties; this
  // used to escape the whole string into the message.
  const s = Buffer.alloc(2_000_000, "x").toString();
  const message = messageOf(() => expect(s).toBeNull());
  expect(message.length).toBeLessThan(2 * 1024 * 1024);
  expect(message).toContain("[value truncated]");
});

test("failure message for a huge Map is truncated and still throws", () => {
  const big = Buffer.alloc(1024, "v").toString();
  const m = new Map<string, string>();
  for (let i = 0; i < 2_000; i++) m.set("key" + i, big); // ~2MB rendered untruncated
  const message = messageOf(() => expect(m).toBeNull());
  expect(message.length).toBeLessThan(2 * 1024 * 1024);
  expect(message).toContain("[value truncated]");
});

test("toThrow failure message for a huge thrown value is truncated", () => {
  // toThrow builds its formatter through a different helper than toBeNull;
  // both must apply the cap.
  const root = tree(4, 14);
  const message = messageOf(() =>
    expect(() => {
      throw root;
    }).toThrow("nope"),
  );
  expect(message.length).toBeLessThan(4 * 1024 * 1024);
  expect(message).toContain("[value truncated]");
});

test("a getter throwing after the cap is hit does not replace the assertion error", () => {
  // Element 0 exhausts the byte budget; element 1's tag classification then
  // invokes a throwing getter. The pending exception must not surface in
  // place of the assertion error.
  const bad = {};
  Object.defineProperty(bad, "$$typeof", {
    get() {
      throw new Error("boom");
    },
  });
  const arr = [Buffer.alloc(2_000_000, "x").toString(), bad];
  const message = messageOf(() => expect(arr).toBeNull());
  expect(message).not.toBe("boom");
  // The signature may carry ANSI codes in CI, so match a contiguous token.
  expect(message).toContain("toBeNull");
  expect(message.length).toBeLessThan(2 * 1024 * 1024);
});

test("failure message for a small value is not truncated", () => {
  const message = messageOf(() => expect({ a: 1, b: [2, 3] }).toBeNull());
  expect(message).not.toContain("[value truncated]");
  expect(message).toContain("a: 1");
});
