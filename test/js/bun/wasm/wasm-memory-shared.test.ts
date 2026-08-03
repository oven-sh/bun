import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux } from "harness";

const script = `
  const m = new WebAssembly.Memory({ initial: 1, maximum: 8, shared: true });
  const tag = Object.prototype.toString.call(m.buffer);
  const view = new Int32Array(m.buffer);
  m.grow(2);
  let maxRequiredError = "none";
  try {
    new WebAssembly.Memory({ initial: 1, shared: true });
  } catch (e) {
    maxRequiredError = e?.constructor?.name;
  }
  console.log(JSON.stringify({
    tag,
    grownByteLength: m.buffer.byteLength,
    oldViewLength: view.length,
    oldViewDetached: view.buffer.byteLength === 0,
    maxRequiredError,
    asanOptions: process.env.ASAN_OPTIONS ?? null,
  }));
`;

const expected = {
  tag: "[object SharedArrayBuffer]",
  grownByteLength: 196608,
  oldViewLength: 16384,
  oldViewDetached: false,
  maxRequiredError: "TypeError",
};

test("WebAssembly.Memory shared:true yields a SharedArrayBuffer", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ ...expected, asanOptions: bunEnv.ASAN_OPTIONS ?? null });
  expect(exitCode).toBe(0);
});

// JSC gates useWasmFaultSignalHandler on a substring of getenv("ASAN_OPTIONS")
// under ASAN+Linux. When the env var is unset (or set without the flag),
// WebAssembly.Memory must not silently drop {shared:true}; the binary should
// enable the handler on its own without leaking into process.env.
test.skipIf(!(isASAN && isLinux))(
  "WebAssembly.Memory shared:true works on ASAN builds without ASAN_OPTIONS in env",
  async () => {
    for (const override of [undefined, "detect_leaks=0"]) {
      const env: Record<string, string | undefined> = { ...bunEnv, ASAN_OPTIONS: override };
      if (override === undefined) delete env.ASAN_OPTIONS;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env,
        stderr: "pipe",
        stdout: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ ...expected, asanOptions: override ?? null });
      expect(exitCode).toBe(0);
    }
  },
);
