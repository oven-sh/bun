import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isLinux, isMacOS, isWindows, tempDir } from "harness";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";

// Where Bun's own C compiler (bun_cc + JavaScriptCore's B3) has run these tests.
export const supported = (isLinux && !isArm64) || (isMacOS && isArm64) || (isWindows && !isArm64 && microsoftHeaders());

// Visual Studio's and the Windows SDK's headers: named by a developer prompt, or where the compiler looks for them.
function microsoftHeaders() {
  return (
    Boolean(process.env.INCLUDE) ||
    existsSync(join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Windows Kits", "10", "Include"))
  );
}

/**
 * What a fixture needs beyond `supported`, in a `<name>.requires` file (a `requires` file for a project) or a
 * diagnostics case's `requires`: `x64` (x86-64 instructions, intrinsics or diagnostics), `arm64` (`<arm_neon.h>`),
 * `x87` (80-bit `long double`: x86-64 outside Windows), `x64-sysv` (the System V calling convention for x86-64), `glibc` (its symbols or headers), `posix` (headers and
 * functions Windows does not have), `lp64` (a 64-bit `long`: not Windows), `sysv` (the System V layout of bit-fields
 * and choice of enumeration types, which Windows does not share), `c99-inline` (C99's and GNU C's rules for which
 * `inline` definitions other files see: Microsoft C has its own), `windows`, or `msvc-headers` (Windows with
 * Visual Studio's and the Windows SDK's headers installed).
 */
export function meets(requirement: string | undefined) {
  switch (requirement?.trim()) {
    case undefined:
      return true;
    case "x64":
      return !isArm64;
    case "arm64":
      return isArm64;
    case "x87":
    case "x64-sysv":
      return !isArm64 && !isWindows;
    case "glibc":
      return isLinux;
    case "posix":
    case "lp64":
    case "sysv":
    case "c99-inline":
      return !isWindows;
    case "windows":
      return isWindows;
    case "msvc-headers":
      return isWindows && microsoftHeaders();
    default:
      throw new Error(`unknown requirement ${JSON.stringify(requirement)}`);
  }
}

/**
 * A C_INCLUDE_PATH of `directories`, then whatever the variable already names: where there are no system headers
 * of the machine's own to find (Windows), that is how the tests are told where a C library's are.
 */
export function includePath(...directories: string[]) {
  return [...directories, process.env.C_INCLUDE_PATH ?? ""].filter(Boolean).join(delimiter);
}

/**
 * `bun build` and `bun x.c` take no -D or -I: a file that needs macros is compiled through a wrapper that defines
 * them (`NAME` or `NAME=value`) and then includes it, and its include directories go in C_INCLUDE_PATH.
 */
export function wrapperSource(defines: string[], source: string) {
  const macros = defines.map(define => {
    const at = define.indexOf("=");
    return at < 0 ? `#define ${define} 1\n` : `#define ${define.slice(0, at)} ${define.slice(at + 1)}\n`;
  });
  return `${macros.join("")}#include ${JSON.stringify(source.replaceAll("\\", "/"))}\n`;
}

// A C runtime that opens stdout in text mode (msvcrt) writes "\r\n", and git may check text files out that way.
export const lines = (text: string) => text.replaceAll("\r\n", "\n");

function requirementIn(path: string) {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

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
      if (!meets(requirementIn(join(dir, `${name}.requires`)))) continue;
      const declare = name in failing ? test.failing : test.concurrent;
      declare(name in failing ? `${name} (${failing[name]})` : name, async () => {
        const entry = existsSync(join(dir, `${name}.ts`)) ? `${name}.ts` : `${name}.c`;
        const statusPath = join(dir, `${name}.status`);
        const status = existsSync(statusPath) ? Number(readFileSync(statusPath, "utf8")) : 0;
        const { stdout, stderr, exitCode } = await run(dir, [entry]);
        expect(lines(stdout), stderr).toBe(lines(readFileSync(expectedPath, "utf8")));
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
      if (!meets(requirementIn(join(dir, "requires")))) continue;
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
        expect(lines(stdout), stderr).toBe(lines(readFileSync(join(dir, "expected"), "utf8")));
        expect(exitCode, stderr).toBe(existsSync(statusPath) ? Number(readFileSync(statusPath, "utf8")) : 0);
      });
    }
  });
}
