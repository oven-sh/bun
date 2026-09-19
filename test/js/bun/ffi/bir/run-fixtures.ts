import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isGlibc, isMacOS, isWindows, tempDir } from "harness";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";

// Where Bun compiles C: a fact about the platform, which is what the product goes by too.
export const supported = (isGlibc && !isArm64) || (isMacOS && isArm64) || (isWindows && !isArm64);

// What the tests need beyond that is a C library's headers. Where they come with the system or its developer tools,
// a machine without them fails at the first `#include <stdio.h>`, in words that say so. On Windows they are
// Microsoft's, installed apart, and without them nothing here could run: that is an error for whoever set the machine
// up to see, not a reason to skip two thousand tests.
if (supported && isWindows && !microsoftHeaders()) {
  throw new Error(
    "The C tests need Visual Studio's C headers and the Windows SDK's (<vcruntime.h>, <stdio.h>): neither INCLUDE nor " +
      "'Windows Kits\\10\\Include' and 'Microsoft Visual Studio' under Program Files has them on this machine.",
  );
}

// Visual Studio's and the Windows SDK's headers: named by a developer prompt, or where the compiler looks for them
// (the SDK has <stdio.h>, Visual Studio has <vcruntime.h>, which <stdio.h> includes).
function microsoftHeaders() {
  if (process.env.INCLUDE) return true;
  const roots = [
    process.env.ProgramFiles ?? "C:\\Program Files",
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
  ];
  return (
    roots.some(root => existsSync(join(root, "Windows Kits", "10", "Include"))) &&
    roots.some(root => existsSync(join(root, "Microsoft Visual Studio")))
  );
}

/**
 * What a fixture needs beyond `supported`, in a `<name>.requires` file (a `requires` file for a project) or a
 * diagnostics case's `requires`: `x64` (x86-64 instructions, intrinsics or diagnostics), `arm64` (`<arm_neon.h>`),
 * `x87` (80-bit `long double`: x86-64 outside Windows), `x64-sysv` (the System V calling convention for x86-64), `glibc` (its symbols or headers), `posix` (headers and
 * functions Windows does not have), `lp64` (a 64-bit `long`: not Windows), `sysv` (the System V layout of bit-fields
 * and choice of enumeration types, which Windows does not share), `c99-inline` (C99's and GNU C's rules for which
 * `inline` definitions other files see: Microsoft C has its own), `windows` (Microsoft's headers and C library), or
 * `uchar` (a C library with `<uchar.h>`: not Apple's), or `struct-by-reference` (a convention that passes a large
 * structure as the address of a copy the caller makes: arm64 and Windows).
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
      return isGlibc;
    case "posix":
    case "lp64":
    case "sysv":
    case "c99-inline":
      return !isWindows;
    case "windows":
      return isWindows;
    case "uchar":
      return !isMacOS;
    case "struct-by-reference":
      return isArm64 || isWindows;
    default:
      throw new Error(`unknown requirement ${JSON.stringify(requirement)}`);
  }
}

// `long` has 32 bits on Windows and 64 everywhere else this compiler runs, and a fixture that says `long` where it
// means 64 bits is right on the machine it was written on and wrong on Windows: an operand that was to be wider than
// the instruction is not, a structure that was to have 24 bytes has 12. So `long` alone is for fixtures that say how
// wide it is (one of these requirements), and anywhere else it is `long long` or `int`, or the line says that either
// width will do.
const saysHowWideLongIs = ["lp64", "sysv", "x87", "x64-sysv", "glibc", "posix", "arm64", "windows"];
const eitherWidthWillDo = /\/[*/].*\blong: any width\b/;

// Files that are about `long`: all of their lines are as if marked.
const aboutLong: Record<string, string> = Object.fromEntries(
  (
    [
      [
        "every arithmetic type is named, `long` among them, and what is printed is the same for either width",
        [
          "language/6.2.5-types.c",
          "language/6.3.1-arithmetic-conversions.c",
          "language/6.4.4-constants.c",
          "language/6.5-operators-on-every-arithmetic-type.c",
          "language/6.5.4-cast-operators.c",
          "language/6.7.2-type-specifiers-in-every-order.c",
        ],
      ],
      [
        "the `l` forms of the builtins and the macros that describe `long`, held to `sizeof(long)`",
        [
          "basics/bit-manipulation-ops.c",
          "extensions/builtins-by-name.c",
          "extensions/builtins-fold-and-evaluate-their-operands.c",
          "extensions/has-queries-and-predefined-macros.c",
        ],
      ],
      [
        "the C library's own `long`s (`strtol`, `ftell`, `ldiv`), of values that fit 32 bits",
        [
          "libc-interop/programs-using-system-headers-run.c",
          "libc-interop/real-program-roundtrip.c",
          "library/7.21-stdio.c",
          "library/7.5-errno.c",
          "structs-and-abi/div-and-ldiv-return-structs-by-value.c",
        ],
      ],
      [
        "`long` spelled across a line splice is what is tested",
        ["preprocessor/splices-inside-comments-literals-and-numbers.c"],
      ],
    ] as [string, string[]][]
  ).flatMap(([why, files]) => files.map(file => [file, why])),
);

