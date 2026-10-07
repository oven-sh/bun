import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A build of Bun configured with webAssembly off (scripts/build/config.ts) has no WebAssembly global.
test.skipIf(typeof WebAssembly !== "undefined")(
  "BUN_JSC_useWasm is accepted and does not bring WebAssembly back",
  async () => {
    for (const useWasm of ["1", "0"]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-p", "typeof WebAssembly"],
        env: { ...bunEnv, BUN_JSC_useWasm: useWasm },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout.trim()).toBe("undefined");
      expect(exitCode).toBe(0);
    }
  },
);
