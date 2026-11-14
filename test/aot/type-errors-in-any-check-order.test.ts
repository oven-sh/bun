// Which file of a program is checked first depends on the timing of the threads. `--aot-testing=CheckOrder=<odd number>` sets the order.
// The type errors must be the same in every order.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";

const env = { ...bunEnv, NO_COLOR: "1" };
const build = (folder: string, ...words: string[]) =>
  spawned(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      ...["NoExecutable", ...words].map(word => `--aot-testing=${word}`),
      "./main.ts",
    ],
    folder,
    env,
  );

const files = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { strict: true, target: "esnext", module: "esnext", moduleResolution: "bundler", noEmit: true },
  }),
  "main.ts": `import "sizes";
import { left } from "./left";
export const all = [left];
`,
  // The build compiles the TypeScript of a package and doesn't check it. So the first request for the types of measure.ts may come
  // from the code generated for this file.
  "node_modules/sizes/package.json": JSON.stringify({ name: "sizes", version: "1.0.0", main: "index.ts" }),
  "node_modules/sizes/index.ts": `import { countArguments, measure } from "../../measure";
export async function print() {
  console.log((await measure()) + 1, (await countArguments()) + 1);
}
await print();
`,
  "measure.ts": `import { take, within } from "./take";
export async function measure() {
  const taken = await within(() => take({ read: async () => 1 }));
  return taken.size;
}
export async function countArguments() {
  const taken = await within(() => take({ read: async () => "" }, 2));
  return taken.size;
}
`,
  "take.ts": `export async function take(options: { read: () => Promise<string> }): Promise<{ size: number }> {
  return { size: (await options.read()).length };
}
export function within<T>(run: () => Promise<T>): Promise<T> {
  return run();
}
`,
  "left.ts": `import { right } from "./right";
export const left = () => right();
`,
  "right.ts": `import { left } from "./left";
export const right = () => left();
`,
};

describe.skipIf(!!unsupported)("--aot-testing=CheckOrder", () => {
  test("the type errors are the same in every order", () =>
    slot(async () => {
      using dir = tempDir("aot-check-order", files);
      const orders = [1, 4294967295, 2654435769, 1234567891];
      const words = [...orders.map(order => [`CheckOrder=${order}`]), ["CheckOrder=4294967295", "DiscardsFirstVisits"]];
      const reported: Record<string, string[]> = {};
      for (const each of words) {
        const { stderr } = await build(String(dir), ...each);
        const errors = [...stderr.matchAll(/^error: (TS\d+): .*(?:\n  .*)*\n +at .*?(\w+\.ts):(\d+)/gm)];
        reported[each.join()] = errors.map(([, code, file, line]) => `${file}:${line} ${code}`).sort();
      }
      const expected = ["left.ts:2 TS7023", "measure.ts:3 TS2322", "measure.ts:7 TS2554", "right.ts:2 TS7023"];
      expect(reported).toEqual(Object.fromEntries(words.map(each => [each.join(), expected])));
    }));

  for (const order of ["", "0", "2", "first"]) {
    test(`CheckOrder=${order} is refused`, () =>
      slot(async () => {
        using dir = tempDir("aot-check-order", files);
        const { stderr, exitCode } = await build(String(dir), `CheckOrder=${order}`);
        expect(stderr).toContain(`CheckOrder=${order}: takes an odd number`);
        expect(exitCode).toBe(1);
      }));
  }
});
