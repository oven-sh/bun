import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isLinux, tempDir } from "harness";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Bun's own C compiler (bun_cc + JavaScriptCore's B3) has only run on Linux x64 so far.
export const supported = isLinux && !isArm64;

export async function run(cwd: string, args: string[], env: Record<string, string | undefined> = bunEnv) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], env, cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

/**
 * One test per `fixtures/<area>/<name>.c`: the file is run as a program (`bun name.c`) and must print
 * what `<name>.expected` holds and exit with the status in `<name>.status` (0 when there is no such file).
 * A `<name>.ts` next to it is run instead when the C file is easier to check by calling into it.
 * `failing` names the fixtures the real backend gets wrong today, with the reason.
 */
export function runFixtures(area: string, failing: Record<string, string> = {}) {
  const dir = join(import.meta.dir, "fixtures", area);
  const names = [...new Bun.Glob("*.c").scanSync(dir)].map(file => file.slice(0, -2)).sort();
  describe.skipIf(!supported)(area, () => {
    for (const name of names) {
      const expectedPath = join(dir, `${name}.expected`);
      // A C file without an expectation is part of another fixture (a second translation unit, an include).
      if (!existsSync(expectedPath)) continue;
      const declare = name in failing ? test.failing : test.concurrent;
      declare(name in failing ? `${name} (${failing[name]})` : name, async () => {
        const entry = existsSync(join(dir, `${name}.ts`)) ? `${name}.ts` : `${name}.c`;
        const statusPath = join(dir, `${name}.status`);
        const status = existsSync(statusPath) ? Number(readFileSync(statusPath, "utf8")) : 0;
        const { stdout, stderr, exitCode } = await run(dir, [entry]);
        expect(stdout, stderr).toBe(readFileSync(expectedPath, "utf8"));
        expect(exitCode, stderr).toBe(status);
      });
    }
  });
}

/**
 * One test per directory `fixtures/<area>/<name>/`: its C files are linked into one program with
 * `bun build --compile main.c <the others> --outfile …`, and the program must print what `expected` holds and exit
 * with the status in `status` (0 when there is no such file).
 */
export function runProjects(area: string, failing: Record<string, string> = {}) {
  const root = join(import.meta.dir, "fixtures", area);
  const names = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  describe.skipIf(!supported)(`${area}: several files linked into one program`, () => {
    for (const name of names) {
      const dir = join(root, name);
      const declare = name in failing ? test.failing : test;
      declare(name in failing ? `${name} (${failing[name]})` : name, async () => {
        const units = [...new Bun.Glob("*.c").scanSync(dir)].filter(file => file !== "main.c").sort();
        using out = tempDir(`bir-${name}`, {});
        const exe = join(String(out), "program");
        const build = await run(dir, ["build", "--compile", "main.c", ...units, "--outfile", exe]);
        expect(build.stderr).not.toContain("error");
        expect(build.exitCode, build.stderr).toBe(0);
        await using proc = Bun.spawn({ cmd: [exe], env: bunEnv, cwd: dir, stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        const statusPath = join(dir, "status");
        expect(stdout, stderr).toBe(readFileSync(join(dir, "expected"), "utf8"));
        expect(exitCode, stderr).toBe(existsSync(statusPath) ? Number(readFileSync(statusPath, "utf8")) : 0);
      });
    }
  });
}
