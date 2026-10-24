// The first call of a method by name asks the run time for it, and no later call does, whatever the class looks like: the prototype of the class need not make its members for that.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const asked = () => count("operationAOTGetByIdAndCache");
class Plain { f = 0; m1() { return 1; } m2() { return 2; } m3() { return 3; } m4() { return 4; } m5() { return 5; } m6() { return 6; } }
class WithGetter { f = 0; m1() { return 1; } m2() { return 2; } m3() { return 3; } m4() { return 4; } m5() { return 5; } get g() { return 6; } }
class Parent { f = 0; m1() { return 1; } m2() { return 2; } m3() { return 3; } m4() { return 4; } m5() { return 5; } m6() { return 6; } }
class Child extends Parent { h = 1; c1() { return 10; } c2() { return 2; } c3() { return 3; } c4() { return 4; } c5() { return 5; } }
class CallsAnother { f = 0; m1() { return this.m2(); } m2() { return 2; } m3() { return 3; } m4() { return 4; } m5() { return 5; } m6() { return 6; } }
class Few { f = 0; m1() { return 1; } m2() { return 2; } }
function calls(object, turns) { let sum = 0; for (let i = 0; i < turns; i++) sum += object.m1(); return sum; }
function callsOfChild(object, turns) { let sum = 0; for (let i = 0; i < turns; i++) sum += object.c1(); return sum; }
const lines = [];
let most = 0;
function measure(label, run) {
  const before = asked();
  const result = run();
  most = Math.max(most, asked() - before);
  lines[lines.length] = label + " " + result;
}
const plain = new Plain(), withGetter = new WithGetter(), parent = new Parent(), child = new Child(), callsAnother = new CallsAnother(), few = new Few();
measure("plain", () => calls(plain, 500));
measure("with a getter", () => calls(withGetter, 500));
measure("own of a child", () => callsOfChild(child, 500));
measure("inherited by a child", () => calls(child, 500));
measure("of the parent", () => calls(parent, 500));
measure("that calls another", () => calls(callsAnother, 500));
measure("of a class of two", () => calls(few, 500));
console.log(lines.join(" | "));
console.log(most <= 3 ? "no 500 calls asked the run time more than three times" : "500 calls asked the run time " + most + " times");
console.log(plain.m6(), withGetter.g, child.m6(), child.c5(), few.m2(), Object.getOwnPropertyNames(Plain.prototype).join(), plain.m1 === Plain.prototype.m1, calls(plain, 10));
