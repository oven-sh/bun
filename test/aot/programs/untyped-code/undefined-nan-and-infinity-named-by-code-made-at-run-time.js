// Functions made at run time name `undefined`, `NaN` and `Infinity`: the globals, and everything that may stand in front of them: parameters, variables of enclosing functions, `with`, a direct eval that declares them.
const lines = [];
const show = value => (typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value));
const say = (label, text, ...given) => {
  const seen = [];
  try {
    const made = new Function("a", "b", text);
    for (let turn = 0; turn < 4; turn++) {
      try {
        seen.push(show(made(...given)));
      } catch (error) {
        seen.push("throws " + error.constructor.name);
      }
    }
  } catch (error) {
    seen.push("is refused: " + error.constructor.name);
  }
  lines.push(label + ": " + seen.join(" "));
};
const three = "[undefined, NaN, Infinity].map(String).join()";
say("the globals", "return " + three + ";");
say("compared", "return [a === undefined, a !== undefined, a == undefined, b === undefined, b === NaN, b !== NaN, b === Infinity, b < Infinity, -b === -Infinity, typeof undefined].join();", undefined, Infinity);
say("compared with values", "return [a === undefined, a !== undefined, a == undefined, b === undefined, b == undefined].join();", null, 0);
say("branches", "if (a === undefined) return 'a'; if (b !== undefined) return 'b'; return 'neither';", 1, undefined);
say("in a closure", "return (() => " + three + ")();");
say("two closures deep", "return (function () { return () => " + three + "; })()();");
say("in a method", "return new (class { m() { return " + three + "; } static s = undefined; f = NaN; })().m();");
say("in a generator", "return [...(function* () { yield undefined; yield NaN; yield Infinity; })()].map(String).join();");
say("a default", "return ((x = undefined, y = Infinity) => String(x) + y)();");
say("a parameter", "return (function (undefined, NaN, Infinity) { return " + three + "; })(1, 2, 3);");
say("a parameter seen from a closure", "return (function (undefined, NaN, Infinity) { return () => " + three + "; })(1, 2, 3)();");
say("a variable", "var undefined = 1, NaN = 2, Infinity = 3; return " + three + ";");
say("a variable seen from a closure", "var undefined = 1, NaN = 2, Infinity = 3; return (() => " + three + ")();");
say("a variable stored to from a closure", "var undefined; (() => { undefined = 5; })(); return (() => undefined)();");
say("let in a block", "{ let undefined = 1; const NaN = 2; return (() => [undefined, NaN, Infinity].join())(); }");
say("let in a block that has ended", "{ let undefined = 1; } return (() => String(undefined))();");
say("before its declaration", "const f = () => undefined; try { return f(); } finally { } let undefined = 1;");
say("a function's own name", "return (function undefined() { return typeof undefined; })();");
say("a catch parameter", "try { throw 1; } catch (undefined) { return (() => undefined)(); }");
say("a class's name", "return (class NaN { static m() { return typeof NaN; } }).m();");
say("with", "with ({ undefined: 1, NaN: 2 }) { return " + three + "; }");
say("with, seen from a closure", "with ({ undefined: 1, NaN: 2 }) { return (() => " + three + ")(); }");
say("with that gets the name later", "const scope = {}; with (scope) { const f = () => String(undefined); const before = f(); scope.undefined = 1; return before + f(); }");
say("with around a function that is called later", "let f; with (a) { f = function () { return () => String(undefined); }; } const before = f()(); a.undefined = 7; return before + f()();", {});
say("a direct eval declares it", "eval('var undefined = 1'); return String(undefined);");
say("a direct eval declares it for a closure", "const f = () => String(undefined); const before = f(); eval('var undefined = 1'); return before + f();");
say("a direct eval in strict code", "'use strict'; eval('var undefined = 1'); return String(undefined);");
say("a direct eval reads it", "return eval('String(undefined) + NaN');");
say("an indirect eval", "return (0, eval)('String(undefined) + Infinity');");
say("a function made inside", "return new Function('return String(undefined) + NaN + Infinity')();");
say("a function made inside where the name is taken", "var undefined = 1; return new Function('return String(undefined)')();");
say("a store in sloppy code", "undefined = 1; NaN = 2; Infinity = 3; return " + three + ";");
say("a store in strict code", "'use strict'; undefined = 1; return String(undefined);");
say("a store from a closure", "(() => { undefined = 1; })(); return String(undefined);");
say("deleted", "return [delete globalThis.undefined, String(undefined)].join();");
say("as a property name", "return [a.undefined, a.NaN, { undefined: 1 }.undefined, { undefined }.undefined].map(String).join();", { undefined: "mine", NaN: "too" });
say("as a label", "undefined: for (;;) { break undefined; } return 'left';");
say("void and arithmetic", "return [void 0 === undefined, 0 / 0 !== NaN, 1 / 0 === Infinity, Object.is(NaN, 0 / 0), Object.is(a, undefined)].join();");
let count = 0;
const validate = new Function("return function (data) { let errors = 0; if (data.a === undefined) errors++; if (data.b !== undefined) { if (data.b === Infinity || data.b !== data.b || data.b === NaN) errors += 10; } if (data.c === undefined && data.a !== undefined) errors += 100; return errors; };")();
const inputs = [{}, { a: 1 }, { a: 1, b: Infinity }, { b: NaN, c: 0 }, { a: undefined, b: 2, c: undefined }];
for (let turn = 0; turn < 50000; turn++) count += validate(inputs[turn % inputs.length]);
lines.push("count " + count);
console.log(lines.join("\n"));
