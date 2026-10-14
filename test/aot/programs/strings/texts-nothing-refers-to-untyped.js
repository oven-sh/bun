// A string literal that the compiled program no longer refers to takes no bytes in the executable; one that is still referred to in any way does (the same program without type annotations).
class Kept {
  static label = "alive_as_a_key";
  #hidden = 1;
  get hidden() {
    return this.#hidden;
  }
  method() {
    return "m";
  }
}
function pick(flag) {
  if (flag)
    return "dead_arm_of_an_inlined_function";
  return "alive_arm_of_an_inlined_function";
}
function onlyFromDeadArm() {
  return "dead_only_called_from_a_dead_arm";
}
function picksACall(flag) {
  if (flag)
    return onlyFromDeadArm();
  return "x";
}
function byNumber(n) {
  switch (n) {
    case 1:
      return "dead_case_of_a_switch";
    case 2:
      return "alive_case_of_a_switch";
    default:
      return "dead_not_ascii_\xE9\u2192";
  }
}
function inlinedEverywhere() {
  return "alive_in_a_function_inlined_everywhere";
}
function run() {
  let s = "";
  for (let i = 0;i < 3; i++)
    s = pick(false) + " " + picksACall(false) + " " + byNumber(2) + " " + inlinedEverywhere() + " " + inlinedEverywhere().length;
  return s;
}
console.log(run());
const table = { ["alive_as_a_key"]: 1, other: 2 };
console.log(Object.keys(table).join(), table["alive_as_a_key"], "alive_as_a_key" in table);
function fails() {
  throw new TypeError("alive_in_a_message");
}
try {
  fails();
} catch (e) {
  console.log(e.message, e.name);
}
function nameInAMessage(x) {
  try {
    return String(x.push(1));
  } catch (e) {
    return e.constructor.name;
  }
}
console.log(nameInAMessage(undefined), nameInAMessage(null), nameInAMessage([]));
const thenable = { then(resolve) {
  resolve(7);
} };
Promise.resolve(thenable).then((v) => console.log("then", v));
console.log([1, 2, 3].length, "abc".length, [1, 2, 3].slice(1).join(), "abcdef".slice(2));
function inlinedAndNamed() {
  return new Error("e").stack.split(`
`).length > 0 ? "has a stack" : "none";
}
console.log(inlinedAndNamed(), inlinedAndNamed.name);
console.log(Kept.label, new Kept().hidden, new Kept().method(), Kept.name, Object.getOwnPropertyNames(Kept.prototype).join());
console.log(/al(i)ve/.exec("alive")[1], 12345678901234567890n.toString(), typeof globalThis);
