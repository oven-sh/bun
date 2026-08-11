// A large array from the snapshot has its storage in an immortal precise allocation; growing it after restore must move it into
// ordinary memory of this process (and leave the snapshot's copy alone), after which the array behaves like any other.
const N = 300_000;
const big = new Array(N);
for (let i = 0; i < N; i++) big[i] = i;
process.on("restore", () => {
  for (let i = 0; i < 5000; i++) big.push(N + i);
  Bun.gc(true);
  for (let i = 0; i < 5000; i++) big.push(N + 5000 + i);
  Bun.gc(true);
  let ok = big.length === N + 10_000;
  for (const i of [0, 1, N - 1, N, N + 4999, N + 5000, N + 9999]) ok &&= big[i] === i;
  console.log("[js] grown-after-restore " + (ok ? "ok" : "BROKEN length=" + big.length));
  process.exit(ok ? 0 : 1);
});
setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 20);
