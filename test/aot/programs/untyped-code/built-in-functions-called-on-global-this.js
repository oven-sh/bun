// globalThis.String(x), globalThis.Number(x), globalThis.parseInt(x) ..: built-in functions and constructors called as methods of globalThis, in a module that has names of its own for them.
const String = () => "the module's own", Number = () => "the module's own", Array = () => "the module's own", BigInt = () => "the module's own", Boolean = () => "the module's own", Symbol = () => "the module's own";
const said = [];
const values = [0, -0, 1.5, NaN, "12", "", "x", null, undefined, true, [], [1, 2], {}, { toString() { return "7"; } }, { valueOf() { return 8; } }, 10n];
const show = v => { try { return typeof v === "bigint" ? v + "n" : typeof v === "symbol" ? v.toString() : Object.is(v, -0) ? "-0" : globalThis.JSON.stringify(v) ?? globalThis.String(v); } catch (error) { return error.constructor.name; } };
const attempt = f => { try { return show(f()); } catch (error) { return error.constructor.name; } };
for (const v of values)
  said.push(show(v) + ": " + [attempt(() => globalThis.String(v)), attempt(() => globalThis.Number(v)), attempt(() => globalThis.Boolean(v)), attempt(() => globalThis.BigInt(v)), attempt(() => globalThis.parseInt(v)), attempt(() => globalThis.parseFloat(v)), attempt(() => globalThis.isNaN(v)), attempt(() => globalThis.isFinite(v)), attempt(() => globalThis.Object(v) === v)].join(" "));
said.push("own names: " + [String(1), Number(1), Array(1), BigInt(1), Boolean(1), Symbol(1)].join(" | "));
said.push("arrays: " + [globalThis.Array(3).length, globalThis.Array(1, 2).join(), globalThis.Array("3").length, attempt(() => globalThis.Array(-1))].join(" "));
said.push("symbols: " + [typeof globalThis.Symbol("s"), globalThis.Symbol("s").description, attempt(() => new globalThis.Symbol("s"))].join(" "));
said.push("errors: " + [globalThis.Error("text").message, globalThis.TypeError("t") instanceof globalThis.Error, globalThis.RangeError("r").name].join(" "));
said.push("others: " + [typeof globalThis.Date(), globalThis.RegExp("a+", "g").flags, globalThis.encodeURIComponent("a b"), globalThis.decodeURIComponent("a%20b"), attempt(() => globalThis.Map()), attempt(() => globalThis.Promise())].join(" "));
said.push("spread and no arguments: " + [globalThis.String(...["a", "b"]), globalThis.String(), globalThis.Number(), globalThis.Array(...[1, 2, 3]).length].map(show).join(" "));
said.push("evaluation: " + globalThis.eval("1 + 1") + " " + (() => { const local = 5; return attempt(() => globalThis.eval("typeof local")); })());
const order = [];
globalThis.String((order.push("first"), 1), (order.push("second"), 2));
said.push("order: " + order.join());
const withParameter = globalThis => globalThis.String(1);
said.push("a parameter named globalThis: " + withParameter({ String: v => "the parameter's " + v }));
globalThis.mine = function (v) { return (this === globalThis) + " " + v; };
said.push("a global of the program: " + globalThis.mine(1));
said.push("absent: " + attempt(() => globalThis.noSuchFunction(1)) + " " + show(globalThis.noSuchFunction?.(1)) + " " + show(globalThis.String?.(2)));
let length = 0;
for (let i = 0; i < 20000; i++) length += globalThis.String(i).length + globalThis.Number("" + (i % 7));
said.push("many: " + length);
console.log(said.join("\n"));
