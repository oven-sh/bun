require("./b.cjs");
require("./d.cjs");
require("./b.cjs");
if (process.argv.includes("--access-early")) {
  module.children;
}
require("./b.cjs");
require("./b.cjs");
require("./f.cjs");
require("./g.cjs");

let seen = new Set();
function iter(module, indent = 0) {
  if (require.cache[module.filename] !== module) {
    throw new Error("module.filename is not the same as require.cache[module.filename]");
  }
  let isSeen = seen.has(module);
  console.log(
    `${" ".repeat(indent)}${module.id === module.filename ? module.id : `${module.id} (${module.filename})`}${isSeen ? " (seen)" : ""}`
      .replaceAll(__dirname, ".")
      .replaceAll("\\", "/"),
  );
  seen.add(module);
  if (isSeen) return;
  for (let child of module.children) {
    iter(child, indent + 1);
  }
}

iter(module);
