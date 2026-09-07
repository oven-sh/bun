import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// BUN_JSC_<option>=<value> environment variables are handed to JSC::Options at
// startup (ZigGlobalObject.cpp JSCInitialize). A bad set of them is a
// configuration error: one message on stderr and exit code 1, never a crash
// report.

async function run(env: Record<string, string | undefined>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "process.stdout.write('ran')"],
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

test.concurrent("unknown option is rejected with exit code 1", async () => {
  const { stdout, stderr, exitCode, signalCode } = await run({ BUN_JSC_noSuchOption: "1" });
  expect(stderr).toContain("invalid JSC environment variable");
  expect(stderr).toContain("BUN_JSC_noSuchOption=1");
  expect({ stdout, exitCode, signalCode }).toEqual({ stdout: "", exitCode: 1, signalCode: null });
});

// JSC::Options::assertOptionsAreCoherent() aborts on these combinations. Bun
// checks them first and reports them like the unknown-option case.
for (const env of [
  // useJIT=0 turns every JIT tier off, including the wasm BBQ JIT, so with the
  // wasm interpreter also off there is nothing left to run WebAssembly with.
  { BUN_JSC_useJIT: "0", BUN_JSC_useWasmIPInt: "0" },
  { BUN_JSC_useBBQJIT: "0", BUN_JSC_useWasmIPInt: "0" },
]) {
  test.concurrent(`incoherent options are a configuration error: ${Object.keys(env).join(" + ")}`, async () => {
    const { stdout, stderr, exitCode, signalCode } = await run(env);
    expect(stderr).toContain("error: incoherent JSC options: useWasmIPInt and useBBQJIT are both off");
    for (const [key, value] of Object.entries(env)) {
      expect(stderr).toContain(`${key}=${value}`);
    }
    expect({ stdout, exitCode, signalCode }).toEqual({ stdout: "", exitCode: 1, signalCode: null });
  });
}

test.concurrent("the same options with useWasm=0 are coherent and run", async () => {
  const { stdout, exitCode, signalCode } = await run({
    BUN_JSC_useJIT: "0",
    BUN_JSC_useWasmIPInt: "0",
    BUN_JSC_useWasm: "0",
  });
  expect({ stdout, exitCode, signalCode }).toEqual({ stdout: "ran", exitCode: 0, signalCode: null });
});
