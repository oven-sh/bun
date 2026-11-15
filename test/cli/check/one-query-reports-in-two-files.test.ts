import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

// The base types of an interface are resolved once for all its declarations, so one evaluation reports TS2312 in every file
// that declares a wrong base. Above one thread the larger files are checked first, and `slow` keeps the check of the first
// file busy until the others are done. So a later file is the first to ask for the base types and the first to be through.
// It leaves the error in the first file to that file's own check, which must still get to report it.

const options = {
  strict: true,
  noEmit: true,
  target: "esnext",
  module: "esnext",
  moduleResolution: "bundler",
  lib: ["esnext"],
  types: [],
  skipLibCheck: true,
};

const slow = (prefix: string) => `type ${prefix}Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
type ${prefix}Four = \`\${${prefix}Digit}\${${prefix}Digit}\${${prefix}Digit}\${${prefix}Digit}\`;
type ${prefix}Turn<T, Mark extends string> = T extends \`\${infer Head}\${infer Rest}\` ? \`\${Rest}\${Head}\${Mark}\` : never;
type ${prefix}Slow = ${"abcdefgh".split("").reduce((inner, mark) => `${prefix}Turn<${inner}, "${mark}">`, `${prefix}Four`)};
`;
const large = (prefix: string) =>
  Array.from({ length: 400 }, (_, i) => `declare const ${prefix}${i}: number;\n`).join("");

const first = `${slow("First")}type U = string | number;\ninterface Merged extends U { one: number }\n`;
const declaresToo = `type V = string | number;\ninterface Merged extends V { two: number }\n`;
const asks = `declare const merged: Merged;\nmerged.two;\n`;
const at = (place: string) =>
  `${place}: error TS2312: An interface can only extend an object type or intersection of object types with statically known members.`;

test.concurrent.each([
  [
    "the later of the two asks first",
    { "first.ts": first, "second.ts": declaresToo + asks + large("s") },
    [at("first.ts(6,26)"), at("second.ts(2,26)")],
  ],
  [
    "a file between the two asks first",
    { "first.ts": first, "middle.ts": asks + large("m"), "last.ts": declaresToo + slow("Last") },
    [at("first.ts(6,26)"), at("last.ts(2,26)")],
  ],
  [
    "the later of the two is a declaration file that is not checked",
    { "first.ts": first, "middle.ts": asks + large("m"), "last.d.ts": declaresToo },
    [at("first.ts(6,26)")],
  ],
] as const)("reports what one evaluation finds in two files on every thread count: %s", async (_, files, expected) => {
  using dir = tempDir("bun-check-two-files", {
    "tsconfig.json": JSON.stringify({ compilerOptions: options, files: Object.keys(files) }),
    ...files,
  });
  const check = async (threads: number) => {
    await using proc = spawn({
      cmd: [bunExe(), "check", "--threads", String(threads)],
      cwd: String(dir),
      env: {
        ...bunEnv,
        AGENT: "0",
        CLAUDECODE: undefined,
        REPL_ID: undefined,
        GITHUB_ACTIONS: undefined,
        NO_COLOR: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { errors: stdout.trim().split("\n"), exitCode };
  };
  for (const result of await Promise.all([1, 2, 2, 2, 3, 8, 8, 8].map(check))) {
    expect(result).toEqual({ errors: [...expected], exitCode: 1 });
  }
});
