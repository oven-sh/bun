// Expected output on Windows: "seh: caught", "longjmp: 3", "finally: 12" and
// "cxx: caught boom, destructors: 2, custom 42, destructors: 3" (elsewhere the
// two SEH-based lines print "unsupported"). Run directly it loads the addons as
// DLLs; under `bun build --compile` on Windows they are statically merged into
// the exe, and every line then depends on the merged addons' unwind tables,
// exception handlers and (for the C++ line) thrown-type lookup still working.
const addon = require("./build/Debug/unwind_addon.node");
const cxx = require("./build/Debug/cxx_eh_addon.node");

console.log(addon.seh_catch());
console.log(addon.longjmp_depth());
console.log(addon.collided_unwind());
console.log(cxx.throw_and_catch());
