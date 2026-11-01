import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { built, spawned } from "./harness/commands";
import { printIR, test, writesProgramInto } from "./harness/printed-ir";

const helpers: Record<string, string> = {
  "7.16 and after": `function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }`,
  "7.8 to 7.15": `function _typeof(obj) { "@babel/helpers - typeof"; if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }`,
  "7.0 to 7.7": `function _typeof(obj) { if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }`,
};
const program = `
var values = [1, "a", {}, null, undefined, function () {}, Symbol.iterator, []];
function asTest(i) {
  return _typeof(values[i]) === "object" ? 1 : 2;
}
function asValue(i) {
  return _typeof(values[i]);
}
function ofParameter(value) {
  return "object" != _typeof(value) || !value ? 1 : 2;
}
var sum = 0, kinds = [];
for (var i = 0; i < values.length; i++) {
  sum += asTest(i) + ofParameter(values[i]);
  kinds.push(asValue(i));
}
console.log(sum, kinds.join());
`;

for (const [version, helper] of Object.entries(helpers))
  test(`a call of _typeof of Babel ${version} is typeof, as a test and as a value`, async () => {
    using dir = tempDir("aot-typeof-helper", { "main.js": '"use strict";\n' + helper + program });
    const folder = String(dir);
    const env = { ...bunEnv, NO_COLOR: "1" };
    const command = [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      writesProgramInto(folder),
      "main.js",
      "--outfile",
      "main",
    ];
    built(await spawned(command, folder, env));
    const ran = await spawned(["./main"], folder, env);
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
      stdout: "23 number,string,object,object,undefined,function,symbol,object\n",
      exitCode: 0,
    });

    for (const functionName of ["asTest", "asValue", "ofParameter"]) {
      const text = await printIR(folder, { functionName });
      const calls = text.split("\n").filter(line => / = (Call|CallDirect|CallMethod) /.test(line));
      expect({ functionName, calls }).toEqual({ functionName, calls: [] });
    }
    expect(await printIR(folder, { functionName: "asValue" })).toContain(" = TypeOf ");
  }, 120_000);
