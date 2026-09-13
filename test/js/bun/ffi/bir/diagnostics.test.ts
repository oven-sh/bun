import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { sep } from "node:path";
import cases from "./fixtures/diagnostics/cases.json";
import { lines, meets, run, supported } from "./run-fixtures";

// What the compiler refuses, and what it says, the way Bun says what is wrong with a TypeScript file: the line, a
// caret, `error: message` and `at file:line:column`. The first error only. (Here without the directory.)
async function firstError(source: string) {
  using dir = tempDir("bir-diagnostic", { "test.c": source });
  const { stdout, stderr, exitCode } = await run(String(dir), ["test.c"]);
  return { stdout, stderr: lines(stderr).replaceAll(String(dir) + sep, ""), exitCode };
}

describe.skipIf(!supported)("diagnostics", () => {
  cases.forEach(
    ({ about, source, line, column, message, requires }: (typeof cases)[number] & { requires?: string }, index) => {
      if (!meets(requires)) return;
      test.concurrent(`${index}: ${about}: ${message.slice(0, 60)}`, async () => {
        const { stdout, stderr, exitCode } = await firstError(source);
        expect(stderr).toContain(`error: ${message}\n    at test.c:${line}:${column}\n`);
        expect(stdout).toBe("");
        expect(exitCode).not.toBe(0);
      });
    },
  );

  // What is only worth a remark: the program is compiled and runs, and the remarks are printed the same way.
  const remarks: [string, string, string[], string?][] = [
    [
      "#warning, where it is not skipped",
      `#warning first thing
int x;
#if 0
#warning skipped
#endif
  #  warning second "quoted" thing
int puts(const char *);
int main(void) { puts("ran"); return 0; }
`,
      ["warn: #warning first thing\n   at test.c:1:1\n", 'warn: #warning second "quoted" thing\n   at test.c:6:3\n'],
    ],
    [
      "a macro defined again another way",
      `#define A 1
#define A 2
int puts(const char *);
int main(void) { puts("ran"); return A - 2; }
`,
      ["warn: 'A' redefined with a different definition\n   at test.c:2:9\n"],
    ],
    [
      "a conversion that discards a qualifier",
      `int puts(const char *);
void take(char *p) { (void)p; }
char *f(const char *s, volatile int *v) { char *p = s; take(s); int *q = v; (void)q; p = (char *)s; return s; }
int main(void) { puts("ran"); return 0; }
`,
      [
        "warn: initializing discards the 'const' qualifier: 'const char *' to 'char *'\n   at test.c:3:53\n",
        "warn: passing an argument discards the 'const' qualifier: 'const char *' to 'char *'\n   at test.c:3:61\n",
        "warn: initializing discards the 'volatile' qualifier: 'volatile int *' to 'int *'\n   at test.c:3:74\n",
        "warn: returning discards the 'const' qualifier: 'const char *' to 'char *'\n   at test.c:3:101\n",
      ],
    ],
    [
      "a __declspec nobody has heard of",
      `__declspec(something_new(1, 2)) int f(void);
int puts(const char *);
int main(void) { puts("ran"); return 0; }
`,
      ["warn: unknown attribute 'something_new'"],
      "windows",
    ],
  ];
  for (const [what, source, expected, requires] of remarks) {
    if (!meets(requires)) continue;
    test.concurrent(`a warning for ${what}`, async () => {
      const { stdout, stderr, exitCode } = await firstError(source);
      for (const remark of expected) expect(stderr).toContain(remark);
      expect(stderr).not.toContain("skipped");
      expect(stderr).not.toContain("error");
      expect(lines(stdout)).toBe("ran\n");
      expect(exitCode).toBe(0);
    });
  }

  test.concurrent("a warning and then an error: both are said, and nothing runs", async () => {
    const { stdout, stderr, exitCode } = await firstError("#warning w\nint x = ;\n");
    expect(stderr).toContain("warn: #warning w\n   at test.c:1:1\n");
    expect(stderr).toContain("error: expected an expression before ';'\n    at test.c:2:9\n");
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  });

  test.concurrent("an error about a second declaration shows the first", async () => {
    const { stdout, stderr, exitCode } = await firstError(
      "int f(void) { return 1; }\nint f(void) { return 2; }\nint g(int);\nlong g(int);\n",
    );
    expect(stderr).toContain(
      "error: redefinition of 'f'\n    at test.c:2:5\n\n1 | int f(void) { return 1; }\n        ^\nnote: the previous declaration is here\n   at test.c:1:5\n",
    );
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  });

  // Input nested far deeper than any program is: an error, not a stack overflow.
  const deep: [string, string, string][] = [
    ["parentheses", `int f(void) { return ${"(".repeat(5000)}1${")".repeat(5000)}; }`, "nesting is too deep"],
    ["blocks", `void f(void) { ${"{".repeat(5000)} ${"}".repeat(5000)} }`, "nesting is too deep"],
    ["unary operators", `int f(int x) { return ${"-".repeat(5000)}x; }`, "nesting is too deep"],
    ["declarators", `int ${"(*".repeat(5000)}x${")".repeat(5000)};`, "nesting is too deep"],
    ["initializers", `int x = ${"{".repeat(5000)}1${"}".repeat(5000)};`, "nesting is too deep"],
    ["a chain of additions", `int f(int x) { return x${" + x".repeat(5000)}; }`, "expression is nested too deeply"],
    ["else if", `int f(int x) { ${"if (x) return 1; else ".repeat(5000)} return 0; }`, "nesting is too deep"],
  ];
  // A preprocessor asked for more than there is memory or patience for. (The parser takes tokens as they are made,
  // so each of these is in a place where it would go on accepting them.)
  const runaway: [string, string, string][] = [
    [
      "forty macros that each double the one before",
      `#define X0 1,\n${Array.from({ length: 39 }, (_, i) => `#define X${i + 1} X${i} X${i}\n`).join("")}int a[] = { X39 };\n`,
      "macro expansion produces too many tokens",
    ],
    [
      "five thousand nested invocations",
      `#define F(x) x\n${"F(".repeat(5000)}1${")".repeat(5000)}`,
      "macro expansion is nested too deeply",
    ],
    [
      "a chain of thirty thousand macros",
      `${Array.from({ length: 30000 }, (_, i) => `#define C${i} C${i + 1}\n`).join("")}C0`,
      "nested too deeply",
    ],
    ["a hundred thousand #if without #endif", "#if 1\n".repeat(100_000), "unterminated conditional directive"],
  ];
  for (const [what, source, message] of runaway) {
    test.concurrent(what, async () => {
      const { stdout, stderr, exitCode } = await firstError(source);
      expect(stderr).toContain(message);
      expect(stdout).toBe("");
      expect(exitCode).not.toBe(0);
    });
  }

  // Just under those limits is an ordinary program.
  test.concurrent("a thousand additions and two hundred parentheses compile and run", async () => {
    const source = `int printf(const char *, ...);
int chain(int x) { return x${" + x".repeat(990)}; }
int nested(void) { return ${"(".repeat(240)}7${")".repeat(240)}; }
int main(void) { printf("%d %d\\n", chain(2), nested()); return 0; }`;
    const { stdout, stderr, exitCode } = await firstError(source);
    expect(lines(stdout), stderr).toBe("1982 7\n");
    expect(exitCode).toBe(0);
  });
  for (const [what, source, message] of deep) {
    test.concurrent(`five thousand levels of ${what}`, async () => {
      const { stdout, stderr, exitCode } = await firstError(source);
      expect(stderr).toContain(message);
      expect(stdout).toBe("");
      expect(exitCode).not.toBe(0);
    });
  }
});
