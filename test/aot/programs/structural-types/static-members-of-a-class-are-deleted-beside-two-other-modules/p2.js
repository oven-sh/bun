function double(x) {
  return x * 2;
}
function triple(x) {
  return x * 3;
}
async function later(x) {
  return x + 100;
}
const increment = (x) => x + 1;
function makeAdder(n) {
  return (x) => x + n;
}
const addTen = makeAdder(10);
function callOneOfTwoDeclared(f, x) {
  return f(x);
}
function callDeclaredOrArrow(f, x) {
  return f(x);
}
function callDeclaredOrMade(f, x) {
  return f(x);
}
function callPredicted(f, x) {
  return f(x);
}
function isDouble(f) {
  return f === double;
}
globalThis.hook = callPredicted;
const outside = JSON.parse('{"hook":"hook","names":["double","double","double","triple","increment","adder","bound","proxy","later","abs"]}'), callees = {
  double,
  triple,
  increment,
  adder: makeAdder(20),
  bound: double.bind(null),
  proxy: new Proxy(double, {}),
  later,
  abs: Math.abs
}, log = [];
function round(label) {
  let sum = 0, same = 0;
  for (let i = 0;i < 300; i++) {
    sum += callOneOfTwoDeclared(i % 3 === 0 ? triple : double, i);
    sum += callDeclaredOrArrow(i % 5 === 0 ? increment : double, i);
    sum += callDeclaredOrMade(i % 7 === 0 ? addTen : double, i);
    sum += callPredicted(double, i);
    const f = callees[outside.names[i % outside.names.length]], result = globalThis[outside.hook](f, -i);
    if (typeof result === "number")
      sum += result;
    if (isDouble(f))
      same++;
  }
  log.push(label + ": " + sum + ", " + same);
}
round("as declared");
double.tag = "has a property";
round("with a property");
Object.defineProperty(double, "name", { value: "renamed" });
round("renamed " + double.name);
Object.setPrototypeOf(double, { inherited: 1 });
round("another prototype " + double.inherited);
Object.freeze(double);
round("frozen");
callees.double = triple;
round("replaced in the table");
console.log(log.join(`
`));

export {};
