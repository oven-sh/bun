// The helper's operand holds an object that text has made, so nobody knows it, and it lists Array.prototype beside that. The new name is read by name below.
function extend(target, source) {
  for (const key in source) target[key] = source[key];
  return target;
}
function attempt(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}
const unknown = (0, eval)("({ kind: 'made by text' })");
attempt("unknown", () => Object.keys(extend(unknown, { size: 1 })).join(" "));
attempt("extend", () => typeof extend(Array.prototype, { last() { return this[this.length - 1]; } }));
attempt("by name", () => [1, 2, 3].last());
attempt("by key", () => [1, 2, 3]["la" + (process.argv.length > 100 ? "x" : "st")]());
attempt("keys", () => Object.keys(Array.prototype).join(" "));
attempt("loop", () => {
  const seen = [];
  for (const key in [7]) seen.push(key);
  return seen.join(" ");
});
