// SharedArrayBuffers created before the freeze: their storage is shared-memory-capable backing that the snapshot carries like
// any other; afterwards they must still hold their contents, still be the same object behind every view, still work with
// Atomics, and a growable one must still grow (growth allocates in the restored process).
const sab = new SharedArrayBuffer(64);
const i32 = new Int32Array(sab);
const u8 = new Uint8Array(sab);
i32[0] = 0x11223344;
i32[1] = 7;
const growable = new SharedArrayBuffer(16, { maxByteLength: 1024 });
new Uint8Array(growable)[3] = 42;
function check() {
  const out = [];
  out.push("i32[0]=" + i32[0].toString(16));
  out.push("aliased=" + (u8[0] === 0x44 || u8[3] === 0x44)); // same storage seen through both views (either endianness)
  out.push("sameBuffer=" + (i32.buffer === sab && u8.buffer === sab));
  out.push("atomicsAdd=" + Atomics.add(i32, 1, 5) + "->" + Atomics.load(i32, 1));
  out.push("notify=" + Atomics.notify(i32, 2, 1)); // 0 waiters, but the call must work
  growable.grow(512);
  const g = new Uint8Array(growable);
  g[500] = 9;
  out.push("grown=" + growable.byteLength + " kept=" + g[3] + " new=" + g[500]);
  return out.join(" ");
}
if (process.env.PLAIN) {
  console.log("[js] " + check());
} else {
  process.on("restore", () => { console.log("[js] " + check()); process.exit(0); });
  setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 10);
}
