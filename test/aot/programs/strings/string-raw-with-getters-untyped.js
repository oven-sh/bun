// `String.raw` with an argument whose getters have side effects (the same program without type annotations).
const log = [];
const strings = { raw: { length: 2, get 0() {
  log.push("first");
  return "a";
}, get 1() {
  log.push("second");
  return "b";
} } };
function raw(s, x) {
  return String.raw(s, x);
}
globalThis.kept = [raw];
console.log(raw(strings, 7), log.join(" "));
console.log(raw({ raw: ["x", "y"] }, 8), log.length);
