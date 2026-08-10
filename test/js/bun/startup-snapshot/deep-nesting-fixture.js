// The runtime's recursion guard (its own, apart from JSC's) is per-thread state; a restored process has to have it, or deep
// input through the transpiler is a real stack overflow instead of an error.
function probe() {
  const depth = 200_000;
  try {
    new Bun.Transpiler().transformSync("[".repeat(depth) + "]".repeat(depth));
    return "transformed";
  } catch (e) {
    return "error: " + String(e.message ?? e).split("\n")[0].slice(0, 60);
  }
}
if (process.env.PLAIN) console.log("[js] " + probe());
else {
  process.on("restore", () => { console.log("[js] " + probe()); process.exit(0); });
  setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 10);
}
