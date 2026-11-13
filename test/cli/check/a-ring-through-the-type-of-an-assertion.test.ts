import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

// The members of `Shop.Gadget` have computed names, whose types come from `keys.ts`, where the type written behind `as` asks for a
// member of `Shop.Gadget` again. Whoever goes around that ring reports it: TypeScript 7 does, from `early.ts`, the first file.
// The written type was once looked through at the assertion only where something was already being resolved. The check of
// `keys.ts` itself has nothing in resolution there, so it stored the type and closed no ring, and when it came first, on another
// thread, nobody ever went around: one program had three reports.

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

const files = {
  "early.ts": `export function use(gadget: Shop.Gadget) {\n  return gadget.start();\n}\n`,
  "gadget.ts": `import keys from "./keys";
const kFirst: typeof keys.kFirst = keys.kFirst;
const kSecond: typeof keys.kSecond = keys.kSecond;
declare global {
  namespace Shop {
    interface Base {
      start(): number;
    }
    interface Gadget extends Base {
      [kFirst]?: number;
      [kSecond]?: string;
    }
  }
}
export function make(): Shop.Gadget {
  return { [kFirst]: 1, [kSecond]: "two", start() { return 2; } };
}
keys.startOfGadget = make().start;
`,
  "keys.ts": `export default {
  kFirst: Symbol("first"),
  kSecond: Symbol("second"),
  startOfGadget: undefined,
} as unknown as {
  readonly kFirst: unique symbol;
  readonly kSecond: unique symbol;
  startOfGadget: Shop.Gadget["start"] | undefined;
};
`,
  "main.ts": `import { use } from "./early";\nimport { make } from "./gadget";\nimport keys from "./keys";\nexport const all = [use(make()), typeof keys.startOfGadget];\n`,
};

test("a ring through the type of an assertion is reported on every thread count", async () => {
  using dir = tempDir("bun-check-ring-through-an-assertion", {
    "tsconfig.json": JSON.stringify({ compilerOptions: options, files: ["main.ts"] }),
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
    return { threads, errors: stdout.trim().split("\n"), exitCode };
  };
  for (const threads of [1, 2, 4, 16]) {
    for (const result of await Promise.all(Array.from({ length: 8 }, () => check(threads)))) {
      expect(result).toEqual({
        threads,
        errors: [
          "gadget.ts(3,7): error TS2502: 'kSecond' is referenced directly or indirectly in its own type annotation.",
          "keys.ts(1,1): error TS7022: 'default' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.",
        ],
        exitCode: 1,
      });
    }
  }
});
