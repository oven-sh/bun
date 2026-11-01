import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { built, spawned } from "./harness/commands";
import { printIR, test, writesProgramInto } from "./harness/printed-ir";

// What compilers emit for `super(..)` in a class that they turn into functions.
const program = (parameters: string, stored: string, list: string) => `"use strict";
function A(${parameters}) { this.z = ${stored}; }
A.prototype.base = function () { return this.z; };
function B(a) { var self = Reflect.construct(A, ${list}, B); self.a = a; return self; }
B.prototype = Object.create(A.prototype, { constructor: { value: B, writable: true, configurable: true } });
Object.setPrototypeOf(B, A);
function turn(i) { var v = new B(i); return v.a + v.base(); }
function bench(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += turn(i & 7);
  return sum;
}
console.log(bench(1000));
`;
const programs: Record<string, { text: string; printed: string; left: RegExp }> = {
  "an empty list": {
    text: program("", "1", "[]"),
    printed: "4500\n",
    left: / = (NewObject|Construct|ConstructList|CallBuiltin|CallDirect|Call) |TryCallInline /,
  },
  "a list of two": {
    text: program("x, y", "x + y", "[a, 2]"),
    printed: "9000\n",
    left: / = (NewObject|Construct|ConstructList|CallBuiltin|CallDirect|Call) |TryCallInline /,
  },
  "the arguments of the function below": {
    text: program("x", "x", "arguments"),
    printed: "7000\n",
    left: / = (CreateUnmappedArguments|Construct|ConstructList|CallBuiltin|CallDirect|Call) |TryCallInline /,
  },
};

for (const [form, { text, printed, left }] of Object.entries(programs)) {
  test(`Reflect.construct(A, list, B) where B's objects go on from A's, ${form}: the object is made as one of B's, A's text is copied in, and on the ways that are taken nothing is constructed by value and no list is made`, async () => {
    using dir = tempDir("aot-constructed-for-the-function-below", { "main.js": text });
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
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: printed, exitCode: 0 });

    let isLikely = false;
    const leftOnLikelyWays = (await printIR(folder, { until: "Select", functionName: "turn" }))
      .split("\n")
      .filter(line => {
        if (/^  b\d+\(/.test(line)) isLikely = !line.includes(" frequency=");
        return isLikely && left.test(line);
      });
    expect(leftOnLikelyWays).toEqual([]);
  }, 120_000);
}
