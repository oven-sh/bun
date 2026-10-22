// Whether `children`, `parent`, `require.main` and `process.mainModule` answer goes by what the text of the program names, never by which code an analysis finds to run.
// Here the only code that names them is a function that nothing calls. So they answer, as under `bun run`, also on objects that the compiler has lost sight of.
function never() {
  return [module.children, module.parent, require.main, process.mainModule];
}
const table = { never };
console.log(Object.keys(table).join());

const lost = value => new CustomEvent("lost", { detail: value }).detail;
const child = require("./child.cjs");
const own = lost(module);
console.log(own.children.length, own.children[0] === child.itself, own.parent);
console.log(lost(require).main === own, lost(process).mainModule === own);
console.log(child.seen());
