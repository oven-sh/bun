import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { endChildren, longLimit, spawn } from "../children";

afterAll(endChildren);

const compilerOptions = {
  strict: true,
  target: "esnext",
  module: "preserve",
  moduleResolution: "bundler",
  noEmit: true,
  skipLibCheck: true,
  lib: ["esnext"],
  types: [],
};

const ring = `export type Is<X> = X extends Crate<number> ? { yes: 1 } : { no: 2 };
export interface Crate<T> { put: (x: T) => void; kind: Is<Crate<string>>; }
`;
const importOfRing = `import type { Is, Crate } from "./ring";\n`;
const readers = {
  "assigned.ts": `${importOfRing}export function assigned(wide: Crate<string | number>): Crate<string> { return wide; }\n`,
  "alias.ts": `${importOfRing}export const alias: { yes: 1 } | null = null as unknown as Is<Crate<string>>;\n`,
  "member.ts": `${importOfRing}export const member: { no: 2 } | undefined = (globalThis as any as { none?: Crate<string> }).none?.kind;\n`,
  "right.ts": `${importOfRing}export const right: { yes: 1 } | undefined = (globalThis as any as { none?: Crate<string> }).none?.kind;\n`,
};
const main = `import "./ring";\nimport "./assigned";\nimport "./alias";\nimport "./member";\nimport "./right";\n`;

const classes = `export type Peel<X> = X extends Wrap<number> ? { n: number } : { n: string };
export abstract class Schema<O> { private made: ((x: O) => void) | null = null; readonly out!: O; check(x: O): boolean { return this.made === null; } opt(): Wrap<this["out"]> { return new Wrap<this["out"]>(null); } }
export class Wrap<T> extends Schema<T | undefined> { private own: T | null = null; readonly kind: Peel<Wrap<string>>; set: ((x: T) => void) | null = null; constructor(k: any) { super(); this.kind = k; } }
export class Text extends Schema<string> { private n = 1; }
`;
const member = (type: string) =>
  `import type { Wrap } from "./classes";\nexport const member: { n: ${type} } | undefined = (globalThis as any as { none?: Wrap<string> }).none?.kind;\n`;

test.each([
  [
    "a file that declares the type comes first",
    { "ring.ts": ring, "main.ts": main, ...readers },
    ["alias.ts(2,14): error TS2741", "member.ts(2,14): error TS2322"],
  ],
  [
    "a file that measures comes first",
    { "ring.ts": `import "./assigned";\n${ring}`, "main.ts": main, ...readers },
    ["alias.ts(2,14): error TS2741", "member.ts(2,14): error TS2322"],
  ],
  [
    "classes",
    {
      "classes.ts": classes,
      "alias.ts": `import type { Peel, Wrap } from "./classes";\nexport const alias: { n: string } | undefined = null as unknown as Peel<Wrap<string>>;\n`,
      "number.ts": member("number"),
      "string.ts": member("string"),
      "main.ts": `import "./alias";\nimport "./number";\nimport "./string";\n`,
    },
    ["string.ts(2,14): error TS2322"],
  ],
])(
  "a type that asks for the variances measured around it is the same on any number of threads: %s",
  async (_, files, errors) => {
    using dir = tempDir("bun-check-variances-measured-around", {
      "tsconfig.json": JSON.stringify({ compilerOptions, files: ["main.ts"] }),
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
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { threads, errors: (stdout + stderr).match(/^\w+\.ts\(\d+,\d+\): error TS\d+/gm), exitCode };
    };
    for (const threads of [1, 2, 8, 16, 32]) {
      for (const result of await Promise.all([check(threads), check(threads), check(threads)])) {
        expect(result).toEqual({ threads, errors, exitCode: 1 });
      }
    }
  },
  longLimit,
);
