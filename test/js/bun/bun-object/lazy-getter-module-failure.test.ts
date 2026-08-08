import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Clobbering a global that an internal module needs makes that module fail to
// evaluate. The Bun.sql and Bun.SQL lazy getters used to report the failure
// while the exception was still pending on the VM, which aborted debug builds
// inside the uncaught exception handler (and in the process.emit path when
// process._fatalException had not been reified yet). The access must instead
// throw the evaluation error to the caller and leave the process healthy.
describe.concurrent("Bun object lazy getters", () => {
  for (const reifyFatalException of [false, true]) {
    test(`sql getter module failure propagates cleanly (fatalException reified: ${reifyFatalException})`, async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            ${reifyFatalException ? "process._fatalException;" : ""}
            globalThis.Object = undefined;
            let caught = "";
            try {
              Bun.sql;
            } catch (e) {
              caught = e.constructor.name;
            }
            try {
              Bun.SQL;
            } catch (e) {}
            console.log("caught " + caught);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout.trim()).toBe("caught TypeError");
      expect(exitCode).toBe(0);
    });
  }
});
