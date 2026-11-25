// Plain Bun drops what it does not understand of these and runs the rest.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const rejected = [
  {
    error: "TS2680: A 'this' parameter must be the first parameter.",
    declaration: `function between(first, this: any, second) { return first * 10 + second; }`,
    read: `between(1, 2)`,
    plain: "12",
  },
  {
    error: "TS1005: '{' expected.",
    declaration: `class Box { get size(): number; width = 2; }`,
    read: `Object.getOwnPropertyNames(Box.prototype).join()`,
    plain: "constructor",
  },
  {
    error: "TS2300: Duplicate identifier 'content-type'.",
    declaration: `enum Header { "content-type" = 1, "content-type" = 2 }`,
    read: `Header["content-type"]`,
    plain: "2",
  },
];
const env = { ...bunEnv, NO_COLOR: "1" };

for (const { error, declaration, read, plain } of rejected) {
  test(`${error} It stops the build, also under // @ts-nocheck`, async () => {
    using dir = tempDir("tsc-rejects", { "main.ts": `// @ts-nocheck\n${declaration}\nconsole.log(${read});\n` });
    expect((await run([bunExe(), "main.ts"], String(dir), env)).stdout).toBe(plain + "\n");
    const built = await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "out"], String(dir), env);
    expect([...built.stderr.matchAll(/^error: (TS.*)$/gm)].map(match => match[1])).toEqual([error]);
    expect(built.exitCode).toBe(1);
  });

  test(`${error} It fails its file in a test run, and no other`, async () => {
    using dir = tempDir("tsc-rejects-in-a-test-run", {
      "rejected.test.ts": `// @ts-nocheck\nimport { expect, test } from "bun:test";\n${declaration}\ntest("rejected", () => expect(String(${read})).toBe("${plain}"));\n`,
      "other.test.ts": `import { test } from "bun:test";\ntest("other", () => {});\n`,
    });
    expect((await run([bunExe(), "test"], String(dir), env)).stderr).toMatch(/^ *2 pass$/m);
    const { stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), env);
    expect(stderr).toContain("SyntaxError: " + error.slice(error.indexOf(" ") + 1));
    expect(stderr).toContain("(pass) other");
    expect(stderr).toMatch(/^ *1 fail$/m);
    expect(exitCode).toBe(1);
  });
}

// tsc reports these in its checker alone (TS2304: Cannot find name 'const'), so the build goes on under // @ts-nocheck.
test("The type that follows `as const` is dropped as plain Bun drops it", async () => {
  const values = [
    `"NEW" as const | "X"`,
    `"NEW" as const\n  | "Y"`,
    `<const | "X">"NEW"`,
    `([1] as const[]).length`,
    `"Q" as const extends 1 ? 1 : 2`,
    `3 as const ? +1 : 2`,
    `3 as const << 2`,
  ];
  using dir = tempDir("as-const", { "main.ts": `// @ts-nocheck\nconsole.log(\n  ${values.join(",\n  ")},\n);\n` });
  const plain = await run([bunExe(), "main.ts"], String(dir), env);
  expect(plain.stdout).toBe("NEW NEW NEW 1 Q 1 12\n");
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "out"], String(dir), env);
  expect(built.stderr).not.toContain("error: ");
  expect(built.exitCode).toBe(0);
  expect(await run(["./out"], String(dir), env)).toEqual(plain);
});
