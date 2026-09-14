import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { sep } from "node:path";
import cases from "./fixtures/diagnostics/cases.json";
import { lines, meets, repeated, run, supported } from "./run-fixtures";

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
      test.concurrent.skipIf(!meets(requires))(`${index}: ${about}: ${message.slice(0, 60)}`, async () => {
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
      "what is not valid C but every compiler lets pass: a string longer than its array, an escape nobody defines",
      `int puts(const char *);
char three[3] = "abcdef";
int main(void) { if (three[2] == 'c' && "\\q"[0] == 'q') puts("ran"); return 0; }
`,
      [
        "warn: initializer string is too long for the array\n   at test.c:2:17\n",
        "warn: unknown escape sequence '\\q'\n   at test.c:3:41\n",
      ],
    ],
    [
      "a case range that names no value",
      `int puts(const char *);
int f(int c) { switch (c) { case 5 ... 1: return 1; case 2 ... 2: return 2; } return 0; }
int main(void) { if (f(3) == 0 && f(5) == 0 && f(1) == 0 && f(2) == 2) puts("ran"); return 0; }
`,
      ["warn: empty case range\n   at test.c:2:29\n"],
    ],
    [
      "more elements than a vector has lanes",
      `int puts(const char *);
typedef int v4 __attribute__((vector_size(16)));
int main(void) { v4 a = { 0, 1, 2, 3, 4 }; if (a[3] == 3) puts("ran"); return 0; }
`,
      ["warn: excess elements in vector initializer\n   at test.c:3:25\n"],
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
    test.concurrent.skipIf(!meets(requires))(`a warning for ${what}`, async () => {
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

  // What any real program stays far inside of. (How deep is too deep depends on how much stack the thread that
  // compiles has left, and a debug build uses several times a release build's.)
  test.concurrent("five hundred additions and a hundred parentheses compile and run", async () => {
    const source = `int printf(const char *, ...);
int chain(int x) { return x${repeated(" + x", 500)}; }
int nested(void) { return ${repeated("(", 100)}7${repeated(")", 100)}; }
int blocks(int v) { ${repeated("{", 100)} v++; ${repeated("}", 100)} return v; }
int main(void) { printf("%d %d %d\\n", chain(2), nested(), blocks(1)); return 0; }`;
    const { stdout, stderr, exitCode } = await firstError(source);
    expect(lines(stdout), stderr).toBe("1002 7 2\n");
    expect(exitCode).toBe(0);
  });
});
