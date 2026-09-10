import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import os from "node:os";

// https://github.com/oven-sh/bun/issues/38931
// Creating a native error whose message exceeds ~2^30 bytes of non-ASCII
// UTF-8 used to abort the process: the UTF-8 -> UTF-16 conversion behind
// EncodedSlice__toErrorInstance sized an intermediate WTF::Vector<char16_t> by
// the byte count, which CRASH()es past ~2^30 entries. A failing expect
// matcher with a huge message (or received value) is the userland door into
// that path. The message must be non-ASCII: all-ASCII messages stay 8-bit
// and never crashed. The crashing input runs in a subprocess so a
// regression fails this test legibly instead of killing the runner, and
// the multi-GB peak stays out of the runner; skips on small machines.
test.skipIf(os.totalmem() < 10 * 1024 ** 3)(
  "expect failure message over 1 GiB of non-ASCII throws instead of aborting",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { expect } = require("bun:test");
// 540M "\\u00e9" chars = 1.08e9 UTF-8 bytes, just past the 2^30 cap.
const big = Buffer.alloc(540_000_000, 0xe9).toString("latin1");
expect.extend({ hugeFailureMessage() { return { pass: false, message: () => big }; } });
let caught;
try { expect(1).hugeFailureMessage(); } catch (e) { caught = e; }
// Never print caught.message: it is over a gigabyte.
console.log(JSON.stringify({
  type: typeof caught?.message,
  hasPrefix: caught?.message.includes(big.slice(0, 64)),
  length: caught?.message.length,
}));`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    let parsed: { type?: string; hasPrefix?: boolean; length?: number };
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      // On a crash there is no JSON; surface the child's signal and stderr.
      parsed = { stderr: stderr.slice(-500) } as any;
    }
    expect({ ...parsed, exitCode, signalCode: proc.signalCode }).toEqual({
      type: "string",
      hasPrefix: true,
      length: expect.any(Number),
      exitCode: 0,
      signalCode: null,
    });
    expect(parsed.length).toBeGreaterThan(540_000_000);
  },
  300_000,
);
