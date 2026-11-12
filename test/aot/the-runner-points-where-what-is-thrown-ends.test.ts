// For an error that a test throws, `bun test` prints the frame of the throw at the place where what is thrown ends: the `)` of
// `new Error(..)`, the name of a member, the last operand. Over lines that is another line than the one of `throw`.
// `bun test --aot` prints the same place.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { spawned } from "./harness/commands";
import { test } from "./supported";

const thrown: Record<string, string> = {
  "in-one-line": `new Error("from the body")`,
  "over-lines": `new Error(\n    "over lines",\n  )`,
  "without-arguments": `new Error`,
  "a-member": `held.error`,
  "an-element": `held.list[0]`,
  "a-call-over-lines": `held\n    .make(1)`,
  "under-an-assertion": `(held.error as Error)!`,
  "the-last-operand": `flag && held.error`,
};
const fileOf = (what: string) => `import { test } from "bun:test";
const held = { error: new RangeError("held"), list: [new RangeError("listed")], make(a: number) { return new RangeError("made" + a); } };
const flag = Object(1);
function thrower() {
  throw ${what};
}
test("throws", () => {
  thrower();
});
`;
const env = { ...bunEnv, NO_COLOR: "1" };
const framesOfThrows = (printed: string) =>
  [...printed.matchAll(/^ +at thrower \(.*?([\w-]+\.test\.ts:\d+:\d+)\)$/gm)].map(match => match[1]).sort();

test("the frame of a throw, as bun test prints it", async () => {
  using dir = tempDir("aot-where-the-runner-points", {
    "package.json": `{ "name": "where-the-runner-points", "private": true }`,
    ...Object.fromEntries(Object.entries(thrown).map(([name, what]) => [`${name}.test.ts`, fileOf(what)])),
  });
  const plain = await spawned([bunExe(), "test"], String(dir), env, 90_000);
  const compiled = await spawned([bunExe(), "test", "--aot"], String(dir), env, 300_000);
  const expected = framesOfThrows(plain.stderr);
  expect(expected).toContain("over-lines.test.ts:7:3");
  expect(expected.length).toBe(Object.keys(thrown).length);
  expect(framesOfThrows(compiled.stderr)).toEqual(expected);
}, 400_000);
