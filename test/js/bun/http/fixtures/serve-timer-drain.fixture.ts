const [mode, argA, argB] = process.argv.slice(2);
if (mode === "server") {
  let reqs = 0,
    fires = 0,
    lastFire = performance.now(),
    lastLog = performance.now(),
    maxGap = 0;
  function log() {
    const now = performance.now();
    if (now - lastLog < 1000) return;
    console.log(
      JSON.stringify({
        reqs,
        timerFires: fires,
        msSinceLastTimerFire: Math.round(now - lastFire),
        maxGap: Math.round(maxGap),
      }),
    );
    reqs = fires = 0;
    lastLog = now;
  }
  setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - lastFire);
    fires++;
    lastFire = now;
    log();
  }, 20);
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch() {
      reqs++;
      log();
      const s = performance.now();
      while (performance.now() - s < 0.08) {}
      return new Response("ok");
    },
  });
  console.log(JSON.stringify({ port: server.port, bun: Bun.version }));
} else {
  const url = "http://127.0.0.1:" + argA + "/";
  await Promise.all(
    Array.from({ length: Number(argB) }, async () => {
      for (;;) await (await fetch(url)).text();
    }),
  );
}
