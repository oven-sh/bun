import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/28153
// MimallocArena used heap tag 0 (same as the backing heap). When worker
// threads exit, mimalloc routes their abandoned pages to the arena
// instead of the backing heap. mi_heap_destroy then frees live blocks
// from those reclaimed pages, corrupting the malloc free-list.
// The fix uses mi_heap_new_ex with a non-zero tag so abandoned pages
// are routed to the backing heap where they belong.
test("worker threads exiting with concurrent transpiler use does not corrupt heap", async () => {
  using dir = tempDir("issue-28153", {
    "worker.ts": `
      const buffers: Uint8Array[] = [];
      for (let i = 0; i < 50; i++) {
        buffers.push(new Uint8Array(4096).fill(i & 0xff));
      }
      postMessage("done");
    `,
    "index.ts": `
      const transpiler = new Bun.Transpiler({ loader: "tsx" });

      async function spawnWorker(): Promise<void> {
        return new Promise((resolve, reject) => {
          const w = new Worker("./worker.ts");
          w.onmessage = () => { w.terminate(); resolve(); };
          w.onerror = (e) => reject(e);
        });
      }

      // Spawn a few workers sequentially, transpiling between each
      for (let i = 0; i < 4; i++) {
        await spawnWorker();
        transpiler.transformSync("const x" + i + ": number = " + i + ";");
      }

      // Allocate after workers exited and arenas were destroyed
      const results: Uint8Array[] = [];
      for (let i = 0; i < 100; i++) {
        const buf = new Uint8Array(4096);
        buf.fill(0x42);
        results.push(buf);
      }

      let ok = true;
      for (const buf of results) {
        for (let j = 0; j < buf.length; j++) {
          if (buf[j] !== 0x42) { ok = false; break; }
        }
        if (!ok) break;
      }

      console.log(ok ? "PASS" : "FAIL");
      process.exit(ok ? 0 : 1);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("PASS");
  expect(exitCode).toBe(0);
});
