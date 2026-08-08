let ticks = 0;
setInterval(() => { ticks++; }, 100);                       // created BEFORE the snapshot (late-cut style)
process.stdin.setRawMode?.(true);
process.stdin.on("data", d => { console.log(`[js] stdin data: ${JSON.stringify(d.toString())} ticks=${ticks}`); if (d.toString().includes("q")) process.exit(0); });
process.on("restore", () => {
  console.log("[js] restored; waiting for ticks + stdin");
  setTimeout(() => console.log(`[js] post-restore timer fired; interval ticks since restore=${ticks}`), 500);   // created AFTER restore
});
setTimeout(() => { ticks = 0; Bun.unsafe.snapshot(process.env.BUN_IMAGE_OUT, { cancelTimers: !!process.env.CANCEL, keepTimers: !!process.env.KEEP }); }, 200);
