import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// An object with more than 128 properties gets a dictionary structure of its own.
// Before the JavaScriptCore change for #44796, the first overwrite of each property
// on such an object allocated a WatchpointSet and a hash table entry on that
// structure so that the store could be cached. That is one allocation per property
// per object, and the GC freed it again with the object. Now a fired replacement
// watchpoint is one bit.

async function run(source: string, env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return stdout;
}

test.concurrent("the first overwrite of each property on a dictionary object does not allocate per property", async () => {
  // 2000 objects with 1000 properties each. Every property is overwritten once.
  // With the per-offset WatchpointSet, RSS grows by about 130 MiB (release and
  // debug builds alike). With the bit, the growth is the rare data of 2000
  // structures: under 2 MiB.
  const stdout = await run(`
      const N = 1000, OBJECTS = 2000;
      const keys = Array.from({ length: N }, (_, i) => "key" + i);
      const objects = [];
      for (let o = 0; o < OBJECTS; o++) {
        const data = Object.create(null);
        for (let i = 0; i < N; i++) data[keys[i]] = i;
        objects.push(data);
      }
      Bun.gc(true);
      const before = process.memoryUsage.rss();
      for (const data of objects) for (let i = 0; i < N; i++) data[keys[i]] = -i;
      const after = process.memoryUsage.rss();
      let sum = 0;
      for (const data of objects) sum += data[keys[N - 1]];
      console.log(JSON.stringify({ sum, deltaMiB: (after - before) / 2 ** 20 }));
    `);
  const { sum, deltaMiB } = JSON.parse(stdout);
  expect(sum).toBe(-(1000 - 1) * 2000);
  expect(deltaMiB).toBeLessThan(32);
});

// A property of a dictionary object can be watched for replacement by optimized
// code (an Equivalence condition), and a cached replace store must still
// invalidate that code. Both orders: the watch first, then the cached store; and
// the cached store first, so that the watch is refused.
test.concurrent("optimized code sees a replaced property of a dictionary prototype", async () => {
  const stdout = await run(
    `
      function makeProto() {
        const proto = {};
        for (let i = 0; i < 200; i++) proto["p" + i] = i;
        proto.f = function () { return 1; };
        return proto;
      }
      function store(o, k, v) { o[k] = v; }

      // Watch first. call() is optimized while proto.f is still the first function.
      {
        const proto = makeProto();
        const obj = Object.create(proto);
        function call(o) { return o.f(); }
        let sum = 0;
        for (let i = 0; i < 200000; i++) sum += call(obj);
        if (sum !== 200000) throw new Error("warm-up: " + sum);
        for (let i = 0; i < 200; i++) store(proto, "p" + i, -i);
        store(proto, "f", function () { return 2; });
        if (call(obj) !== 2) throw new Error("watch first: stale f");
        if (proto.p199 !== -199) throw new Error("watch first: stale p199");
      }

      // Cached store first. The replace of every property, f included, is cached
      // before call() is optimized, so optimized code may not fold proto.f.
      {
        const proto = makeProto();
        const obj = Object.create(proto);
        function call(o) { return o.f(); }
        for (let i = 0; i < 200; i++) store(proto, "p" + i, -i);
        store(proto, "f", function () { return 1; });
        let sum = 0;
        for (let i = 0; i < 200000; i++) sum += call(obj);
        if (sum !== 200000) throw new Error("warm-up: " + sum);
        store(proto, "f", function () { return 2; });
        if (call(obj) !== 2) throw new Error("store first: stale f");
      }
      console.log("ok");
    `,
    { BUN_JSC_useConcurrentJIT: "0" },
  );
  expect(stdout).toBe("ok\n");
});
