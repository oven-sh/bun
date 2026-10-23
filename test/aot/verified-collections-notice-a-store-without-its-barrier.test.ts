// BUN_JSC_verifyGC=1 marks the heap again behind every collection and names a cell that is reachable and was not marked. ./parts.mts runs drawn
// programs under it (variant-verified-collections). Does it see the cells of compiled code? Here a build leaves out a write barrier on purpose.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { withoutCoreDump } from "./run-programs";
import { test } from "./supported";

const folder = join(import.meta.dir, "programs", "flattened-objects");

test.each([
  "NoBarrierBehindFreshStoreIntoRoom",
  "NoBarrierForStoreThroughBorrowedObject",
  "FlattenedObjectIsMadeWithoutBarrier",
])(
  "the verifier of collections names a cell that %s leaves unmarked",
  async sabotage => {
    using dir = tempDir("aot-verified-collections", {});
    for (const flags of [[], [`--aot-sabotage=${sabotage}`]]) {
      const executable = join(String(dir), (flags.length ? "sabotaged" : "sound") + (isWindows ? ".exe" : ""));
      const build = await run(
        [
          bunExe(),
          "build",
          "--compile",
          "--aot",
          "--aot-testing=FlattenUntilHeldWhereverLegal",
          ...flags,
          "an-old-outer-object-gets-young-objects.ts",
          "--outfile",
          executable,
        ],
        folder,
      );
      expect({ stderr: build.exitCode ? build.stderr : "", exitCode: build.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
      const { stderr, exitCode } = await run(withoutCoreDump([executable]), folder, {
        ...bunEnv,
        BUN_JSC_verifyGC: "1",
      });
      if (!flags.length) {
        expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
        continue;
      }
      expect(stderr).toContain("GC Verifier: ERROR cell");
      expect(exitCode).not.toBe(0);
    }
  },
  240_000,
);
