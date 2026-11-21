// Temporary: compares this build with the canary build on the Windows CI machines. Removed before the PR is ready.
import { test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const LIMIT = 270_000;
export function bench(script: string, ...args: string[]) {
  test.skipIf(!isWindows || (process.arch === "x64" && args[0] === "busy"))(
    script,
    async () => {
      using dir = tempDir("tmp-bench", {});
      const name = `bun-windows-${process.arch === "x64" ? "x64" : "aarch64"}`;
      const unzip = async (zip: string, to: string) => {
        mkdirSync(join(String(dir), to));
        await Bun.spawn(["C:\\Windows\\System32\\tar.exe", "-xf", zip, "-C", join(String(dir), to)]).exited;
        return join(String(dir), to, name, "bun.exe");
      };
      let [old, now] = [process.env.OLD_BUN, bunExe()];
      if (!old) {
        const zip = join(String(dir), "old.zip");
        await Bun.write(zip, await fetch(`https://github.com/oven-sh/bun/releases/download/canary/${name}.zip`));
        old = await unzip(zip, "old");
        const shipped = join(import.meta.dir, "../../../release", name + ".zip");
        if (existsSync(shipped)) now = await unzip(shipped, "new");
      }
      const before = now;
      console.log("old", old, "before", before, "new", now);
      await Bun.spawn(
        [
          old,
          join(import.meta.dir, script),
          ...(script === "startup.js" ? [`old=${old}`, `new=${now}`] : [old, now]),
          ...args,
        ],
        {
          env: {
            ...bunEnv,
            STRESS_TLS: process.env.STRESS_TLS,
            PROFILE_EXE: bunExe(),
            BEFORE_BUN: before,
            BUN_GARBAGE_COLLECTOR_LEVEL: undefined,
            BUN_JSC_randomIntegrityAuditRate: undefined,
          },
          stdio: ["ignore", "inherit", "inherit"],
          timeout: LIMIT,
        },
      ).exited;
    },
    LIMIT + 20_000,
  );
}
