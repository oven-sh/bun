// Declarations that are used stand between ones that nothing uses. What is used is evaluated in the order written, a function that is hoisted reads constants that come later, and a read that comes too early still throws.
const log = [];
const unused1 = { a: 1 };
const first = log.push("first");
const unused2 = [1, 2, 3];
function hoisted() { return [second, third.value, Fourth.name].join(); }
const unused3 = () => hoisted();
try {
  hoisted();
} catch (error) {
  log.push(error.name + " before second");
}
const second = "second";
const unused4 = "text";
try {
  hoisted();
} catch (error) {
  log.push(error.name + " before third");
}
const third = { value: "third" };
class Unused5 {}
try {
  hoisted();
} catch (error) {
  log.push(error.name + " before Fourth");
}
class Fourth {}
const unused6 = class {};
log.push(hoisted());
var late = "a var is undefined before its statement";
function readsVar() { return typeof early + " " + typeof late; }
log.push(readsVar());
var early = 1;
log.push(readsVar());
console.log(log.join("\n"));
