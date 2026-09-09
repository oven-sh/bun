import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux } from "harness";

// RLIMIT_AS (`ulimit -v`, systemd `LimitAS=`) caps the address space a process
// may reserve, committed or not. At startup bun reserves a mimalloc arena, the
// JSC structure heap and the JIT pool. Each used to have a fixed size (1 GiB,
// up to 4 GiB, and 1 GiB on x64), so under a limit of a couple of GiB the JIT
// pool did not fit and bun ran interpreter-only with no message, and at some
// limits the structure heap did not fit either and bun aborted at startup.

const jitScript = /* js */ `
  function hot(n) { let s = 0; for (let i = 0; i < n; i++) s = (s + i * 7) % 1000003; return s; }
  for (let i = 0; i < 30; i++) hot(10000);
  const { numberOfDFGCompiles } = require("bun:jsc");
  // numberOfDFGCompiles() reports 1000000 for any function while the JIT tiers are unavailable.
  process.stdout.write(JSON.stringify({ jit: numberOfDFGCompiles(hot) !== 1000000 }));
`;

// Allocates untouched 16 MB buffers until the address space runs out and reports how far it got.
const heapScript = /* js */ `
  const buffers = [];
  let mb = 0;
  try {
    for (;;) { buffers.push(new Uint8Array(16 << 20)); mb += 16; }
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: e.constructor.name, mb }));
  }
`;

// 200_000 objects with distinct shapes: each takes a Structure from the structure heap.
const structureScript = /* js */ `
  const objects = [];
  for (let i = 0; i < 200_000; i++) objects.push({ ["k" + i]: i });
  process.stdout.write(JSON.stringify({ structures: objects.length }));
`;

async function run(limitMB: number | undefined, script: string) {
  const cmd =
    limitMB === undefined
      ? [bunExe(), "-e", script]
      : ["sh", "-c", `ulimit -v ${limitMB * 1024} && exec "$0" -e "$1"`, bunExe(), script];
  await using proc = Bun.spawn({ cmd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

// An ASAN build reserves terabytes of shadow address space and a debug build
// maps several hundred MB of unoptimized code, so neither fits these limits.
describe.skipIf(!isLinux || isASAN || isDebug)("RLIMIT_AS", () => {
  test("without a limit the JIT is available", async () => {
    const { stdout, exitCode, signalCode } = await run(undefined, jitScript);
    expect({ stdout, exitCode, signalCode }).toEqual({ stdout: `{"jit":true}`, exitCode: 0, signalCode: null });
  });

  test.concurrent.each([768, 1024, 1200, 1536, 2048, 2250])(
    "ulimit -v %dM: bun starts and keeps the JIT",
    async limitMB => {
      const { stdout, stderr, exitCode, signalCode } = await run(limitMB, jitScript);
      // stderr first: on failure it carries the crash banner or the allocation error.
      expect({ stderr, stdout }).toEqual({ stderr: expect.any(String), stdout: `{"jit":true}` });
      expect({ exitCode, signalCode }).toEqual({ exitCode: 0, signalCode: null });
    },
  );

  // The startup reservations have to leave most of the limit to the program: under 1.5 GB it gets
  // a catchable out-of-memory error, and not before it has allocated a third of the limit.
  test.concurrent("ulimit -v 1536M: most of the limit is left for the heap", async () => {
    const { stdout, stderr, exitCode, signalCode } = await run(1536, heapScript);
    expect(stderr).toBe("");
    const { error, mb } = JSON.parse(stdout);
    expect(error).toBe("RangeError");
    expect(mb).toBeGreaterThanOrEqual(512);
    expect({ exitCode, signalCode }).toEqual({ exitCode: 0, signalCode: null });
  });

  test.concurrent("ulimit -v 512M: the structure heap still holds 200k shapes", async () => {
    const { stdout, stderr, exitCode, signalCode } = await run(512, structureScript);
    expect({ stderr, stdout }).toEqual({ stderr: expect.any(String), stdout: `{"structures":200000}` });
    expect({ exitCode, signalCode }).toEqual({ exitCode: 0, signalCode: null });
  });
});
