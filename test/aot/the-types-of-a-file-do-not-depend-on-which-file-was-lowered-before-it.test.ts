// A build lowers each file right after it has visited it, and the next file is checked by the same checker, or by one that reads what the first has stored.
// So nothing that a lowering asks may leave behind an answer that the type checker itself would not have given.
// `other/early.ts` isn't type checked, because its tsconfig.json has another `lib` than the entry point's, so its lowering is the first to ask for the types in it.
// `later.ts` imports it, so it's checked after that. With Bun's declarations installed, `bun check` isn't asked about what the build finds.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

const env = { ...bunEnv, NO_COLOR: "1" };

const configuration = (lib: string[]) =>
  JSON.stringify({
    compilerOptions: {
      strict: true,
      types: ["bun"],
      lib,
      module: "esnext",
      moduleResolution: "bundler",
      target: "esnext",
      noEmit: true,
      skipLibCheck: true,
    },
  });

const files = {
  "package.json": `{ "name": "made-up", "private": true, "type": "module" }\n`,
  "tsconfig.json": configuration(["ESNext", "DOM"]),
  "other/tsconfig.json": configuration(["ESNext"]),
  "node_modules/@types/bun/package.json": `{ "name": "@types/bun", "version": "1.3.0", "types": "index.d.ts" }\n`,
  "node_modules/@types/bun/index.d.ts": `declare module "bun" {\n  export const version: string;\n}\n`,
  "node_modules/outcomes/package.json": `{ "name": "outcomes", "version": "1.0.0", "type": "module", "main": "./index.js", "types": "./index.d.ts" }\n`,
  "node_modules/outcomes/index.js": `export const good = value => ({ ok: true, value });
export const bad = error => ({ ok: false, error });
export const handle = cases => self => (self.ok || !cases[self.error.tag] ? self : cases[self.error.tag](self.error));
export const through = (value, step) => step(value);
`,
  // The constraint of `Cases` names `keyof Cases`.
  "node_modules/outcomes/index.d.ts": `export interface Outcome<out A, out E> {
  readonly ok: boolean;
  readonly value?: A;
  readonly error?: E;
}
export declare const good: <A>(value: A) => Outcome<A, never>;
export declare const bad: <E>(error: E) => Outcome<never, E>;
export declare const handle: <
  E,
  Cases extends {
    [K in Extract<E, { tag: string }>["tag"]]+?: (error: Extract<E, { tag: K }>) => Outcome<any, any>;
  } & (unknown extends E ? {} : { [K in Exclude<keyof Cases, Extract<E, { tag: string }>["tag"]>]: never }),
>(
  cases: Cases,
) => <A>(
  self: Outcome<A, E>,
) => Outcome<
  A | { [K in keyof Cases]: Cases[K] extends (...args: Array<any>) => Outcome<infer B, any> ? B : never }[keyof Cases],
  Exclude<E, { tag: keyof Cases }>
>;
export declare const through: <A, B>(value: A, step: (value: A) => B) => B;
`,
  "other/early.ts": `import { bad, good, handle, through, type Outcome } from "outcomes";
type Trouble = { tag: "Lost"; where: string } | { tag: "Late"; by: number };
const look = (n: number): Outcome<number, Trouble> =>
  n > 1 ? good(n) : n === 1 ? bad({ tag: "Late", by: n }) : bad({ tag: "Lost", where: "here" });
export const early = (n: number) =>
  through(look(n), handle({ Lost: error => good(error.where.length), Late: error => good(error.by) }));
`,
  "later.ts": `import { early } from "./other/early";
import { bad, good, handle, through, type Outcome } from "outcomes";
type Failure = { tag: "One"; code: number } | { tag: "Two"; text: string };
const source = (n: number): Outcome<number, Failure> =>
  n > 0 ? good(n) : n < 0 ? bad({ tag: "One", code: n }) : bad({ tag: "Two", text: "zero" });
export const later = (n: number) =>
  through(source(n), handle({ One: error => good(error.code), Two: error => good(error.text.length) }));
export const both = (n: number) => [early(n).value, later(n).value];
`,
  "main.ts": `import { both } from "./later";
console.log(JSON.stringify([both(-3), both(0), both(1), both(2)]));
`,
};

const errors = (text: string) => text.split("\n").filter(line => /\bTS\d+\b/.test(line));

describe.skipIf(!!unsupported)("a parameter keeps the type that its context gives it", () => {
  for (const threads of [1, 2, 4]) {
    test(`bun check --aot on ${threads} threads`, () =>
      slot(async () => {
        using dir = tempDir("aot-lowered-before-it", files);
        const checked = await spawned(
          [bunExe(), "check", "--no-pretty", "--aot", `--threads=${threads}`, "./main.ts"],
          String(dir),
          env,
        );
        expect({ errors: errors(checked.stdout + checked.stderr), exitCode: checked.exitCode }).toEqual({
          errors: [],
          exitCode: 0,
        });
      }));

    test(`a build on ${threads} threads`, () =>
      slot(async () => {
        using dir = tempDir("aot-lowered-before-it", files);
        const folder = String(dir);
        const built = await spawned(
          [
            bunExe(),
            "build",
            "--compile",
            "--aot",
            `--aot-threads=${threads}`,
            ...withoutDebugInformation,
            "./main.ts",
            "--outfile",
            "main",
          ],
          folder,
          env,
        );
        expect({ errors: errors(built.stderr), exitCode: built.exitCode }).toEqual({ errors: [], exitCode: 0 });
        const ran = await spawned([join(folder, isWindows ? "main.exe" : "main")], folder, env);
        expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
          stdout: "[[4,-3],[4,4],[1,1],[2,2]]\n",
          exitCode: 0,
        });
      }));
  }
});
