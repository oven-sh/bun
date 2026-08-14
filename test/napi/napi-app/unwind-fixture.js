// Expected output: "seh: caught" (Windows; "seh: unsupported" elsewhere) and
// "longjmp: 3". Run directly it loads the addon as a DLL; under
// `bun build --compile` on Windows the addon is statically merged into the exe,
// and both calls then depend on the merged addon's unwind tables being found.
const addon = require("./build/Debug/unwind_addon.node");

console.log(addon.seh_catch());
console.log(addon.longjmp_depth());
