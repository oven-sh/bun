import { expect } from "bun:test";
import { casesOfOneRun, sayOf } from "./harness/cases-of-one-run";
import { test } from "./supported";

// The text that a compiled test run keeps for a function kept `enum Inner { .. }` as it is written, which no engine reads, and `side` where `namespace Box` exports
// the variable, which is `Box.side` in what runs. Executables: parallel/function-source-evaluated-again.
const project = casesOfOneRun("test-run-function-source-enum-namespace", {
  "package.json": `{ "name": "p", "type": "module" }`,
});

function runsAsPlain(title: string, expected: string, typed: string, probe: string) {
  const name = project.add(
    name => `
      import { test } from "bun:test";
      import * as typed from "./typed.ts";
      ${sayOf(name)}
      const again = (made, Box) => (0, eval)("(function (Box) { return (" + String(made) + "); })")(Box);
      function attempt(run) { try { return JSON.stringify(run()); } catch (error) { return error.constructor.name; } }
      test("${name}", () => say(${probe}));`,
    { "typed.ts": typed },
  );
  test(title, async () => {
    const plain = (await project.ran()).get(name);
    expect(plain?.printed).toBe(expected + "\n");
    expect((await project.ran(["--debug-aot"])).get(name)).toEqual(plain);
  });
}

runsAsPlain(
  "an enum that is declared in the function",
  `[8,"B","s","7,8,A,B,S"]`,
  `export function pick() { enum Inner { A = 7, B, S = "s" } return [Inner.B, Inner[8], Inner.S, Object.keys(Inner).join()]; }`,
  `attempt(() => again(typed.pick)())`,
);

runsAsPlain(
  "an initializer that runs, and names a member",
  `[3,10,"D"]`,
  `function three() { return 3; }
   export function pick(f = three) { enum Inner { A = 7, C = f(), D = f() + A} return [Inner.C, Inner.D, Inner[10]]; }`,
  `attempt(() => again(typed.pick)(() => 3))`,
);

runsAsPlain(
  "a variable that a namespace exports is read and stored on its object",
  `[[9,11],{"side":3,"count":11}]`,
  `export namespace Box { export let side = 4; export let count = 0; export function area() { count++; return [side * side, count]; } }`,
  `attempt(() => { const other = { side: 3, count: 10 }; return [again(typed.Box.area, other)(), other]; })`,
);
