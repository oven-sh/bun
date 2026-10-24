// No file names `children`, `parent`, `require.main` or `process.mainModule`. The keys come from outside, so no analysis can tell what is read, and all four answer undefined in an executable,
// whatever else the program does. The expected output is written down: `bun run` prints object object object object.
const keys = (process.env.NO_SUCH_VARIABLE ?? "children parent main mainModule").split(" ");
require("./child.cjs");
console.log(typeof module[keys[0]], typeof require("./child.cjs").itself[keys[1]], typeof require[keys[2]], typeof process[keys[3]]);
