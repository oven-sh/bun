// String(x), `${x}` and ~x where untyped code holds a whole number. Each went to the runtime every time, though "" + x and x.toString() did not. The operation now has a front end that answers a whole number itself: the text from the engine's own tables of number strings, the complement in two instructions.
const entered = name => typeof aotOperationCount === "function" ? aotOperationCount(name) : 0;
const forms = {
  "String(x)": function (x) { return String(x); },
  "template": function (x) { return `${x}`; },
  "template around": function (x) { return `<${x}>`; },
  "~x": function (x) { return ~x; },
  "~~x": function (x) { return ~~x; },
  "!~x": function (x) { return !~x; },
};
const values = [0, 1, 7, 9, 10, 13, 63, 64, 65, 200, 404, 1234, 65535, 2147483647, -1, -2, -13, -2147483648, 4294967296, 1.5, -0, NaN, Infinity, true, false, null, undefined, "text", "12", "", 12n, [3], { valueOf() { return 5; }, toString() { return "five"; } }];
const show = v => typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : String(v);
for (const form in forms) {
  const out = [];
  for (const value of values) { try { out.push(show(forms[form](value))); } catch (error) { out.push(error.constructor.name); } }
  console.log(form + ":", out.join(" "));
}
try { console.log(String(Symbol("s")), `${Symbol("t")}`); } catch (error) { console.log(error.constructor.name); }
try { console.log(~Symbol("u")); } catch (error) { console.log(error.constructor.name); }
for (const [form, name] of [["String(x)", "operationAOTToString"], ["template", "operationAOTToString"], ["~x", "operationAOTValueBitNot"]]) {
  for (const value of [7, 13, 200, 1234]) {
    forms[form](value);
    const before = entered(name);
    let same = 0;
    const first = forms[form](value);
    for (let i = 0; i < 1000; i++) same += forms[form](value) === first ? 1 : 0;
    console.log(form, value, same, entered(name) - before < 20);
  }
}
let total = 0;
for (let i = -3000; i < 3000; i++) total += String(i).length + (~i & 7) + Number(`${i}`);
console.log(total);
