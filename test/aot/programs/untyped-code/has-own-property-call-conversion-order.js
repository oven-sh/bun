// `Object.prototype.hasOwnProperty.call(o, k)` converts `k` before it rejects an `o` that is undefined or null. `Object.hasOwn(o, k)` rejects `o` first.
const log = [];
function loggingKey(name) {
  return { toString() { log.push("converted " + name); return name; } };
}
function throwingKey() {
  return { toString() { log.push("threw"); throw new RangeError("no key"); } };
}
function called(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function hasOwn(o, k) { return Object.hasOwn(o, k); }
function calledInTry(o, k) {
  try {
    return Object.prototype.hasOwnProperty.call(o, k);
  } catch (error) {
    return "caught " + error.constructor.name;
  }
}
function attempt(f, o, k) {
  try {
    return String(f(o, k));
  } catch (error) {
    return error.constructor.name;
  }
}
for (const f of [called, hasOwn, calledInTry]) {
  for (const o of [null, undefined, { a: 1 }, "ab", 5]) {
    const answers = [loggingKey("a"), throwingKey(), "a", Symbol.iterator, 0].map(k => attempt(f, o, k));
    console.log(f.name, String(o && typeof o), answers.join(" "), "|", log.splice(0).join());
  }
}
