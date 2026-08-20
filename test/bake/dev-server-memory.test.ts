import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// JS-thread bundle work used to leak ~one global-heap block per export per rebuild; the live block count of mimalloc heap seq 0 is exact, unlike RSS.
const EXPORTS = 2000;
const WARMUP_REBUILDS = 3;
const MEASURED_REBUILDS = 15;

function moduleSource(revision: number) {
  let source = `export const revision = ${revision};\n`;
  for (let i = 0; i < EXPORTS; i++) {
    source += `export const e${i} = ${i};\n`;
  }
  return source;
}

test("rebuilding a module does not leak the bundle's allocations", async () => {
  using dir = tempDir("dev-server-memory", {
    "index.html": `<!doctype html><script type="module" src="./script.ts"></script>`,
    "script.ts": `import * as mod from "./mod.ts";\nconsole.log(Object.keys(mod).length);\n`,
    "mod.ts": moduleSource(0),
    "server.ts": `
      import { heapStats } from "bun:jsc";
      import index from "./index.html";

      const server = Bun.serve({
        port: 0,
        development: true,
        routes: {
          "/": index,
          "/live-blocks": () => {
            Bun.gc(true);
            const mainHeap = heapStats({ dump: true }).mimallocDump.heaps.find(heap => heap.seq === 0);
            if (!mainHeap) throw new Error("heapStats dump has no heap with seq 0");
            return new Response(String(mainHeap.pages.reduce((blocks, page) => blocks + page.used, 0)));
          },
        },
      });
      console.log(server.port);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  // The dev server prints "Reloaded in <n>ms" once per completed rebuild.
  const RELOADED = "Reloaded in ";
  let stderr = "";
  let reloads = 0;
  let scanPos = 0;
  let exited: Error | undefined;
  let waiter: { target: number; resolve(): void; reject(err: Error): void } | undefined;
  const stderrClosed = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stderr) {
      stderr += decoder.decode(chunk, { stream: true });
      for (let i = stderr.indexOf(RELOADED, scanPos); i !== -1; i = stderr.indexOf(RELOADED, scanPos)) {
        reloads++;
        scanPos = i + RELOADED.length;
      }
      // Leave a partial marker at the end of the buffer for the next chunk.
      scanPos = Math.max(scanPos, stderr.length - RELOADED.length + 1);
      if (waiter && reloads >= waiter.target) {
        waiter.resolve();
        waiter = undefined;
      }
    }
    exited = new Error(`dev server exited after ${reloads} reloads:\n${stderr}`);
    waiter?.reject(exited);
  })();

  const stdout = proc.stdout.getReader();
  let firstLine = "";
  while (!firstLine.includes("\n")) {
    const { value, done } = await stdout.read();
    if (done) {
      await stderrClosed;
      throw exited;
    }
    firstLine += Buffer.from(value).toString();
  }
  const origin = `http://localhost:${Number.parseInt(firstLine, 10)}`;

  async function get(path: string) {
    if (exited) throw exited;
    const response = await fetch(origin + path);
    const body = await response.text();
    if (response.status !== 200) throw new Error(`GET ${path} responded with ${response.status}:\n${body}`);
    return body;
  }

  async function rebuild(revision: number) {
    // An exit while waiting rejects the waiter instead.
    if (exited) throw exited;
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    waiter = { target: reloads + 1, resolve, reject };
    await Bun.write(join(String(dir), "mod.ts"), moduleSource(revision));
    await promise;
  }

  async function liveBlocks(): Promise<number> {
    while (true) {
      const reloadsBefore = reloads;
      // Page requests are answered once any in-flight bundle has finished.
      await get("/");
      const blocks = Number(await get("/live-blocks"));
      // A write can surface as more than one watcher event; resample if a rebuild landed meanwhile.
      if (reloads === reloadsBefore) return blocks;
    }
  }

  let revision = 0;
  await get("/");
  for (let i = 0; i < WARMUP_REBUILDS; i++) await rebuild(++revision);
  const before = await liveBlocks();
  for (let i = 0; i < MEASURED_REBUILDS; i++) await rebuild(++revision);
  const after = await liveBlocks();

  // Unfixed: at least EXPORTS blocks per rebuild. Fixed: a few hundred at most.
  expect(after - before).toBeLessThan((EXPORTS * MEASURED_REBUILDS) / 4);

  proc.kill();
  await Promise.all([proc.exited, stderrClosed]);
}, 60_000);
