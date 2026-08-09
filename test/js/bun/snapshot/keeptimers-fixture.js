let ticks = 0;
setInterval(() => { ticks++; }, 100);                       // created BEFORE the snapshot (late-cut style)
process.stdin.setRawMode?.(true);
process.stdin.on("data", d => { console.log(`[js] stdin data: ${JSON.stringify(d.toString())} ticks=${ticks}`); if (d.toString().includes("q")) process.exit(0); });
let restoredAt = 0;
// Armed with ~1.5 s still to go when the snapshot is taken (~200 ms in): after restore it must fire ~1.5 s later, not at once.
setTimeout(() => console.log(`[js] remaining-time timer fired ${Math.round(performance.now() - restoredAt)}ms after restore`), 1700);
process.on("restore", () => {
  restoredAt = performance.now();
  console.log("[js] restored; waiting for ticks + stdin");
  setTimeout(() => console.log(`[js] post-restore timer fired; interval ticks since restore=${ticks}`), 500);   // created AFTER restore
});
setTimeout(() => { ticks = 0; Bun.unsafe.snapshot(process.env.TIMERS ? { timers: process.env.TIMERS } : {}); }, 200);
