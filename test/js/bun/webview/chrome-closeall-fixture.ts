// Spawned by webview-chrome-disconnect.test.ts. The Chrome transport is a
// process-wide singleton and this scenario kills it, so it runs in a Bun
// process of its own. It launches a real Chrome, leaves a page committed but
// never loaded, SIGKILLs the browser through closeAll(), and prints one JSON
// line: what became of the promises that were waiting, of the view, and of
// Chrome's process tree.
import { dlopen } from "bun:ffi";
import { closeSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const shape = (e: any) => ({ name: e.name, code: e.code ?? null, message: e.message });

// Records how a promise settles. Reads as { pending: true } until it does.
function watch(promise: Promise<unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { pending: true };
  promise.then(
    resolved => {
      delete result.pending;
      result.resolved = resolved ?? null;
    },
    e => {
      delete result.pending;
      result.rejected = shape(e);
    },
  );
  return result;
}

function thrown(fn: () => unknown) {
  try {
    return { returned: fn() ?? null };
  } catch (e) {
    return { threw: shape(e) };
  }
}

function isElf(path: string): boolean {
  const magic = Buffer.alloc(4);
  const fd = openSync(path, "r");
  try {
    return readSync(fd, magic, 0, 4, 0) === 4 && magic.equals(Buffer.from("\x7fELF", "latin1"));
  } finally {
    closeSync(fd);
  }
}

// The shared libraries a binary loads, resolved by ldd(1). Empty if ldd is
// missing or fails.
function sharedLibraries(binary: string): string[] {
  const paths = new Set<string>();
  try {
    const ldd = Bun.spawnSync({ cmd: ["ldd", binary], stdout: "pipe", stderr: "ignore" });
    if (!ldd.success) return [];
    for (const line of ldd.stdout.toString().split("\n")) {
      const resolved = / => (\/\S+) \(/.exec(line);
      if (resolved) paths.add(realpathSync(resolved[1]));
    }
  } catch {}
  return [...paths];
}

// On a fresh CI agent nothing of the browser is in the page cache yet, and
// Chrome's start-up pages its ~200 MB in one page fault at a time: 6 to
// 18 s on the Linux lanes. POSIX_FADV_WILLNEED hands the install directory
// and the browser's shared libraries to the kernel's read-ahead instead,
// which keeps the disk queue full, and the launch then finds the pages in
// cache. One call reads at most one read-ahead window, so each file is
// requested window by window. Best effort: if anything here fails, the
// launch is only slower. Returns what was requested, so the test can log it
// next to the launch time.
function warmBrowserInstall(executable: string | undefined, libc: string | undefined) {
  const done = { files: 0, bytes: 0, ms: 0 };
  if (process.platform !== "linux" || !executable || !libc) return done;
  const started = performance.now();
  try {
    const dir = dirname(realpathSync(executable));
    const files = readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => {
        const path = join(dir, entry.name);
        return { path, size: statSync(path).size };
      })
      .sort((a, b) => b.size - a.size);
    // The executable itself is usually a launcher script (google-chrome,
    // chromium-launcher.sh) next to the browser, and BUN_CHROME_PATH can name
    // a wrapper that lives anywhere. Only a directory whose largest file is a
    // browser-sized ELF executable is an install directory, and that file is
    // the browser.
    if (!files.length || files[0].size < 64 * 1024 * 1024 || !isElf(files[0].path)) return done;
    for (const path of sharedLibraries(files[0].path)) {
      files.push({ path, size: statSync(path).size });
    }
    const POSIX_FADV_WILLNEED = 3;
    const WINDOW = 128 * 1024;
    const { posix_fadvise } = dlopen(libc, {
      posix_fadvise: { args: ["i32", "i64", "i64", "i32"], returns: "i32" },
    }).symbols;
    for (const { path, size } of files) {
      const fd = openSync(path, "r");
      for (let offset = 0; offset < size; offset += WINDOW) {
        posix_fadvise(fd, offset, Math.min(WINDOW, size - offset), POSIX_FADV_WILLNEED);
      }
      closeSync(fd);
      done.files++;
      done.bytes += size;
    }
  } catch {}
  done.ms = Math.round(performance.now() - started);
  return done;
}

type Proc = { pid: number; ppid: number; state: string };

// Every process on the system, from /proc. Linux only, the same condition the
// test uses for its process counts; empty elsewhere.
function processTable(): Proc[] {
  if (process.platform !== "linux") return [];
  const names = readdirSync("/proc");
  const table: Proc[] = [];
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    let stat: string;
    try {
      stat = readFileSync(`/proc/${name}/stat`, "utf8");
    } catch {
      continue; // gone between readdir and read
    }
    // "<pid> (<comm>) <state> <ppid> ..."; comm itself can contain ')'.
    const [state, ppid] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    table.push({ pid: Number(name), ppid: Number(ppid), state });
  }
  return table;
}

