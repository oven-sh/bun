// Spawned by test/bake/app-plugins-release.test.ts, once per case, with this
// directory as cwd.
//
// `Bun.serve({ app: { plugins } })` creates one native BundlerPlugin cell (the
// JSC class name of JSBundlerPlugin) holding every setup()/onLoad/onResolve
// closure, and protects it from GC until whoever owns it releases it. Each case
// below makes the cell's owner go away in a different way and prints, as one
// JSON line, how many cells are still alive after a full GC: the number of
// cells that path leaked. Every case runs in its own process because a dev
// server's file watcher instance is only given back when the process exits.
import { getDevServerDeinitCount } from "bun:internal-for-testing";
import { heapStats } from "bun:jsc";

function liveCells(): number {
  return heapStats().objectTypeCounts.BundlerPlugin ?? 0;
}

// A released cell is only unprotected: it still has to be collected, and a
// stale pointer to it on the native stack can keep it alive for a collection,
// so alternate collections with turns of the event loop. A released cell is
// normally gone after the first collection; a protected one survives all of
// them, which is what a leak looks like.
async function liveCellsAfterGC(expected: number): Promise<number> {
  for (let attempt = 0; attempt < 10 && liveCells() !== expected; attempt++) {
    Bun.gc(true);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return liveCells();
}

function serveOptions(setup: (build: Bun.PluginBuilder) => void, serverEntryPoint = "./server.ts") {
  return {
    port: 0,
    development: true,
    fetch: () => new Response("unused"),
    app: {
      framework: {
        fileSystemRouterTypes: [{ root: "routes", style: "nextjs-pages", serverEntryPoint }],
      },
      plugins: [{ name: "probe", setup }],
    },
  } as Bun.Serve.Options<undefined>;
}

function registerOnLoad(build: Bun.PluginBuilder) {
  build.onLoad({ filter: /\.probe$/ }, () => ({ contents: "", loader: "js" }));
}

// Every dev server needs a file watcher instance (inotify on Linux), which is
// a per-user limit shared with every other process on the machine. When the
// machine is out of them, wait for one instead of failing on the spot. (Each
// attempt that fails this way parses the options, so it creates and rejects a
// cell of its own.)
async function serve(options: Bun.Serve.Options<undefined>): Promise<Bun.Server<undefined>> {
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      return Bun.serve(options);
    } catch (error) {
      if (!(error as Error).message.startsWith("EMFILE") || Date.now() > deadline) throw error;
      await Bun.sleep(100);
    }
  }
}

async function serveError(options: Bun.Serve.Options<undefined>): Promise<string> {
  try {
    (await serve(options)).stop(true);
    return "did not throw";
  } catch (error) {
    return (error as Error).message;
  }
}

let report: Record<string, unknown>;
switch (process.argv[2]) {
  // The dev server takes the cell over from the parsed options and has to
  // release it when the stopped server tears the dev server down.
  case "stopped-server": {
    const server = await serve(serveOptions(registerOnLoad));
    // The running dev server's cell is the one that must survive a collection.
    const cellsWhileServing = await liveCellsAfterGC(1);
    server.stop(true);
    report = { cellsWhileServing };
    break;
  }
  // The cell already exists when a plugin's setup() makes Bun.serve() throw,
  // so the rejected options have to release it. No dev server is involved.
  case "setup-throws": {
    const error = await serveError(
      serveOptions(() => {
        throw new Error("setup failed on purpose");
      }),
    );
    report = { error };
    break;
  }
  // The dev server has already taken the cell over when it fails to resolve
  // the framework's files, so the dev server that never finished initializing
  // has to release it as it is torn down.
  case "init-fails": {
    const error = await serveError(serveOptions(registerOnLoad, "./does-not-exist.ts"));
    report = { error };
    break;
  }
  default:
    throw new Error(`unknown case ${JSON.stringify(process.argv[2])}`);
}

report.leakedCells = await liveCellsAfterGC(0);
// Read after the collections above gave a stopped server its turns of the
// event loop to tear the dev server down.
report.devServersDeinitialized = getDevServerDeinitCount();
console.log(JSON.stringify(report));
