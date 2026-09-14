import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isGlibc, isLinux, isMacOS, isWindows, tempDir } from "harness";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";

// Where Bun's own C compiler (bun_cc + JavaScriptCore's B3) has run these tests.
export const supported = (isGlibc && !isArm64) || (isMacOS && isArm64) || (isWindows && !isArm64 && microsoftHeaders());

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
 * `inline` definitions other files see: Microsoft C has its own), `windows` (where `supported` means Visual
 * Studio's and the Windows SDK's headers are installed), or `uchar` (a C library with `<uchar.h>`: not Apple's).
 * Several of them, separated by white space, must all hold.
 */
export function meets(requirement: string | undefined): boolean {
  const all = requirement?.trim().split(/\s+/) ?? [];
  if (all.length > 1) return all.every(meets);
  switch (all[0]) {
    case undefined:
    case "":
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
    case "uchar":
      return !isMacOS;
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

/** Runs the program at `exe` in `cwd`; what it printed and how it ended. */
async function runProgram(exe: string, cwd: string) {
  await using proc = Bun.spawn({ cmd: [exe], env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

type Result = { stdout: string; stderr: string; exitCode: number | null };

/**
 * The checks of a program that reports every value it checks as a line `<expression> => <value>` and ends with
 * `<n> checks, <m> wrong`: the values it printed, keyed by expression (a repeated expression gets ` #2`, ` #3`, ...),
 * must equal the `[key, value]` pairs of the JSON file at `valuesPath`.
 */
function expectValues(valuesPath: string, result: Result) {
  const expected: [string, number][] = JSON.parse(readFileSync(valuesPath, "utf8"));
  const seen = new Map<string, number>();
  const actual: [string, number][] = [];
  const rest: string[] = [];
  for (const line of lines(result.stdout).split("\n")) {
    const at = line.lastIndexOf(" => ");
    if (at < 0) {
      rest.push(line);
      continue;
    }
    const expression = line.slice(0, at);
    const count = (seen.get(expression) ?? 0) + 1;
    seen.set(expression, count);
    actual.push([count === 1 ? expression : `${expression} #${count}`, Number(line.slice(at + 4))]);
  }
  expect(actual, result.stderr).toEqual(expected);
  expect(rest.slice(-2), result.stderr).toEqual([`${expected.length} checks, 0 wrong`, ""]);
  expect(result.exitCode, result.stderr).toEqual(0);
}

/**
 * What `<name>.expected` and `<name>.status` say: the lines printed, and the exit status: 0 without the file, any
 * status but 0 when the file says `nonzero` (a program that ends in a fault, whose status the platform chooses).
 */
function expectOutput(expectedPath: string, statusPath: string, result: Result) {
  expect(lines(result.stdout).split("\n"), result.stderr).toEqual(
    lines(readFileSync(expectedPath, "utf8")).split("\n"),
  );
  const status = existsSync(statusPath) ? readFileSync(statusPath, "utf8").trim() : "0";
  if (status === "nonzero") expect(result.exitCode, result.stderr).not.toEqual(0);
  else expect(result.exitCode, result.stderr).toEqual(Number(status));
}

/**
 * Two tests per `fixtures/<area>/<name>.c`: the file is run as a program on the fly (`bun name.c`), and built
 * into a standalone executable (`bun build --compile name.c`) that is then run. Either way it must print what
 * `<name>.expected` holds and exit with the status in `<name>.status` (0 when there is no such file); or, when
 * there is a `<name>.values.json` instead, report exactly the values that file lists (see `expectValues`).
 * A `<name>.ts` next to it is run (and built) instead when the C file is easier to check by calling into it.
 * A fixture whose `<name>.requires` names something this machine is not is reported as skipped.
 * One with a `<name>.switches` is run once more for every setting that file lists, and must do the same.
 * `failing` names the fixtures the real backend gets wrong today, with the reason.
 */
export function runFixtures(area: string, failing: Record<string, string> = {}) {
  const dir = join(import.meta.dir, "fixtures", area);
  const names = [...new Bun.Glob("*.c").scanSync(dir)].map(file => file.slice(0, -2)).sort();
  describe.skipIf(!supported)(area, () => {
    for (const name of names) {
      const expectedPath = join(dir, `${name}.expected`);
      const valuesPath = join(dir, `${name}.values.json`);
      // A C file without an expectation is part of another fixture (a second translation unit, an include).
      if (!existsSync(expectedPath) && !existsSync(valuesPath)) continue;
      const applies = meets(requirementIn(join(dir, `${name}.requires`)));
      const declare = name in failing ? test.failing : test.concurrent;
      const title = name in failing ? `${name} (${failing[name]})` : name;
      const entry = existsSync(join(dir, `${name}.ts`)) ? `${name}.ts` : `${name}.c`;
      const check = (result: Result) =>
        existsSync(valuesPath)
          ? expectValues(valuesPath, result)
          : expectOutput(expectedPath, join(dir, `${name}.status`), result);
      declare.skipIf(!applies)(title, async () => check(await run(dir, [entry])));
      // `<name>.switches`: settings of the backend (`BUN_JSC_useFFIInlineC=0`), one a line, none of which may
      // change what the program does.
      for (const setting of requirementIn(join(dir, `${name}.switches`))
        ?.split(/\r?\n/)
        .filter(Boolean) ?? []) {
        const at = setting.indexOf("=");
        declare.skipIf(!applies)(`${title} (${setting})`, async () =>
          check(await run(dir, [entry], { ...bunEnv, [setting.slice(0, at)]: setting.slice(at + 1) })),
        );
      }
      declare.skipIf(!applies)(`${title} (compiled)`, async () => {
        using out = tempDir(`bir-${name}`, {});
        const exe = join(String(out), isWindows ? "program.exe" : "program");
        const build = await run(dir, ["build", "--compile", entry, "--outfile", exe]);
        expect(build.stderr).not.toContain("error:");
        expect(build.exitCode, build.stderr).toBe(0);
        check(await runProgram(exe, dir));
      });
    }
  });
}

/**
 * One test per directory `fixtures/<area>/<name>/`: its C files are linked into one program with
 * `bun build --compile main.c <the others> --outfile …`, and the program must print what `expected` holds and exit
 * with the status in `status` (0 when there is no such file); or report the values `values.json` lists.
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
      const applies = meets(requirementIn(join(dir, "requires")));
      const declare = name in failing ? test.failing : test.concurrent;
      declare.skipIf(!applies)(name in failing ? `${name} (${failing[name]})` : name, async () => {
        const units = [...new Bun.Glob("*.c").scanSync(dir)].filter(file => file !== "main.c").sort();
        using out = tempDir(`bir-${name}`, {});
        const exe = join(String(out), isWindows ? "program.exe" : "program");
        const build = await run(dir, ["build", "--compile", "main.c", ...units, "--outfile", exe]);
        expect(build.stderr).not.toContain("error:");
        expect(build.exitCode, build.stderr).toBe(0);
        const result = await runProgram(exe, dir);
        if (existsSync(join(dir, "values.json"))) expectValues(join(dir, "values.json"), result);
        else expectOutput(join(dir, "expected"), join(dir, "status"), result);
      });
    }
  });
}
