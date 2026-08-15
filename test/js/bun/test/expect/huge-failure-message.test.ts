import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/38931
// Creating a native error whose message exceeds ~2^30 bytes of non-ASCII
// UTF-8 used to abort the process: the UTF-8 -> UTF-16 conversion behind
// ZigString__toErrorInstance sized an intermediate WTF::Vector<char16_t> by
// the byte count, which CRASH()es past ~2^30 entries. A failing expect
// matcher with a huge message (or received value) is the userland door into
// that path. Needs several GB of RAM. The message must be non-ASCII:
// all-ASCII messages stay 8-bit and never crashed.
test("expect failure message over 1 GiB of non-ASCII throws instead of aborting", () => {
  // 540M "\u00e9" chars = 1.08e9 UTF-8 bytes, just past the 2^30 cap.
  const big = Buffer.alloc(540_000_000, 0xe9).toString("latin1");
  expect.extend({
    hugeFailureMessage() {
      return { pass: false, message: () => big };
    },
  });
  let caught: Error | undefined;
  try {
    (expect(1) as any).hugeFailureMessage();
  } catch (e) {
    caught = e as Error;
  }
  // Never print `caught.message`: it is over a gigabyte.
  expect(typeof caught?.message).toBe("string");
  expect(caught!.message.includes(big.slice(0, 64))).toBe(true);
  expect(caught!.message.length).toBeGreaterThan(540_000_000);
}, 300_000);
