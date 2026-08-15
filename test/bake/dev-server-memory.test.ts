import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// The graph work that finishes a dev server bundle (parse completions, linking)
// runs on the JS thread. The `AstAlloc`-backed structures it builds there (among
// them one entry per export of every re-bundled module) used to land on the
// global mimalloc heap, where nothing ever frees them, so every rebuild leaked
// about one block per export. The fixture reports the live block count of that
// heap (`heapStats({ dump: true })`, heap seq 0), which, unlike RSS, is exact:
// once the bundle's allocations die with the bundle it stays flat.
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
  let stderr = "";
  let reloads = 0;
  let waiter: { target: number; resolve(): void; reject(err: Error): void } | undefined;
  const stderrClosed = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stderr) {
      stderr += decoder.decode(chunk, { stream: true });
      reloads = stderr.match(/Reloaded in /g)?.length ?? 0;
      if (waiter && reloads >= waiter.target) {
        waiter.resolve();
        waiter = undefined;
      }
    }
    waiter?.reject(new Error(`dev server exited after ${reloads} reloads:\n${stderr}`));
  })();

  const stdout = proc.stdout.getReader();
  let firstLine = "";
  while (!firstLine.includes("\n")) {
    const { value, done } = await stdout.read();
    if (done) throw new Error(`dev server exited before printing its port:\n${stderr}`);
    firstLine += Buffer.from(value).toString();
  }
  const origin = `http://localhost:${Number.parseInt(firstLine, 10)}`;

  async function get(path: string) {
    const response = await fetch(origin + path);
    const body = await response.text();
    expect(response.status).toBe(200);
    return body;
  }

  async function rebuild(revision: number) {
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
      // A write can surface as more than one watcher event; if an extra
      // rebuild landed while sampling, sample again.
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
