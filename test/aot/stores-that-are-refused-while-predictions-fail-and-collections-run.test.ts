// One program of ./programs under many seeds: predictions fail half the time while every third allocation that leaves the fast path collects the whole heap and freed cells are
// scribbled over. Its last part stores by name into objects that take no new properties. The variant that draws this program runs one seed; it died once on Linux arm64.
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isArm64, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";
import { copyFileSync, cpSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { withoutCoreDump } from "./run-programs";
import { beforeAll, describe, test } from "./supported";

const name = "fields-created-by-name-beside-extra-properties-keep-the-order-of-keys.js";
const collecting = {
  BUN_JSC_slowPathAllocsBetweenGCs: "3",
  BUN_JSC_useZombieMode: "1",
  BUN_JSC_scribbleFreeCells: "1",
};

describe
  .skipIf(isASAN || isDebug)
  .concurrent("compile/aot/stores that are refused while predictions fail and collections run", () => {
    const dir = tempDir("aot-stores-that-are-refused", {});
    const cwd = String(dir);
    let printed = "";
    afterAll(() => dir[Symbol.dispose]());
    beforeAll(async () => {
      copyFileSync(join(import.meta.dir, "programs", "objects", name), join(cwd, name));
      const plain = await run([bunExe(), name], cwd);
      expect(plain.exitCode).toBe(0);
      printed = plain.stdout;
    });

    test.each(Array.from({ length: isLinux && isArm64 ? 40 : 16 }, (_, at) => at + 1))(
      "seed %d",
      async seed => {
        const executable = join(cwd, "seed" + seed + (isWindows ? ".exe" : ""));
        const built = await run(
          [
            bunExe(),
            "build",
            "--compile",
            "--aot",
            "--aot-testing=FailPredictions:2:" + seed,
            name,
            "--outfile",
            executable,
          ],
          cwd,
        );
        expect(built.stderr).not.toContain("error:");
        expect(built.exitCode).toBe(0);
        const ran = await run(withoutCoreDump([executable]), cwd, { ...bunEnv, ...collecting });
        expect({
          seed,
          exitCode: ran.exitCode,
          stderr: ran.exitCode ? ran.stderr : "",
          same: ran.stdout === printed,
        }).toEqual({ seed, exitCode: 0, stderr: "", same: true });
      },
      240_000,
    );

    // Neither death needs a prediction that fails: what it takes is a collection that the room for an object's first extra property starts.
    test.each([
      ["the same program", "objects", name],
      ["reads by key", "typed-objects", "extra-properties-read-and-replaced-by-key/main.ts"],
    ])(
      "every prediction holds: %s",
      async (_, folder, entry) => {
        const top = entry.split("/")[0];
        cpSync(join(import.meta.dir, "programs", folder, top), join(cwd, "holds", top), { recursive: true });
        const plain = await run([bunExe(), entry], join(cwd, "holds"));
        expect(plain.exitCode).toBe(0);
        const executable = join(cwd, "holds", "built-" + folder + (isWindows ? ".exe" : ""));
        const built = await run(
          [bunExe(), "build", "--compile", "--aot", entry, "--outfile", executable],
          join(cwd, "holds"),
        );
        expect(built.stderr).not.toContain("error:");
        expect(built.exitCode).toBe(0);
        const ran = await run(withoutCoreDump([executable]), join(cwd, "holds"), { ...bunEnv, ...collecting });
        expect({
          exitCode: ran.exitCode,
          stderr: ran.exitCode ? ran.stderr : "",
          same: ran.stdout === plain.stdout,
        }).toEqual({ exitCode: 0, stderr: "", same: true });
      },
      240_000,
    );
  });
