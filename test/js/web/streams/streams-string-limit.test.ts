import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { totalmem } from "node:os";

// Consuming a stream as text must reject with a catchable error when the accumulated
// chunks exceed the maximum string length (2^31-1 bytes), instead of aborting the
// process in WTF::Vector's capacity check. Each child commits ~2.2GB.
const enoughMemory = totalmem() >= 8 * 1024 * 1024 * 1024;

// 3 chunks of n bytes sum to 2^31+1: each chunk fits comfortably, the total does not.
function consumeToText(streamSource: string): string {
  return `
    const n = 715827883;
    const rs = ${streamSource};
    try {
      const text = await Bun.readableStreamToText(rs);
      console.log("resolved", text.length);
    } catch (e) {
      console.log("threw", e.name, e.message);
    }
  `;
}

async function run(script: string): Promise<{ stdout: string; exitCode: number }> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  return { stdout, exitCode };
}

describe.skipIf(!enoughMemory)("text consumers reject binary chunks summing past 2^31-1", () => {
  test("queue-backed ReadableStream", async () => {
    const { stdout, exitCode } = await run(
      consumeToText(`new ReadableStream({
        start(c) {
          for (let i = 0; i < 3; i++) c.enqueue(new Uint8Array(n));
          c.close();
        },
      })`),
    );
    expect(stdout).toBe("threw RangeError Out of memory\n");
    expect(exitCode).toBe(0);
  });

  test("direct ReadableStream", async () => {
    const { stdout, exitCode } = await run(
      consumeToText(`new ReadableStream({
        type: "direct",
        pull(c) {
          for (let i = 0; i < 3; i++) c.write(new Uint8Array(n));
          c.end();
        },
      })`),
    );
    expect(stdout).toBe("threw RangeError Out of memory\n");
    expect(exitCode).toBe(0);
  });

  test("Response(stream).text()", async () => {
    const { stdout, exitCode } = await run(`
      const n = 715827883;
      const rs = new ReadableStream({
        start(c) {
          for (let i = 0; i < 3; i++) c.enqueue(new Uint8Array(n));
          c.close();
        },
      });
      try {
        const text = await new Response(rs).text();
        console.log("resolved", text.length);
      } catch (e) {
        console.log("threw", e.name, e.message);
      }
    `);
    expect(stdout).toBe("threw RangeError Out of memory\n");
    expect(exitCode).toBe(0);
  });
});
