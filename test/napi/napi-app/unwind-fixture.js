// Expected output on Windows: "seh: caught", "longjmp: 3", "finally: 12"
// (elsewhere the two SEH-based lines print "unsupported"). Run directly it
// loads the addon as a DLL; under `bun build --compile` on Windows the addon is
// statically merged into the exe, and every line then depends on the merged
// addon's unwind tables and exception handlers still being reachable.
const addon = require("./build/Debug/unwind_addon.node");

console.log(addon.seh_catch());
console.log(addon.longjmp_depth());
console.log(addon.collided_unwind());
