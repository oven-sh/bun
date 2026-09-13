import { describe, expect, test } from "bun:test";
import { bunEnv, isWindows, tempDir } from "harness";
import { join, sep } from "node:path";
import { lines, run, runFixtures, runProjects, supported } from "./run-fixtures";

// Linkage: what several translation units share and what stays private to one.
runFixtures("multi-file");
runProjects("multi-file");

describe.skipIf(!supported)("multi-file: what cannot be linked", () => {
  const main = "int main(void) { return 0; }\n";
  const broken: [string, Record<string, string>, string][] = [
    [
      "a function defined twice",
      { "a.c": "int f(void) { return 1; }", "b.c": "int f(void) { return 2; }" },
      "error: duplicate symbol 'f': defined in a.c and in b.c\n    at b.c\n",
    ],
    ["an object defined twice", { "a.c": "int x = 1;", "b.c": "int y; int x = 2;" }, "duplicate symbol 'x'"],
    [
      "an object in one file, a function in the other",
      { "a.c": "int thing;", "b.c": "int thing(void) { return 0; }" },
      "'thing' is an object in a.c and a function in b.c",
    ],
    [
      "an object called as a function",
      { "a.c": "int value(void); int f(void) { return value(); }", "b.c": "int value = 3;" },
      "called as a function but is defined as an object",
    ],
    [
      "an error in the second file names that file",
      { "a.c": "int f(void) { return 1; }", "b.c": "int g(void) { return }" },
      "b.c:1:",
    ],
    [
      "a thread-local object defined nowhere",
      {
        "a.c": "extern _Thread_local int nowhere;\nint a(void) { return nowhere; }",
        "b.c": "int b(void) { return 0; }",
      },
      "error: thread-local variable 'nowhere' is declared but not defined in any translation unit\n    at a.c:2:22\n",
    ],
    [
      "thread-local where it is used, ordinary where it is defined",
      { "a.c": "extern _Thread_local int v; int a(void) { return v; }", "b.c": "int v = 1;" },
      "'v' is declared thread-local here but its definition is not",
    ],
    [
      "ordinary where it is used, thread-local where it is defined",
      { "a.c": "extern int v; int a(void) { return v; }", "b.c": "_Thread_local int v = 1;" },
      "'v' is defined thread-local but declared here without _Thread_local",
    ],
    [
      "a thread-local object defined twice",
      { "a.c": "_Thread_local int v = 1;", "b.c": "_Thread_local int v = 2;" },
      "duplicate symbol 'v'",
    ],
    [
      "tentative definitions that disagree about the thread",
      { "a.c": "_Thread_local int v;", "b.c": "int v;" },
      "'v' is thread-local in a.c and not in b.c",
    ],
  ];
  for (const [what, files, message] of broken) {
    test.concurrent(what, async () => {
      using dir = tempDir("bir-link-error", { "main.c": main, ...files });
      const { stdout, stderr, exitCode } = await run(String(dir), [
        "build",
        "--compile",
        "main.c",
        "a.c",
        "b.c",
        "--outfile",
        "program",
      ]);
      expect(lines(stderr).replaceAll(String(dir) + sep, "")).toContain(message);
      expect(stdout).not.toContain("compile");
      expect(exitCode).not.toBe(0);
    });
  }
});

// Files that disagree about something they share, in a way a linker lets pass: the program is made, with a remark.
describe.skipIf(!supported)("multi-file: what is linked with a warning", () => {
  const remarked: [string, Record<string, string>, string][] = [
    [
      "a declaration that disagrees with the definition",
      {
        "main.c": "double scale(double); int main(int argc, char **argv) { return argc > 5 ? (int)scale(1) : 0; }",
        "a.c": "int scale(int x) { return x * 3; }",
        "b.c": "",
      },
      "warn: 'scale' is declared here with a different type than its definition in a.c\n   at main.c\n",
    ],
    [
      "tentative definitions of different sizes",
      { "main.c": "int big[2]; int main(void) { return big[1]; }", "a.c": "int big[8];", "b.c": "" },
      "warn: 'big' has size 32 here but size 8 in main.c\n   at a.c\n",
    ],
  ];
  for (const [what, files, message] of remarked) {
    test.concurrent(what, async () => {
      using dir = tempDir("bir-link-warning", files);
      const program = join(String(dir), isWindows ? "program.exe" : "program");
      const build = await run(String(dir), ["build", "--compile", "main.c", "a.c", "b.c", "--outfile", program]);
      expect(lines(build.stderr).replaceAll(String(dir) + sep, "")).toContain(message);
      expect(build.exitCode).toBe(0);
      await using proc = Bun.spawn({ cmd: [program], env: bunEnv, stdout: "pipe", stderr: "pipe" });
      expect(await proc.exited).toBe(0);
    });
  }
});
