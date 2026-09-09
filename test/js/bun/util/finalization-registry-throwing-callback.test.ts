import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// JSC's JSFinalizationRegistry::runFinalizationCleanup stops at the first
// cleanup callback that throws. Nothing re-armed the cleanup task until a
// later GC noticed the registry still had dead holdings, so in an idle
// process the rest of the batch never ran. V8 re-posts its cleanup task after
// a throw; the fork does the same now.

test("FinalizationRegistry cleanup reaches every dead holding without another GC when callbacks throw", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const ran = [];
        let uncaught = 0;
        process.on("uncaughtException", err => {
          if (String(err?.message).startsWith("fr-")) uncaught++;
        });
        const registry = (globalThis.PINNED = new FinalizationRegistry(h => {
          ran.push(h);
          if (h % 2 === 0) throw new Error("fr-" + h);
        }));
        (function () {
          for (let i = 0; i < 20; i++) registry.register({}, i);
        })();
        // Two collections (the second from another frame so the last
        // registered target is not still held by a stack slot). After that no
        // GC runs: only the cleanup task re-arming itself can reach the rest.
        Bun.gc(true);
        await new Promise(resolve => setImmediate(resolve));
        Bun.gc(true);
        for (let i = 0; i < 100 && ran.length < 20; i++) {
          await new Promise(resolve => setImmediate(resolve));
        }
        ran.sort((a, b) => a - b);
        console.log(JSON.stringify({ ran, uncaught, reachable: globalThis.PINNED === registry }));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ ...JSON.parse(stdout.trim() || "{}"), stderr, signal: proc.signalCode }).toEqual({
    ran: Array.from({ length: 20 }, (_, i) => i),
    uncaught: 10,
    reachable: true,
    stderr: "",
    signal: null,
  });
  expect(exitCode).toBe(0);
});
