// Babel's `_createClass(Point, [{ key: "norm", value: .. }])` reads `enumerable` off each written descriptor, asks `"value" in` it, stores three words into it and hands it to Object.defineProperty, which asks for
// all six words. Whatever the literal does not write is sought above it: where a test lays one of the six above every object, plain Bun finds it. The fast way wrote a descriptor of its own and asked nobody.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const library = `function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }
function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }
export const described = () => {
  var Point = /*#__PURE__*/function () {
    function Point() {}
    _createClass(Point, [{ key: "norm", value: function norm() { return 1; } }, { key: "size", get: function get() { return 2; } }]);
    return Point;
  }();
  return ["norm", "size"].map(name => { const d = Object.getOwnPropertyDescriptor(Point.prototype, name); return name + ":" + Object.keys(d).filter(word => d[word] === true).join("+"); }).join(" ");
};
`;
const untouched = "norm:writable+configurable size:configurable";
const laid: Record<string, { lay: string; name: string; said: string }> = {
  "true under enumerable": {
    lay: `Object.prototype.enumerable = true;`,
    name: "enumerable",
    said: "norm:writable+enumerable+configurable size:enumerable+configurable",
  },
  "a number under value": { lay: `Object.prototype.value = 7;`, name: "value", said: "TypeError" },
  "a function under get": { lay: `Object.prototype.get = function () { return 9; };`, name: "get", said: "TypeError" },
  "a function under set": { lay: `Object.prototype.set = function () {};`, name: "set", said: "TypeError" },
  "true under writable": { lay: `Object.prototype.writable = true;`, name: "writable", said: "TypeError" },
  "a setter under configurable": {
    lay: `Object.defineProperty(Object.prototype, "configurable", { configurable: true, get() { return false; }, set(v) {} });`,
    name: "configurable",
    said: "norm:writable size:",
  },
  "a setter under enumerable": {
    lay: `Object.defineProperty(Object.prototype, "enumerable", { configurable: true, get() { return true; }, set(v) {} });`,
    name: "enumerable",
    said: "norm:writable+enumerable+configurable size:enumerable+configurable",
  },
  "another name": { lay: `Object.prototype.valued = 7;`, name: "valued", said: untouched },
};

for (const [name, { lay, name: key, said }] of Object.entries(laid))
  test.concurrent(name, async () => {
    using dir = tempDir("aot-create-class-below-words", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "lib.js": library,
      "a.test.js": `import { test } from "bun:test";\nimport { described } from "./lib.js";\ntest("t", () => { ${lay} let said; try { said = described(); } catch (error) { said = error.name; } finally { delete Object.prototype.${key}; } console.error("SAID " + said + " | " + described()); });\n`,
    });
    const answers: Record<string, unknown> = {};
    for (const [way, flags] of [
      ["plain", []],
      ["compiled", ["--aot"]],
    ] as const) {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
      answers[way] = { said: (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SAID ")), exitCode };
    }
    const line = "SAID " + said + " | " + untouched;
    expect(answers).toEqual({ plain: { said: [line], exitCode: 0 }, compiled: { said: [line], exitCode: 0 } });
  });
