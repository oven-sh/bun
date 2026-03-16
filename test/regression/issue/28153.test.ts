import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for #28153: segfault from heap corruption after long uptime.
//
// Root cause: MimallocArena heaps shared tag 0 with the backing heap.
// During mimalloc segment reclamation, abandoned pages from dead workers'
// backing heaps were routed to MimallocArena heaps via _mi_heap_by_tag.
// When those arenas were destroyed, the reclaimed pages (with live blocks)
// were freed — corrupting the heap.
//
// The fix assigns a non-zero heap tag to MimallocArena heaps so reclaimed
// pages from dead workers go to the backing heap (which is never destroyed).

test("concurrent transpilation + worker teardown does not corrupt heap", async () => {
  using dir = tempDir("issue-28153", {
    "main.ts": `
const transpiler = new Bun.Transpiler({ loader: "tsx" });

async function runWorker(): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
    worker.onmessage = () => { worker.terminate(); resolve(); };
    worker.onerror = reject;
  });
}

// Phase 1: Rapid worker creation/teardown to build up abandoned pages.
for (let round = 0; round < 3; round++) {
  const workers: Promise<void>[] = [];
  for (let i = 0; i < 4; i++) workers.push(runWorker());
  await Promise.all(workers);

  // Between rounds, do transforms that create/destroy MimallocArenas,
  // which may reclaim abandoned pages from dead workers.
  const code = 'const x: number = ' + round + '; export default x;';
  for (let i = 0; i < 100; i++) {
    transpiler.transformSync(code, "ts");
  }
}

// Phase 2: Verify heap integrity by allocating and checking buffers.
const bufs: Uint8Array[] = [];
for (let i = 0; i < 50; i++) {
  const buf = new Uint8Array(8192);
  buf.fill(i & 0xff);
  bufs.push(buf);
}
for (let i = 0; i < bufs.length; i++) {
  const expected = i & 0xff;
  for (let j = 0; j < bufs[i].length; j++) {
    if (bufs[i][j] !== expected) {
      console.error("HEAP_CORRUPT:", i, j, bufs[i][j], expected);
      process.exit(1);
    }
  }
}

console.log("PASS");
`,
    "worker.ts": `
// Allocate heavily to create mimalloc pages on the backing heap.
const arrays: Uint8Array[] = [];
for (let i = 0; i < 500; i++) {
  arrays.push(new Uint8Array(2048).fill(i & 0xff));
}
// Also do transpilation inside worker (creates MimallocArena on worker thread).
const t = new Bun.Transpiler({ loader: "ts" });
for (let i = 0; i < 20; i++) {
  t.transformSync("const a: number = " + i + ";", "ts");
}
postMessage("done");
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (stderr) {
    console.error("stderr:", stderr);
  }
  expect(stdout.trim()).toBe("PASS");
  expect(exitCode).toBe(0);
}, 30_000);
