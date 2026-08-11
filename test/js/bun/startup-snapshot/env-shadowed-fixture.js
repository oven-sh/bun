process.on("restore", () => {
  console.log(`[js] SHADOWED=${process.env.SHADOWED} PLAIN=${process.env.PLAIN}`);
  process.exit(0);
});
setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 10);
