// A module fails every time. The first failure is caught. Then a module that is loaded later requires the failed one at its top: it fails too, with the same message, as under `bun run`.
try {
  require("./r1.cjs");
} catch {}
try {
  console.log(require("./r2.cjs").a);
} catch (error) {
  console.log(error.message);
}