function children(table: Proc[], parent: number): number[] {
  return table.filter(p => p.ppid === parent).map(p => p.pid);
}

function descendants(table: Proc[], roots: number[]): number[] {
  const pids: number[] = [];
  const queue = [...roots];
  for (let parent = queue.shift(); parent !== undefined; parent = queue.shift()) {
    for (const pid of children(table, parent)) {
      pids.push(pid);
      queue.push(pid);
    }
  }
  return pids;
}

// Those of `pids` that still run. A zombie has exited and only waits to be
// reaped.
function alive(pids: number[]): number[] {
  const table = processTable();
  return pids.filter(pid => table.some(p => p.pid === pid && p.state !== "Z"));
}

const warmUp = warmBrowserInstall(process.env.CHROME_EXECUTABLE, process.env.LIBC_PATH);

// --no-sandbox: Chrome refuses to start as root otherwise (containers).
const launchStarted = performance.now();
const view = new Bun.WebView({
  backend: { type: "chrome", url: false, argv: ["--no-sandbox"] },
  width: 100,
  height: 100,
});
await view.navigate("data:text/html,<body></body>");
const launchMs = Math.round(performance.now() - launchStarted);
// The browser is this process's only child. Its helpers (zygote, GPU,
// renderer, and the cat(1)s Chrome keeps on the debugging pipe) hang off it.
const table = processTable();
const browser = children(table, process.pid);
const helpers = descendants(table, browser);

// The document commits, but its <img> request is never answered, so the
// load event never fires and navigate() stays pending.
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    if (new URL(req.url).pathname === "/hang") return new Promise(() => {});
    return new Response("<img src='/hang'>", { headers: { "content-type": "text/html" } });
  },
});
const committed = Promise.withResolvers<void>();
view.onNavigated = () => committed.resolve();
const navigate = watch(view.navigate(server.url.href));
await committed.promise;
const loadingBefore = view.loading;

// Still waiting for Chrome's reply when it dies. It rejects once the death
// has been processed, and the navigate() promise is settled by then too.
const evaluate = view.evaluate("new Promise(() => {})");
const unanswered = watch(evaluate);
const closeAll = thrown(() => Bun.WebView.closeAll());
await evaluate.catch(() => {});
const loadingAfter = view.loading;
const afterDeath = {
  evaluate: thrown(() => view.evaluate("1")),
  closeAll: thrown(() => Bun.WebView.closeAll()),
  close: thrown(() => view.close()),
};

// closeAll() SIGKILLs the browser process and the runtime reaps it. Its
// helpers are Chrome's own: they exit once they notice, which on a loaded
// machine takes longer than this test waits, so only the browser is polled.
const deadline = Date.now() + 5000;
let browserLeft = alive(browser);
while (browserLeft.length && Date.now() < deadline) {
  await Bun.sleep(5);
  browserLeft = alive(browser);
}

console.log(
  JSON.stringify({
    warmUp,
    launchMs,
    chrome: { browser: browser.length, helpers: helpers.length },
    loadingBefore,
    closeAll,
    unanswered,
    navigate,
    loadingAfter,
    afterDeath,
    browserLeft,
  }),
);
server.stop(true);
