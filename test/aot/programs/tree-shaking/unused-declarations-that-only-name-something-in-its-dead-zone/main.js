// Each file declares something that nothing uses and that could be left out, but for one thing: it names a constant, a let or a class that is declared further down. `bun run` evaluates the declaration, which throws a ReferenceError (all but `extends`). `bun build --compile` leaves the declaration out, as the bundler does not count the dead zone of a name as an effect, and every file loads.
const loads = {
  "plain-name": () => import("./cases/plain-name.js"),
  "call": () => import("./cases/call.js"),
  "object": () => import("./cases/object.js"),
  "array": () => import("./cases/array.js"),
  "extends": () => import("./cases/extends.js"),
  "static-field": () => import("./cases/static-field.js"),
  "typeof": () => import("./cases/typeof.js"),
  "comparison": () => import("./cases/comparison.js"),
  "conditional": () => import("./cases/conditional.js"),
};
for (const file in loads) {
  try {
    await loads[file]();
    console.log(file + ": loaded");
  } catch (error) {
    console.log(file + ": " + error.name);
  }
}
