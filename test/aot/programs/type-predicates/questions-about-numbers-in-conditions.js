// Number.isFinite, isInteger, isSafeInteger and isNaN in a condition test the type first and ask the number behind it: no conversion runs, and a replaced or shadowed one is an ordinary call.
const log = [];
const watched = { valueOf() { log.push("valueOf"); return 1; }, toString() { log.push("toString"); return "1"; }, [Symbol.toPrimitive]() { log.push("toPrimitive"); return 1; } };
const values = () => [undefined, null, true, 0, -0, 1, -1, 1.5, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 53, 2 ** 53 - 1, -(2 ** 53), 1e308, 5e-324, 10n, "", "1", "NaN", Symbol.iterator, {}, [], [1], watched, new Number(1), new Number(NaN), () => 1, new Date(0), new Proxy({}, {})];
const show = (label, ask) => console.log(label, values().map(value => { try { return String(ask(value)); } catch (error) { return error.constructor.name; } }).join(" "), "|", log.splice(0).join());

show("isFinite", function (x) { return Number.isFinite(x) ? x + 1 : "-"; });
show("isInteger", function (x) { return Number.isInteger(x) ? x % 7 : "-"; });
show("isSafeInteger", function (x) { return Number.isSafeInteger(x) ? x - 1 : "-"; });
show("isNaN", function (x) { return Number.isNaN(x) ? typeof x : "-"; });
show("not", function (x) { if (!Number.isFinite(x)) return typeof x; return x * 2; });
show("and", function (x) { return Number.isInteger(x) && x >= 0 ? x | 0 : "-"; });
show("or", function (x) { return Number.isNaN(x) || x === undefined ? "none" : typeof x; });
show("both", function (x) { return Number.isFinite(x) && !Number.isInteger(x) ? Math.floor(x) : "-"; });
show("in a loop", function (x) { let turns = 0; while (Number.isFinite(x) && turns < 3) { x = turns === 1 ? "text" : x + 1; turns++; } return `${turns} ${typeof x}`; });
show("as a value", function (x) { const answer = Number.isFinite(x); return answer ? x + 1 : answer; });
show("of an expression", function (x) { return Number.isFinite(x?.length) ? x.length : "-"; });
show("of an assignment", function (x) { let kept; return Number.isFinite((kept = x)) ? kept + 1 : typeof kept; });
show("of a call", function (x) { let calls = 0; const give = () => (calls++, x); return `${Number.isInteger(give()) ? "whole" : "-"}${calls}`; });
show("no operand", function () { return Number.isFinite() ? "never" : Number.isNaN() ? "never" : "-"; });
show("two operands", function (x) { let seen = 0; return `${Number.isFinite(x, seen++) ? x + 1 : "-"}${seen}`; });
show("a spread", function (x) { return Number.isFinite(...[x]) ? x + 1 : "-"; });
show("optional call", function (x) { return Number.isFinite?.(x) ? x + 1 : "-"; });
show("optional member", function (x) { return Number?.isFinite(x) ? x + 1 : "-"; });
show("by a key", function (x) { return Number["isFinite"](x) ? x + 1 : "-"; });
show("taken off", function (x) { const { isFinite: ask } = Number; return ask(x) ? x + 1 : "-"; });
show("through call", function (x) { return Number.isFinite.call(null, x) ? x + 1 : "-"; });
show("the global ones convert", function (x) { return `${isFinite(x) ? "f" : "-"}${isNaN(x) ? "n" : "-"}`; });
show("another Number", function (x) { const Number = { isFinite: value => value === "1", isNaN: () => true }; return `${Number.isFinite(x) ? "mine" : "-"}${Number.isNaN(x) ? "!" : ""}`; });
show("a parameter called Number", (x, Number = { isInteger: value => typeof value === "string" }) => (Number.isInteger(x) ? "text" : "-"));
{
  class Number { static isFinite(value) { return value === null; } }
  show("a class called Number", x => (Number.isFinite(x) ? "null" : "-"));
}
