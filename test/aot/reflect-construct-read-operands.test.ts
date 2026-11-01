import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { built, spawned } from "./harness/commands";
import { printIR, test, writesProgramInto } from "./harness/printed-ir";

// What compilers emit for `super(..)` in a class that they turn into functions, with both functions read at run time.
const classes = (constructs: string, helpers = "") => `"use strict";
${helpers}
function A() { this.z = 1; }
A.prototype.base = function () { return this.z; };
function B(a) { var self = ${constructs}; self.a = a; return self; }
B.prototype = Object.create(A.prototype);
B.prototype.constructor = B;
Object.setPrototypeOf(B, A);
function turn(i) { var v = new B(i); return v.a + v.base(); }
function bench(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += turn(i & 7);
  return sum;
}
console.log(bench(1000));
`;
// The helper replaces itself at its first call, and both reads go through it: what flow holds for its answer is every object that stands above anything.
const above = `function above(o) {
  return above = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function (o) { return o.__proto__ || Object.getPrototypeOf(o); }, above(o);
}
function constructAbove(self, below) {
  return below = above(below), Reflect.construct(below, [], above(self).constructor);
}`;
const programs: Record<string, { text: string; functions: string[] }> = {
  "the function above is read": {
    text: classes("Reflect.construct(Object.getPrototypeOf(B), [], B)"),
    functions: ["turn"],
  },
  "both are read": {
    text: classes("Reflect.construct(Object.getPrototypeOf(B), [], Object.getPrototypeOf(this).constructor)"),
    functions: ["turn"],
  },
  "both are read through a helper": {
    text: classes("constructAbove(this, B)", above),
    functions: ["turn", "constructAbove"],
  },
};

for (const [form, { text, functions }] of Object.entries(programs)) {
  test(`Reflect.construct of what stands above a function, ${form}: behind a test for the functions that may arrive, the function above is called directly, and the built-in is left for the ways that are seldom taken`, async () => {
    using dir = tempDir("aot-constructed-behind-a-test", { "main.js": text });
    const folder = String(dir);
    const env = { ...bunEnv, NO_COLOR: "1" };
    built(
      await spawned(
        [bunExe(), "build", "--compile", "--aot", writesProgramInto(folder), "main.js", "--outfile", "main"],
        folder,
        env,
      ),
    );
    const ran = await spawned(["./main"], folder, env);
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: "4500\n", exitCode: 0 });

    for (const functionName of functions) {
      let isLikely = false;
      const leftOnLikelyWays = (await printIR(folder, { until: "Select", functionName })).split("\n").filter(line => {
        if (/^  b\d+\(/.test(line)) isLikely = !line.includes(" frequency=");
        return isLikely && /ReflectConstruct| = (Construct|ConstructList) /.test(line);
      });
      expect({ functionName, leftOnLikelyWays }).toEqual({ functionName, leftOnLikelyWays: [] });
    }
  }, 120_000);
}
