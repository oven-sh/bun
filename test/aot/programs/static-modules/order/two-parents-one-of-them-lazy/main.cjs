// A module with two parents: the entry point requires it at the top, and so does a module that is loaded by a function, which may or may not have run first.
// STATISTIC: ModulesWithState >= 2
const load = () => require("./lazy.cjs");
if (process.argv.length > 99) load();
console.log(require("./shared.cjs").n, load().n);
