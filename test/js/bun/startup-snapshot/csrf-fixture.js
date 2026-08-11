// The default CSRF secret is generated lazily; one generated while building would be the secret of every restored process.
const builtToken = Bun.CSRF.generate(); // forces the default secret into existence before the freeze
process.on("restore", () => {
  const fresh = Bun.CSRF.generate();
  console.log(`[js] built-token-verifies=${Bun.CSRF.verify(builtToken)} fresh-token-verifies=${Bun.CSRF.verify(fresh)}`);
  process.exit(0);
});
setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 10);
