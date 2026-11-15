import { expect } from "bun:test";
import { casesOfOneRun, sayOf } from "./harness/cases-of-one-run";
import { test } from "./supported";

// `enum Color { Green = 5 }  function pick() { return Color.Green; }`: the text that a compiled test run keeps for the function went on naming the enum,
// which nobody finds where the text is evaluated again. `bun test` has the value in the place of the read. Executables: parallel/function-source-evaluated-again.
const project = casesOfOneRun("test-run-function-source-enum-read", {
  "package.json": `{ "name": "p", "type": "module" }`,
});

function runsAsPlain(title: string, expected: string, typed: string, probe: string) {
  const name = project.add(
    name => `
      import { test } from "bun:test";
      import * as typed from "./typed.ts";
      ${sayOf(name)}
      const again = made => (0, eval)("(" + String(made) + ")");
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
  "numbers and texts, by name and by key",
  `"6low"`,
  `enum Color { Red = 1, Green = 5 }
   enum Tone { Low = "low" }
   export function pick() { return Color.Green + Color["Red"] + Tone.Low; }`,
  `attempt(() => again(typed.pick)())`,
);

runsAsPlain(
  "a negative number beside an operator, a member of a number",
  `[4,"5.0",-1]`,
  `enum Level { Low = -1, Mid = 5 }
   export function pick(x: number) { return [x-Level.Low, Level.Mid.toFixed(1), (Level as any).Low]; }`,
  `attempt(() => again(typed.pick)(3))`,
);

runsAsPlain(
  "a parameter that bears the name of the enum is read where the text runs",
  `"given"`,
  `enum Color { Green = 5 }
   export function pick(Color: { Green: string }) { return Color.Green; }
   export const kept = Color.Green;`,
  `attempt(() => again(typed.pick)({ Green: "given" }))`,
);
