// As its neighbor, but no statement names the new member: it is found under keys put together at run time.
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
extend(unknown, { size: 1 });
const name = "fir" + (process.argv.length > 100 ? "x" : "st");
attempt("extend", () => typeof extend(Array.prototype, { [name]() { return this[0]; }, ["twice" + name]: 2 }));
attempt("call", () => [4, 5, 6][name]());
attempt("value", () => [4]["twice" + name] * 21);
attempt("typeof", () => typeof [][name] + " " + typeof []["twice" + name] + " " + typeof []["push"]);
attempt("apply", () => Reflect.apply([][name], [9, 8], []));
attempt("has", () => name in [] && Object.hasOwn(Array.prototype, name));
