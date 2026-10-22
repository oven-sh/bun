// Each file declares something that nothing uses and whose initializer computes with a constant that is declared further down: a sum, a template, a member, a computed key, a sign, a call. Such a declaration stays, and evaluating it throws a ReferenceError, as in `bun run`. An executable of `bun build --compile` loads every file: there the constants of a file that import() loads are vars, which have no dead zone.
const loads = {
  "sum": () => import("./cases/sum.js"),
  "template": () => import("./cases/template.js"),
  "member": () => import("./cases/member.js"),
  "computed-key": () => import("./cases/computed-key.js"),
  "negation": () => import("./cases/negation.js"),
  "statement": () => import("./cases/statement.js"),
  "enum-like": () => import("./cases/enum-like.js"),
};
for (const file in loads) {
  try {
    await loads[file]();
    console.log(file + ": loaded");
  } catch (error) {
    console.log(file + ": " + error.name);
  }
}
