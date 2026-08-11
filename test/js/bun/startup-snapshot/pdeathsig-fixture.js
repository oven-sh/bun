// After restore, spawn a plain child and have it report its own PR_GET_PDEATHSIG (Linux); no-orphans mode defaults it to SIGKILL (9).
process.on("restore", async () => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("BUN_STARTUP_SNAPSHOT") || k.startsWith("MIMALLOC_")) delete env[k];
  const child = Bun.spawn({
    cmd: [process.execPath, "-e", `const { dlopen, FFIType, ptr } = require("bun:ffi"); const l = dlopen("libc.so.6", { prctl: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 } }); const b = new Int32Array(1); l.symbols.prctl(2, ptr(b)); console.log("pdeathsig=" + b[0]);`],
    env,
    stdout: "pipe",
  });
  console.log("[js] child " + (await child.stdout.text()).trim());
  await child.exited;
  process.exit(0);
});
setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 10);
