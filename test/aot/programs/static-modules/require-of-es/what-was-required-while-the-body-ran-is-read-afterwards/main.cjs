const registry = require("./registry.cjs");
let kept;
function late() {
  const all = require("./values.mjs");
  kept ??= all;
  return [typeof all, Object.keys(all).join(), typeof all.zero, typeof all.one, typeof all.bump].join(" ");
}
// See a-callback-handed-over-requires-the-module-while-its-body-runs. What the call answered is the namespace object itself, so it shows the module once the body has ended.
registry.listeners.push(() => {
  try {
    console.log("while it runs:", late());
  } catch (error) {
    console.log("while it runs: threw", error.name);
  }
});
console.log("first:", late());
console.log("kept, afterwards:", Object.keys(kept).join(), typeof kept.zero, typeof kept.one, typeof kept.bump, kept === require("./values.mjs"));
console.log(Object.getPrototypeOf(kept) === Object.prototype, Object.getPrototypeOf(kept) === null, Object.isExtensible(kept), String(kept[Symbol.toStringTag]));
