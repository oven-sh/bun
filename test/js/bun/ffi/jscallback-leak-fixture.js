// Creating and closing a JSCallback must not leak the heap-allocated Function
// struct or the generated C source buffer passed to TinyCC.
const { JSCallback } = require("bun:ffi");

function cycle() {
  const cb = new JSCallback(() => {}, { returns: "void", args: [] });
  cb.close();
}

// Warm up: let the allocator, JIT and TinyCC reach steady state. 500 cycles is
// enough for RSS to plateau in both release and debug/ASAN builds.
for (let i = 0; i < 500; i++) cycle();
Bun.gc(true);

const before = process.memoryUsage.rss();
for (let i = 0; i < 500; i++) cycle();
Bun.gc(true);
const after = process.memoryUsage.rss();

const growthMB = (after - before) / 1024 / 1024;
console.log(JSON.stringify({ growthMB }));
// Before the fix this grew ~6MB over 500 cycles (~12KB of generated C source
// plus the Function struct per callback). After, it holds steady near 0.
if (growthMB > 4) {
  console.error("JSCallback leaked " + growthMB.toFixed(2) + "MB over 500 create+close cycles");
  process.exit(1);
}