/** `text` with its comments and the insides of its literals blanked: the same lines, and only what is code. */
function codeOf(text: string) {
  const blank = (from: number, to: number) => text.slice(from, to).replace(/[^\n]/g, " ");
  const pieces: string[] = [];
  for (let at = 0; at < text.length; ) {
    let end = at + 1;
    if (text.startsWith("//", at)) {
      end = text.indexOf("\n", at);
      if (end < 0) end = text.length;
      pieces.push(blank(at, end));
    } else if (text.startsWith("/*", at)) {
      end = text.indexOf("*/", at + 2);
      end = end < 0 ? text.length : end + 2;
      pieces.push(blank(at, end));
    } else if (text[at] === '"' || text[at] === "'") {
      while (end < text.length && text[end] !== text[at] && text[end] !== "\n") end += text[end] === "\\" ? 2 : 1;
      end = Math.min(end + 1, text.length);
      pieces.push(blank(at, end));
    } else {
      end = text.slice(at).search(/["'/]/);
      end = end < 0 ? text.length : Math.max(at + end, at + 1);
      pieces.push(text.slice(at, end));
    }
    at = end;
  }
  return pieces.join("");
}

/**
 * The lines of the C in `text` (from 1) that say `long` alone, not `long long` and not `long double`, without a
 * comment that says `long: any width`. None, where `requirement` says how wide `long` is.
 */
export function longsOfUnstatedWidth(text: string, requirement?: string): number[] {
  if (requirement?.split(/\s+/).some(tag => saysHowWideLongIs.includes(tag))) return [];
  const written = text.split("\n");
  return codeOf(text)
    .split("\n")
    .map((line, index) => ({ line: line.replace(/\blong\s+(long|double)\b|\bdouble\s+long\b/g, ""), index }))
    .filter(({ line, index }) => /\blong\b/.test(line) && !eitherWidthWillDo.test(written[index]))
    .map(({ index }) => index + 1);
}

/** `file:line` for each such line in the C files and headers of `dir`, whose requirement `requirementOf` gives. */
function longsIn(area: string, dir: string, requirementOf: (file: string) => string | undefined) {
  if (area.startsWith("borrowed/")) return []; // (Other people's programs, as they wrote them.)
  return readdirSync(dir)
    .filter(file => /\.[ch]$/.test(file))
    .sort()
    .flatMap(file =>
      `${area}/${file}` in aboutLong
        ? []
        : longsOfUnstatedWidth(readFileSync(join(dir, file), "utf8"), requirementOf(file)).map(
            line => `${area}/${file}:${line}`,
          ),
    );
}

// C_INCLUDE_PATH is searched before the system's directories, so a developer's own setting would put other headers
// in front of the ones these tests were written against. Only on Windows, where there may be no system headers of the
// machine's own to find, is it how the tests are told where a C library's are.
const ambientIncludePath = isWindows ? (process.env.C_INCLUDE_PATH ?? "") : "";

/**
 * What the tests run `bun` with: `bunEnv`, a C_INCLUDE_PATH that is the tests' own, and no report sent anywhere when a
 * program is meant to end in a fault.
 */
export const cEnv: Record<string, string | undefined> = {
  ...bunEnv,
  C_INCLUDE_PATH: ambientIncludePath || undefined,
  BUN_ENABLE_CRASH_REPORTING: "0",
};

/** A C_INCLUDE_PATH of `directories` (then, on Windows, whatever the variable already names). */
export function includePath(...directories: string[]) {
  return [...directories, ambientIncludePath].filter(Boolean).join(delimiter);
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

/** `text`, `count` times over. */
export const repeated = (text: string, count: number) => Buffer.alloc(text.length * count, text).toString();

/** What `bun build --compile --outfile program` makes, by name. */
export const programName = isWindows ? "program.exe" : "program";

/** Runs `exe` (this `bun`, unless another program is named) with `args` in `cwd`; what it printed and how it ended. */
export async function run(
  cwd: string,
  args: string[],
  env: Record<string, string | undefined> = cEnv,
  exe: string = bunExe(),
) {
  await using proc = Bun.spawn({ cmd: [exe, ...args], env, cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

/**
 * Compiles the C of `dir`/`file` for another system than this one, which is what `bun build --compile --target` does
 * before it writes anything; what it said. (The executable it is told to take for the other system's is this one,
 * which keeps it off the network and makes it stop there; the C is compiled by then.)
 */
export async function compileFor(
  dir: string,
  file: string,
  target: "bun-windows-x64" | "bun-darwin-arm64" | "bun-linux-x64",
) {
  const out = await run(dir, [
    "build",
    "--compile",
    `--target=${target}`,
    "--compile-executable-path",
    bunExe(),
    file,
    "--outfile",
    "never-written",
  ]);
  return lines(out.stderr);
}

/**
 * `bun build <entries> --target=bun --outdir <out>`, run in `dir` (where the entries are) as a user would: the C is
 * compiled now, and what the bundle carries is its compiled form. The path of the bundle's entry point.
 */
async function bundle(dir: string, out: string, entries: string[]) {
  const build = await run(dir, ["build", ...entries, "--target=bun", "--outdir", out]);
  expect(build.stderr).not.toContain("error:");
  expect(build.exitCode, build.stderr).toBe(0);
  return join(out, entries[0].replace(/\.\w+$/, ".js"));
}

/**
 * `bun build --compile <entries> --outfile <out>/program`, run in `out` so that the copy of the runtime it makes on
 * the way is made next to where it ends up (and goes away with `out`); the path of the executable.
 */
async function compile(dir: string, out: string, entries: string[]) {
  const exe = join(out, programName);
  const build = await run(out, ["build", "--compile", ...entries.map(entry => join(dir, entry)), "--outfile", exe]);
  expect(build.stderr).not.toContain("error:");
  expect(build.exitCode, build.stderr).toBe(0);
  return exe;
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

// How many of an area's fixtures are also built into a standalone executable. `bun build --compile` copies the whole
// runtime for each; what it adds to a bundle (embedding the compiled form in the executable and loading it from
// there) does not depend on what the C does.
const compiledPerArea = 1;

/**
 * Two tests per `fixtures/<area>/<name>.c`: the file is run as a program on the fly (`bun name.c`), and bundled
 * (`bun build name.c --target=bun --outdir …`: the C is compiled at build time and the bundle loads its compiled
 * form, without a C parser or headers) and the bundle is then run. The first `compiledPerArea` of an area get a
 * third: built into a standalone executable (`bun build --compile name.c`) that is then run. Every way it must print
 * what `<name>.expected` holds and exit with the status in `<name>.status` (0 when there is no such file); or, when
 * there is a `<name>.values.json` instead, report exactly the values that file lists (see `expectValues`).
 * A `<name>.ts` next to it is run (and built) instead when the C file is easier to check by calling into it.
 * A fixture whose `<name>.requires` names something this machine is not is reported as skipped.
 * One with a `<name>.switches` is run once more for every setting that file lists, and must do the same.
 * One more test says that every file of the directory is a fixture's or is used by one (see `strays`).
 */
export function runFixtures(area: string) {
  const dir = join(import.meta.dir, "fixtures", area);
  const names = [...new Bun.Glob("*.c").scanSync(dir)].map(file => file.slice(0, -2)).sort();
  const isFixture = (name: string) =>
    existsSync(join(dir, `${name}.expected`)) || existsSync(join(dir, `${name}.values.json`));
  describe.skipIf(!supported)(area, () => {
    test("every file belongs to a fixture", () => {
      expect(strays(dir, new Set(names.filter(isFixture)))).toEqual([]);
    });
    test("`long` alone is only where a fixture says how wide it is, or that either width will do", () => {
      expect(longsIn(area, dir, file => requirementIn(join(dir, file.replace(/\.[ch]$/, ".requires"))))).toEqual([]);
    });
    let compiled = 0;
    for (const name of names) {
      const expectedPath = join(dir, `${name}.expected`);
      const valuesPath = join(dir, `${name}.values.json`);
      // A C file without an expectation is part of another fixture (a second translation unit, an include): `strays`
      // checks that one names it.
      if (!isFixture(name)) continue;
      const applies = meets(requirementIn(join(dir, `${name}.requires`)));
      const declare = test.concurrent;
      const title = name;
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
          check(await run(dir, [entry], { ...cEnv, [setting.slice(0, at)]: setting.slice(at + 1) })),
        );
      }
      declare.skipIf(!applies)(`${title} (bundled)`, async () => {
        using out = tempDir(`bir-${name}`, {});
        check(await run(dir, [await bundle(dir, String(out), [entry])]));
      });
      if (applies && compiled++ < compiledPerArea) {
        declare(`${title} (compiled)`, async () => {
          using out = tempDir(`bir-${name}`, {});
          check(await run(dir, [], cEnv, await compile(dir, String(out), [entry])));
        });
      }
    }
  });
}

/**
 * The files of fixture directory `dir` that no test would ever look at: a side file (`.expected`, `.values.json`,
 * `.requires`, `.status`, `.switches`) whose name is no fixture's, as a misspelt or renamed one is, and a `.c`, `.h` or
 * `.ts` that is not a fixture's own and that no other file of the directory names (one fixture's second translation
 * unit, include or helper is named by it). `fixtures` are the names of the directory's fixtures.
 */
function strays(dir: string, fixtures: Set<string>) {
  const files = readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name);
  const sources = files.filter(file => /\.(c|h|ts)$/.test(file));
  const texts = new Map(sources.map(file => [file, readFileSync(join(dir, file), "utf8")]));
  // (By its name without the extension: an import leaves `.ts` off, and a macro may put `.h` on.)
  const named = (file: string) =>
    sources.some(other => other !== file && texts.get(other)!.includes(file.replace(/\.\w+$/, "")));
  return files
    .filter(file => {
      if (file === "NOTICE" || file === "LICENSE") return false;
      const side = /^(.*)\.(expected|values\.json|requires|status|switches)$/.exec(file);
      if (side) return !fixtures.has(side[1]);
      const source = /^(.*)\.(c|h|ts)$/.exec(file);
      if (source) return !(source[2] !== "h" && fixtures.has(source[1])) && !named(file);
      return true;
    })
    .sort();
}

/**
 * A test per directory `fixtures/<area>/<name>/`: its C files are linked into one program and bundled with
 * `bun build main.c <the others> --target=bun --outdir …`, and the bundle, run, must print what `expected` holds and
 * exit with the status in `status` (0 when there is no such file); or report the values `values.json` lists. The first
 * `compiledPerArea` of an area get a second: the same files built into a standalone executable
 * (`bun build --compile main.c <the others> --outfile …`), which must do the same.
 */
export function runProjects(area: string) {
  const root = join(import.meta.dir, "fixtures", area);
  const names = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  describe.skipIf(!supported)(`${area}: several files linked into one program`, () => {
    let compiled = 0;
    for (const name of names) {
      const dir = join(root, name);
      const applies = meets(requirementIn(join(dir, "requires")));
      const declare = test.concurrent;
      const title = name;
      // (A project is its C files and headers, what it must print or report, and what it needs; a file of any other
      // name, `main.requires` for one, is a slip.)
      test(`${name}: every file is the project's`, () => {
        const others = readdirSync(dir).filter(
          file => !/\.[ch]$/.test(file) && !["expected", "values.json", "status", "requires"].includes(file),
        );
        expect(others).toEqual([]);
        expect(existsSync(join(dir, "main.c"))).toBe(true);
        expect(existsSync(join(dir, "expected")) || existsSync(join(dir, "values.json"))).toBe(true);
        expect(longsIn(`${area}/${name}`, dir, () => requirementIn(join(dir, "requires")))).toEqual([]);
      });
      const units = () => [
        "main.c",
        ...[...new Bun.Glob("*.c").scanSync(dir)].filter(file => file !== "main.c").sort(),
      ];
      const check = (result: Result) =>
        existsSync(join(dir, "values.json"))
          ? expectValues(join(dir, "values.json"), result)
          : expectOutput(join(dir, "expected"), join(dir, "status"), result);
      declare.skipIf(!applies)(title, async () => {
        using out = tempDir(`bir-${name}`, {});
        check(await run(dir, [await bundle(dir, String(out), units())]));
      });
      if (applies && compiled++ < compiledPerArea) {
        declare(`${title} (compiled)`, async () => {
          using out = tempDir(`bir-${name}`, {});
          check(await run(dir, [], cEnv, await compile(dir, String(out), units())));
        });
      }
    }
  });
}
