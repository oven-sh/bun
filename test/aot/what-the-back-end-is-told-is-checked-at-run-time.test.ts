// The code generator tells the back end things that the back end takes unseen: this word never changes, this call writes nothing, this number lies in a range,
// this stack slot is written before it is read. `--aot-check=ClaimsToBackEnd` (hidden) leaves all of that as it is, lets the back end do with it what it does in an ordinary
// build, and adds, behind the last phase that moves a value, code that finds out in the run whether it holds. `--aot-check=MovedLoads` has each phase that moves a load, or puts
// another value in its place, write down beside the code where the load stood. Behind the same last phase a second read goes in at each of those places that is still there.
//
// Does the check see anything? For each kind one `--aot-sabotage` tells the back end something untrue. The program built that way must stop with the line that names the kind,
// and the same program built with the check alone must answer as plain Bun does.
import { afterAll, expect } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { dirname, join } from "path";
import { registry } from "./harness/registry";
import {
  built,
  spawned,
  told,
  unsupported,
  withoutCoreDump,
  withoutCrashReport,
  withoutDebugInformation,
} from "./run-programs";
import { describe, test } from "./supported";

const claims = "--aot-check=ClaimsToBackEnd";
const movedLoads = "--aot-check=MovedLoads";
// No pass is left out in a function with this number, so none is left out anywhere: closures are placed in frames whatever the default is.
const everyPass = "--aot-disable-in=4000000000:1";
const rows: [sabotage: string, flags: string[], program: string, named: string][] = [
  ["NoCallWrites", [movedLoads], "a-field-is-read-on-both-sides-of-a-call-that-stores-into-it.ts", "LoadMayMove"],
  // What a class's members are tested by: that the test begins to hold is told to nobody, that it ends is.
  [
    "NoCallWrites",
    [movedLoads],
    "a-name-appears-on-the-prototype-while-a-loop-reads-an-absent-field.ts",
    "LoadMayMove",
  ],
  ["FieldsNeverChange", [claims], "a-field-is-read-and-stored-on-every-turn-of-a-loop.ts", "WordNeverChanges"],
  [
    "ClosureInFrameKeepsNoCaptures",
    [claims, everyPass],
    "a-closure-that-is-only-lent-reads-what-it-captured.ts",
    "StackSlotIsWrittenBeforeRead",
  ],
  ["RangesEndOneEarly", [claims], "flags-and-small-counters-come-out-of-fields.ts", "ValueIsInRange"],
];

const listed = unsupported ? undefined : registry().sabotages;

describe.skipIf(!listed?.includes("NoCallWrites"))(
  "compile/aot/what the back end is told is checked at run time",
  () => {
    const folder = String(tempDir("aot-claims", {}));
    afterAll(() => rmSync(folder, { recursive: true, force: true }));
    const carrier = listed ? withoutDebugInformation() : [];
    let executables = 0;

    async function run(path: string, flags: string[]) {
      const executable = join(folder, `program-${executables++}${isWindows ? ".exe" : ""}`);
      built(
        await spawned(
          [bunExe(), "build", "--compile", "--aot", ...carrier, ...flags, path, "--outfile", executable],
          dirname(path),
          bunEnv,
        ),
      );
      try {
        return await spawned(withoutCoreDump([executable]), dirname(path), { ...bunEnv, ...withoutCrashReport });
      } finally {
        rmSync(executable, { force: true });
      }
    }

    test.concurrent.each(rows)(
      "%s %j %s",
      async (sabotage, flags, program, named) => {
        const path = join(import.meta.dir, "programs", "claims-to-the-back-end", program);
        const plain = await spawned([bunExe(), "run", path], dirname(path), bunEnv);
        expect({ signal: plain.signal, exitCode: plain.exitCode }).toEqual({ signal: null, exitCode: 0 });
        expect(told(await run(path, flags))).toEqual(told(plain));
        const sabotaged = await run(path, [...flags, `--aot-sabotage=${sabotage}`]);
        expect(sabotaged.stderr).toContain(`AOT claim check: ${named} `);
      },
      600_000,
    );

    // A second read goes in only where the word is still there to be read.
    test.concurrent.each(["what-was-read-from-a-text-is-used-when-the-text-is-gone.js"])(
      "%s",
      async program => {
        const path = join(import.meta.dir, "programs", "claims-to-the-back-end", program);
        const plain = await spawned([bunExe(), "run", path], dirname(path), bunEnv);
        expect({ signal: plain.signal, exitCode: plain.exitCode }).toEqual({ signal: null, exitCode: 0 });
        for (const flags of [[claims], [movedLoads]]) expect(told(await run(path, flags))).toEqual(told(plain));
      },
      600_000,
    );
  },
);
