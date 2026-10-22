function first() {
  const all = require("./values.mjs");
  return all.one + all.bump() + String(all.missing) + String(all.__esModule);
}
function second() {
  const { one, bump } = require("./values.mjs");
  return one + bump();
}
function third() {
  return require("./other.mjs").default(require("./values.mjs").one);
}
console.log(globalThis.ran);
console.log(first(), second(), third(), globalThis.ran.join());
console.log(first(), second(), third(), globalThis.ran.join());
