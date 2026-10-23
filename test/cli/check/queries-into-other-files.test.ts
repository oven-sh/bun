// The check of a file asks for the types of declarations in other files. That runs checks on the syntax of the other
// file: here `first.ts` needs the type of `late`, so the type arguments of the call in `second.ts` are checked while
// `first.ts` is. What those checks record for the end of a file's check belongs to `second.ts`. The check of `first.ts`
// took it for its own, and read a node of `second.ts` as the node of `first.ts` with the same number.
import { afterAll, describe, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { endChildren, spawn } from "../children";
import { linesOf, tsc, env as withoutAgents } from "./differential";

afterAll(endChildren);

const env = {
  ...withoutAgents,
  GITHUB_WORKSPACE: undefined,
  // Of the script that runs the tests.
  npm_lifecycle_event: undefined,
  npm_package_json: undefined,
  BUN_INTERNAL_SCRIPTS_OF_COMMANDS: undefined,
  BUN_INTERNAL_CHECK_SCRIPTS: undefined,
};

// A debug build reads and checks the library in seconds: the smallest one, and unchecked.
const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    types: [],
    lib: ["es5"],
    skipLibCheck: true,
    module: "esnext",
    moduleResolution: "bundler",
  },
  files: ["first.ts", "second.ts"],
});

/** `errors`: what `bun check` and `tsc` print. */
type Program = { files: Record<string, string>; errors: string[] };
const programs: Record<string, Program> = {
  // The first pattern property of `second.ts` was read as one of `first.ts`, which has none.
  "a renamed binding element in a type of another file": {
    files: {
      "first.ts": `const early = late;
`,
      "second.ts": `declare function f<T>(): T;
const late = f<({ a: b }: { a: string }) => typeof b>();
`,
    },
    errors: [],
  },
  // `{ x: y }` is the first pattern property of `first.ts`, and it got TS2842 as if it were in a type.
  "a renamed binding element in a type of another file, next to a pattern of the checked file": {
    files: {
      "first.ts": `function h({ x: y }: { x: number }): void {}
const early = late;
`,
      "second.ts": `declare function f<T>(): T;
const late = f<({ a: b }: { a: string }) => typeof b>();
`,
    },
    errors: [],
  },
  "the default of a binding element in a type of another file": {
    files: {
      "first.ts": `const early = late;
const wrong: number = "s";
`,
      "second.ts": `declare function f<T>(): T;
const late = f<({ a: b = 1 }: { a?: number }) => typeof b>();
`,
    },
    errors: ["first.ts(2,7): error TS2322: Type 'string' is not assignable to type 'number'."],
  },
  "the computed name of a binding element in a type of another file": {
    files: {
      "first.ts": `const early = late;
const wrong: number = "s";
`,
      "second.ts": `declare function f<T>(): T;
declare const k: "a";
const late = f<({ [k]: b }: { a: string }) => typeof b>();
`,
    },
    errors: ["first.ts(2,7): error TS2322: Type 'string' is not assignable to type 'number'."],
  },
};

const written = ({ files }: Program) => ({ "tsconfig.json": tsconfig, ...files });

/** What `bun check` prints for `program`, by line, and its exit code. */
async function check(program: Program, args: string[] = []) {
  using dir = tempDir("bun-check-other-files", written(program));
  await using proc = spawn({
    cmd: [bunExe(), "check", ...args],
    cwd: String(dir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // A crash: the test that asserts the exit code says nothing about why.
  if (exitCode !== 0 && exitCode !== 1)
    console.error(`bun check ${args.join(" ")} exited with ${exitCode}:\n${stderr}`);
  return { errors: stdout.split(/\r?\n/).filter(line => line.trim()), exitCode };
}

describe("bun check, a query that checks the syntax of another file", () => {
  for (const [title, program] of Object.entries(programs)) {
    test.concurrent(`records nothing for the checked file: ${title}`, async () => {
      const expected = { errors: program.errors, exitCode: program.errors.length ? 1 : 0 };
      // One thread checks `first.ts` first, so it is the one to ask. With more threads either file's check can be.
      const [onOneThread, byDefault] = await Promise.all([check(program, ["--threads=1"]), check(program)]);
      expect(onOneThread).toEqual(expected);
      expect(byDefault).toEqual(expected);
    });
  }

  test.skipIf(!tsc)("tsc prints what these tests say it prints", async () => {
    for (const [title, program] of Object.entries(programs)) {
      using dir = tempDir("bun-check-other-files", written(program));
      const root = String(dir);
      const errors = await linesOf([tsc!, "--pretty", "false", "--singleThreaded"], root, root);
      expect({ title, errors }).toEqual({ title, errors: program.errors });
    }
  });
});
