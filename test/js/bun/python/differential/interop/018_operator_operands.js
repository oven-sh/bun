// The operators that convert their operands to numbers, with an object of Python on one side and each kind of value of JS on the
// other: Python is asked with the operands as they were written, before anything of the program's runs (valueOf).
import m from "./018_operator_operands.py";
// More than one: operators.test.ts, for the tiers above the interpreter.
const turns = Number(process.env.TURNS ?? 1);
let ran = [];
const values = {
  int: 3, double: 1.5, large: 2 ** 40, "-0": -0, NaN, BigInt: 5n, string: "7", get rope() { return "12" + String(ran.length) + "3456789012345"; }, "": "",
  true: true, null: null, undefined, symbol: Symbol("s"),
  valueOf: { valueOf() { ran.push("valueOf"); return 4; } },
  throws: { valueOf() { ran.push("valueOf"); throw new RangeError("from valueOf"); } },
  toPrimitive: { [Symbol.toPrimitive](hint) { ran.push("toPrimitive " + hint); return 6; } },
  array: [2], Date: new Date(5), function() {}, answers: m.answers, raises: m.raises, nothing: m.nothing,
};
const methods = { "-": "sub", "*": "mul", "/": "truediv", "%": "mod", "**": "pow", "<<": "lshift", ">>": "rshift", "&": "and", "|": "or", "^": "xor" };
const shown = v => (typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : String(v));
// An operand is the name of one of the values (a rope is a rope once), or a string.
function outcome(f, ...operands) {
  let result;
  for (let turn = 0; turn < turns; ++turn) {
    ran = [];
    const given = operands.map(operand => (Object.hasOwn(values, operand) ? values[operand] : operand));
    try { result = shown(f(...given)); } catch (e) { result = `${e.constructor.name}: ${e.message}`; }
  }
  return result + (ran.length ? ` (ran ${ran})` : "");
}
const site = (parameters, body) => (0, eval)(`(function (${parameters}) { ${body} })`);
function table(op, name) {
  const lines = [];
  for (const other of Object.keys(values)) {
    const left = outcome(site("a, b", `return a ${op} b;`), name, other), right = outcome(site("a, b", `return a ${op} b;`), other, name);
    lines.push(`${name} OP ${other}: ${left} | ${other} OP ${name}: ${right}`.replaceAll(`${methods[op]}__`, "OP__").replace(/unsupported operand type\(s\) for \S+( or pow\(\))?: /g, "unsupported: "));
  }
  return lines;
}
for (const name of ["answers", "raises", "nothing"]) {
  const first = table("-", name);
  const usual = first.filter(line => line.endsWith(": ValueError: no") && line.includes(": ValueError: no | "));
  console.log(first.filter(line => !usual.includes(line)).join("\n"));
  if (usual.length)
    console.log(`${name} OP any of the other ${usual.length}, and the other way round: ValueError: no`);
  for (const op of Object.keys(methods).slice(1)) {
    const different = table(op, name).filter((line, i) => line !== first[i]);
    console.log(`${name}, ${op}:`, different.length ? "\n  " + different.join("\n  ") : "the same");
  }
}
console.log();
for (const body of ["++a; return a;", "--a; return a;", "const b = a++; return [a, b === given];", "const b = a--; return [a, b === given];", "a = a++; return a === given;", "const o = { p: a }, b = o.p++; return [o.p, b === given];", "const o = [a], k = 0, b = o[k]--; return [o[0], b === given];", "const get = () => a, b = a++; return [get(), b === given];", "globalThis.global018 = a; const b = global018++; return [global018, b === given];", "return ~a;", "return -a;", "return a * 1;", "return 1 * a;", "return a * 1 * 1;", "return +(a * 1);", "return 1 * a + 's';", "a -= 1; return a;", "a <<= 1; return a;", "a &= 3; return a;"])
  console.log(`${body} `, ["answers", "raises", "nothing", "symbol", "valueOf", "string", "BigInt"].map(name => `${name}: ${outcome(site("a", "const given = a; " + body), name)}`).join(" | "));
console.log();
// No object at all: strings go the way they always went.
const strings = ["7", "rope", "", " 12 ", "0x10", "1e3", "-5.9", "4294967301", "1e400", "abc", "5n"];
for (const op of ["&", "|", "^", "<<", ">>", ">>>", "-", "*"])
  console.log(`string ${op} 3, 3 ${op} string, string ${op} string:`, strings.map(s => [outcome(site("a, b", `return a ${op} b;`), s, "int"), outcome(site("a, b", `return a ${op} b;`), "int", s), outcome(site("a, b", `return a ${op} b;`), s, s)].join(" ")).join(" | "));
console.log("~string:", strings.map(s => outcome(site("a", "return ~a;"), s)).join(" "));
console.log("string & BigInt:", outcome(site("a, b", "return a & b;"), "7", "BigInt"), "|", outcome(site("a, b", "return a << b;"), "BigInt", "1"));
