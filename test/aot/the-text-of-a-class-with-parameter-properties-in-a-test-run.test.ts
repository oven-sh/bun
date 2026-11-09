import { expect } from "bun:test";
import { casesOfOneRun, sayOf } from "./harness/cases-of-one-run";
import { test } from "./supported";

// `class Point { constructor(public x: number) {} }`: the text that a compiled test run keeps for the class lacked the field and the store, so the class
// that the text makes when it is evaluated again stored nothing. Executables: parallel/the-text-of-a-function-evaluated-again.
const project = casesOfOneRun("the-text-of-a-class-with-parameter-properties-in-a-test-run", {
  "package.json": `{ "name": "p", "type": "module" }`,
});

function runsAsPlain(title: string, expected: string, classes: string, probe: string) {
  const name = project.add(
    name => `
      import { test } from "bun:test";
      import * as classes from "./classes.ts";
      ${sayOf(name)}
      const again = (made, ...above) => (0, eval)("(function (Above) { return (" + String(made) + "); })")(...above);
      test("${name}", () => say(${probe}));`,
    { "classes.ts": classes },
  );
  test(title, async () => {
    const plain = (await project.ran()).get(name);
    expect(plain?.printed).toBe(expected + "\n");
    expect((await project.ran(["--debug-aot"])).get(name)).toEqual(plain);
  });
}

runsAsPlain(
  "a class without a parent",
  `{"x":5,"y":2} true`,
  `export class Point { constructor(public x: number, readonly y: number = 2) {} }`,
  `JSON.stringify(new (again(classes.Point))(5)), String(classes.Point).includes("this.x")`,
);

runsAsPlain(
  "the stores stand behind super(..)",
  `2b a,b`,
  `export class Above { constructor(protected a: number) {} get it() { return this.a; } }
   export class Below extends Above { constructor(a: number, private b: string = "b") { super(a + 1); } both() { return this.it + this.b; } }`,
  `new (again(classes.Below, classes.Above))(1).both(), Object.keys(new (again(classes.Below, classes.Above))(1)).join()`,
);

runsAsPlain(
  "the fields come in front of every other field",
  `given,first,last`,
  `export class Early { first = 1; constructor(public given: number) {} last = 2; }`,
  `Object.keys(new (again(classes.Early))(7)).join()`,
);

runsAsPlain(
  "a method that starts where the fields are added keeps its own text",
  `1 true`,
  `export class Tight{first(){return 1}constructor(public held:number){}}`,
  `(0, eval)("({" + String(classes.Tight.prototype.first) + "})").first(), String(classes.Tight.prototype.first).startsWith("first(")`,
);
