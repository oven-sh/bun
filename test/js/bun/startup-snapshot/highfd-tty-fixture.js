// Bun's own tty reader for stdin is set up on whatever descriptor number is free; the snapshot records that number together
// with the descriptor's flags, and a high number once collided with the flags in the record and came back on the wrong
// descriptor. Use up the low numbers first (files are allowed under local I/O and are simply gone after restore), then set up
// stdin, so its reader lands high; after restore a keystroke has to arrive through it.
const fs = require("fs");
const held = [];
while (held.length < 40) held.push(fs.openSync(process.execPath, "r"));
process.stdin.setRawMode?.(true);
process.stdin.on("data", d => { console.log(`[js] stdin data after restore: ${JSON.stringify(String(d))}`); process.exit(0); });
process.on("restore", () => console.log("[js] restored; waiting for a keystroke"));
setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 100);
