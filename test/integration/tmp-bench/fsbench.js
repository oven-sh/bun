// fsbench.js <old exe> <new exe> [--rounds 7] [--ms 150] [--only text[,text]] [--dir folder]
// Runs both programs in turn and prints the median time of each operation. Writes only below a new temporary folder and
// talks only to a server on 127.0.0.1 that it starts itself. Negative "new vs old" is faster.
import { spawnSync } from "node:child_process";
import dns from "node:dns";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import stream from "node:stream";

// The operations that syscount.js counts and fsbench.js times. Each entry: name -> setup(dir) -> { run(i), n?, after?() }
function cases(fs, path, os, dns, stream) {
  const fsp = fs.promises;
  const file = (dir, name, size) => { const p = path.join(dir, name); fs.writeFileSync(p, Buffer.alloc(size, 97)); return p; };
  const cb = f => new Promise((resolve, reject) => f((e, v) => (e ? reject(e) : resolve(v))));
  const many = (n, f) => Promise.all(Array.from({ length: n }, (_, k) => f(k)));
  const b4k = Buffer.alloc(4096, 98), b64k = Buffer.alloc(65536, 99), b1m = Buffer.alloc(1 << 20, 100);
  const tree = (dir, n) => { const d = path.join(dir, "tree"); fs.mkdirSync(d); for (let i = 0; i < n; i++) fs.writeFileSync(path.join(d, "f" + i), "x"); return d; };
  const withFd = (flags, size, run) => dir => { const fd = fs.openSync(file(dir, "f", size), flags); return { run: i => run(fd, i), after: () => fs.closeSync(fd) }; };
  const fresh = (make, run) => dir => ({ before: i => make(path.join(dir, "n" + i)), run: i => run(path.join(dir, "n" + i), dir, i) });
  const touch = p => fs.closeSync(fs.openSync(p, "w"));
  const C = {
    "openSync+closeSync r": dir => { const p = file(dir, "f", 10); return { run: () => fs.closeSync(fs.openSync(p, "r")) }; },
    "openSync+closeSync relative": dir => { file(dir, "f", 10); process.chdir(dir); return { run: () => fs.closeSync(fs.openSync("f", "r")), after: () => process.chdir(os.tmpdir()) }; },
    "openSync+closeSync wx": dir => ({ run: i => fs.closeSync(fs.openSync(path.join(dir, "n" + i), "wx")) }),
    "readSync 4K position": withFd("r", 1 << 20, (fd, i) => fs.readSync(fd, b4k, 0, 4096, (i % 256) * 4096)),
    "readSync 4K at the end": withFd("r", 0, fd => fs.readSync(fd, b4k, 0, 4096, null)),
    "readSync 64K position": withFd("r", 1 << 20, (fd, i) => fs.readSync(fd, b64k, 0, 65536, (i % 16) * 65536)),
    "writeSync 4K": withFd("w", 0, fd => fs.writeSync(fd, b4k)),
    "writeSync 4K position": withFd("r+", 1 << 20, (fd, i) => fs.writeSync(fd, b4k, 0, 4096, (i % 256) * 4096)),
    "writeSync 64B append": withFd("a", 0, fd => fs.writeSync(fd, b4k, 0, 64)),
    "writevSync 8x512": withFd("w", 0, (bufs => fd => fs.writevSync(fd, bufs))(Array.from({ length: 8 }, () => b4k.subarray(0, 512)))),
    "statSync file": dir => { const p = file(dir, "f", 10); return { run: () => fs.statSync(p) }; },
    "statSync missing, no throw": dir => { const p = path.join(dir, "no"); return { run: () => fs.statSync(p, { throwIfNoEntry: false }) }; },
    "statSync long path": dir => { let d = dir; for (let i = 0; i < 8; i++) fs.mkdirSync((d = path.join(d, "directory-with-a-long-name-" + i))); const p = file(d, "f", 1); return { run: () => fs.statSync(p) }; },
    "lstatSync file": dir => { const p = file(dir, "f", 10); return { run: () => fs.lstatSync(p) }; },
    "lstatSync junction": dir => { const p = path.join(dir, "j"); fs.symlinkSync(dir, p, "junction"); return { run: () => fs.lstatSync(p) }; },
    "fstatSync": withFd("r", 10, fd => fs.fstatSync(fd)),
    "existsSync": dir => { const p = file(dir, "f", 10); return { run: () => fs.existsSync(p) }; },
    "accessSync": dir => { const p = file(dir, "f", 10); return { run: () => fs.accessSync(p) }; },
    "readdirSync 100": dir => { const d = tree(dir, 100); return { run: () => fs.readdirSync(d) }; },
    "readFileSync 4K": dir => { const p = file(dir, "f", 4096); return { run: () => fs.readFileSync(p) }; },
    "readFileSync 1M": dir => { const p = file(dir, "f", 1 << 20); return { run: () => fs.readFileSync(p) }; },
    "writeFileSync 4K new": dir => ({ run: i => fs.writeFileSync(path.join(dir, "n" + i), b4k) }),
    "writeFileSync 4K existing": dir => { const p = file(dir, "f", 4096); return { run: () => fs.writeFileSync(p, b4k) }; },
    "appendFileSync 64B": dir => { const p = file(dir, "f", 0), b = b4k.subarray(0, 64); return { run: () => fs.appendFileSync(p, b) }; },
    "renameSync": dir => { const a = file(dir, "a", 1), b = path.join(dir, "b"); return { run: i => (i & 1 ? fs.renameSync(b, a) : fs.renameSync(a, b)), even: true }; },
    "unlinkSync": fresh(touch, p => fs.unlinkSync(p)),
    "mkdirSync": dir => ({ run: i => fs.mkdirSync(path.join(dir, "n" + i)) }),
    "rmdirSync": fresh(p => fs.mkdirSync(p), p => fs.rmdirSync(p)),
    "mkdtempSync": dir => ({ run: () => fs.mkdtempSync(path.join(dir, "t")) }),
    "symlinkSync junction": dir => ({ run: i => fs.symlinkSync(dir, path.join(dir, "n" + i), "junction") }),
    "readlinkSync": dir => { const p = path.join(dir, "j"); fs.symlinkSync(dir, p, "junction"); return { run: () => fs.readlinkSync(p) }; },
    "linkSync": fresh(touch, p => fs.linkSync(p, p + "l")),
    "realpathSync.native": dir => { const p = file(dir, "f", 1); return { run: () => fs.realpathSync.native(p) }; },
    "copyFileSync 4K": dir => { const p = file(dir, "f", 4096); return { run: i => fs.copyFileSync(p, path.join(dir, "n" + i)) }; },
    "chmodSync": dir => { const p = file(dir, "f", 1); return { run: i => fs.chmodSync(p, i & 1 ? 0o666 : 0o444), even: true }; },
    "fchmodSync": withFd("r+", 1, (fd, i) => fs.fchmodSync(fd, i & 1 ? 0o666 : 0o444)),
    "utimesSync": dir => { const p = file(dir, "f", 1); return { run: i => fs.utimesSync(p, i + 1, i + 1) }; },
    "ftruncateSync": withFd("r+", 4096, (fd, i) => fs.ftruncateSync(fd, 100 + (i & 1))),
    "statfsSync": dir => ({ run: () => fs.statfsSync(dir) }),

    "open+close (callback)": dir => { const p = file(dir, "f", 10); return { run: async () => { const fd = await cb(d => fs.open(p, "r", d)); await cb(d => fs.close(fd, d)); } }; },
    "read 4K position (callback)": withFd("r", 1 << 20, (fd, i) => cb(d => fs.read(fd, b4k, 0, 4096, (i % 256) * 4096, d))),
    "write 4K (callback)": withFd("w", 0, fd => cb(d => fs.write(fd, b4k, d))),
    "read 4K position x32, one fd": withFd("r", 1 << 20, fd => many(32, k => cb(d => fs.read(fd, Buffer.allocUnsafe(4096), 0, 4096, k * 4096, d)))),
    "promises.stat": dir => { const p = file(dir, "f", 10); return { run: () => fsp.stat(p) }; },
    "promises.stat x32": dir => { const p = file(dir, "f", 10); return { run: () => many(32, () => fsp.stat(p)) }; },
    "promises.readdir 100": dir => { const d = tree(dir, 100); return { run: () => fsp.readdir(d) }; },
    "promises.readFile 4K": dir => { const p = file(dir, "f", 4096); return { run: () => fsp.readFile(p) }; },
    "promises.readFile 4K x32": dir => { const p = file(dir, "f", 4096); return { run: () => many(32, () => fsp.readFile(p)) }; },
    "promises.writeFile 4K new": dir => ({ run: i => fsp.writeFile(path.join(dir, "n" + i), b4k) }),
    "promises.unlink": fresh(touch, p => fsp.unlink(p)),
    "promises.rename": dir => { const a = file(dir, "a", 1), b = path.join(dir, "b"); return { run: i => (i & 1 ? fsp.rename(b, a) : fsp.rename(a, b)), even: true }; },
    "promises.copyFile 4K": dir => { const p = file(dir, "f", 4096); return { run: i => fsp.copyFile(p, path.join(dir, "n" + i)) }; },

    "Bun.file 4K .text()": dir => { const p = file(dir, "f", 4096); return { run: () => Bun.file(p).text() }; },
    "Bun.file 4K .text() x32": dir => { const p = file(dir, "f", 4096); return { run: () => many(32, () => Bun.file(p).text()) }; },
    "Bun.file 1M .bytes()": dir => { const p = file(dir, "f", 1 << 20); return { run: () => Bun.file(p).bytes() }; },
    "Bun.file(fd) 4K .text()": withFd("r", 4096, fd => Bun.file(fd).text()),
    "Bun.file .size": dir => { const p = file(dir, "f", 10); return { run: () => Bun.file(p).size }; },
    "Bun.file .exists()": dir => { const p = file(dir, "f", 10); return { run: () => Bun.file(p).exists() }; },
    "Bun.write 4K new": dir => ({ run: i => Bun.write(path.join(dir, "n" + i), b4k) }),
    "Bun.write 4K existing": dir => { const p = file(dir, "f", 4096); return { run: () => Bun.write(p, b4k) }; },
    "Bun.write 4K new x32": dir => ({ run: i => many(32, k => Bun.write(path.join(dir, `n${i}-${k}`), b4k)) }),
    "Bun.write 1M existing": dir => { const p = file(dir, "f", 1 << 20); return { run: () => Bun.write(p, b1m) }; },
    "Bun.write(path, Bun.file) 4K": dir => { const p = file(dir, "f", 4096); return { run: i => Bun.write(path.join(dir, "n" + i), Bun.file(p)) }; },
    "Bun.write(fd, Bun.file) 1M": dir => { const p = file(dir, "s", 1 << 20), fd = fs.openSync(path.join(dir, "d"), "w"); return { run: async () => { await Bun.write(Bun.file(fd), Bun.file(p)); }, after: () => fs.closeSync(fd), max: 200 }; },
    "Bun.file 1M .stream()": dir => { const p = file(dir, "f", 1 << 20); return { run: async () => { for await (const _ of Bun.file(p).stream()); } }; },
    "Bun.file .writer() 16x64K": dir => { const p = path.join(dir, "f"); return { run: async () => { const w = Bun.file(p).writer(); for (let k = 0; k < 16; k++) { w.write(b64k); await w.flush(); } await w.end(); } }; },
    "createReadStream 1M": dir => { const p = file(dir, "f", 1 << 20); return { run: async () => { for await (const _ of fs.createReadStream(p)); } }; },
    "createWriteStream 16x64K": dir => { const p = path.join(dir, "f"); return { run: async () => { const w = fs.createWriteStream(p); for (let k = 0; k < 16; k++) w.write(b64k); await cb(d => w.end(d)); await cb(d => (w.closed ? d() : w.once("close", d))); } }; },
    "pipeline read->write 1M": dir => { const p = file(dir, "f", 1 << 20), q = path.join(dir, "g"); return { run: () => stream.promises.pipeline(fs.createReadStream(p), fs.createWriteStream(q)) }; },

    "os.cpus()": () => ({ run: () => os.cpus()[0].model }),
    "os.networkInterfaces()": () => ({ run: () => os.networkInterfaces() }),
    "os.freemem()": () => ({ run: () => os.freemem() }),
    "os.homedir()": () => ({ run: () => os.homedir() }),
    "os.uptime()": () => ({ run: () => os.uptime() }),
    "process.cpuUsage()": () => ({ run: () => process.cpuUsage() }),
    "process.memoryUsage.rss()": () => ({ run: () => process.memoryUsage.rss() }),
    "process.resourceUsage()": () => ({ run: () => process.resourceUsage() }),
    "dns.lookup localhost": () => ({ run: () => dns.promises.lookup("localhost") }),
    "dns.lookup 127.0.0.n x32": () => ({ run: () => many(32, k => Bun.dns.lookup("127.0.0." + (k + 1), { backend: "system" })) }),
  };
  return C;
}


const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const only = option("--only", "").split(",").filter(Boolean);
const wanted = name => !only.length || only.some(text => name.includes(text));
const budget = Number(option("--ms", 150)) * 1e6;
const median = list => [...list].sort((a, b) => a - b)[list.length >> 1];
const remove = dir => {
  for (let i = 0; i < 20; i++) {
    try {
      return fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      Bun.sleepSync(50);
    }
  }
};

if (args[0] === "--child") {
  const root = fs.mkdtempSync(path.join(args[1], "c"));
  const result = {};
  let id = 0;
  for (const [name, setup] of Object.entries(cases(fs, path, os, dns, stream))) {
    if (!wanted(name)) continue;
    const dir = path.join(root, "d" + id++);
    fs.mkdirSync(dir);
    try {
      const c = setup(dir);
      let i = 0, timed = 0, spent = 0, batch = 4;
      const run = async () => {
        for (let k = 0; k < batch; k++) c.before?.(i + k);
        const start = Bun.nanoseconds();
        for (let k = 0; k < batch; k++) {
          const r = c.run(i + k);
          if (r instanceof Promise) await r;
        }
        i += batch;
        return Bun.nanoseconds() - start;
      };
      await run();
      while (spent < budget && i < (c.max ?? 4000 * (c.before ? 1 : 50))) {
        const took = await run();
        spent += took;
        timed += batch;
        if (took < budget / 8) batch = Math.min(batch * 2, 1024);
      }
      c.after?.();
      result[name] = spent / timed;
    } catch (error) {
      result[name] = String(error.code ?? error.message);
    }
    remove(dir);
  }
  remove(root);
  console.log(JSON.stringify(result));
  process.exit(0);
}

const exes = args.slice(0, 2).map(exe => path.resolve(exe));
if (exes.length < 2 || !exes.every(exe => fs.existsSync(exe))) {
  console.log("usage: bun fsbench.js <old exe> <new exe> [--rounds 7] [--ms 150] [--only text[,text]] [--dir folder]");
  process.exit(1);
}
const rounds = Number(option("--rounds", 7));
const root = fs.mkdtempSync(path.join(path.resolve(option("--dir", os.tmpdir())), "fsbench-"));
const env = { ...process.env, NO_PROXY: "127.0.0.1", no_proxy: "127.0.0.1", BUN_ENABLE_CRASH_REPORTING: "0", DO_NOT_TRACK: "1", NO_COLOR: "1", BUN_INSTALL_PROGRESS: "0" };

// ---- whole commands ----
function tar(files) {
  const blocks = [];
  for (const [name, text] of files) {
    const body = Buffer.from(text), head = Buffer.alloc(512);
    head.write(name, 0);
    head.write("0000644\0" + "0000000\0" + "0000000\0" + body.length.toString(8).padStart(11, "0") + "\0" + "00000000000\0" + "        " + "0", 100);
    head.write("ustar\0" + "00", 257);
    head.write(head.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 ", 148);
    blocks.push(head, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  return Bun.gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
const PACKAGES = 60, FILES = 40;
const tarballs = new Map();
for (let p = 0; p < PACKAGES; p++) {
  const name = "pkg-" + p;
  const files = [["package/package.json", JSON.stringify({ name, version: "1.0.0", main: "lib/m0.js" })]];
  for (let f = 0; f < FILES; f++)
    files.push([`package/lib/m${f}.js`, `${f + 1 < 5 ? `require("./m${f + 1}.js");` : ""}exports.v = ${JSON.stringify("x".repeat(500 + f * 40))};\n`]);
  tarballs.set(name, tar(files));
}
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
    const [, name, file] = new URL(request.url).pathname.split("/");
    if (!tarballs.has(name)) return new Response("", { status: 404 });
    if (file) return new Response(tarballs.get(name));
    const version = { name, version: "1.0.0", dist: { tarball: `${server.url}${name}/t.tgz` } };
    return Response.json({ name, "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": version } });
  },
});
const project = (() => {
  const dir = path.join(root, "project");
  fs.mkdirSync(dir);
  const dependencies = Object.fromEntries([...tarballs.keys()].map(name => [name, "1.0.0"]));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "project", dependencies }));
  fs.writeFileSync(path.join(dir, "bunfig.toml"), `[install]\nregistry = "${server.url}"\n`);
  fs.writeFileSync(path.join(dir, "empty.js"), "");
  fs.writeFileSync(path.join(dir, "load.js"), [...tarballs.keys()].map(name => `require("${name}");`).join("\n"));
  fs.writeFileSync(path.join(dir, "log.js"), `for (let i = 0; i < 20000; i++) console.log("line", i);`);
  fs.writeFileSync(path.join(dir, "writeSync.js"), `const fs = require("fs"); for (let i = 0; i < 20000; i++) fs.writeSync(1, "line\\n");`);
  return dir;
})();
async function command(n, argv, before) {
  const cwd = project;
  before?.(cwd);
  const start = Bun.nanoseconds();
  const child = Bun.spawn([exes[n], ...argv], { cwd, env: { ...env, BUN_INSTALL_CACHE_DIR: path.join(cwd, ".cache"), BUN_CONFIG_REGISTRY: server.url.href, NPM_CONFIG_REGISTRY: server.url.href, npm_config_registry: server.url.href }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [, stderr, code] = await Promise.all([child.stdout.bytes(), child.stderr.text(), child.exited]);
  return code === 0 ? Bun.nanoseconds() - start : "exit " + code + " " + stderr.replace(/\s+/g, " ").slice(0, 200);
}
const modules = cwd => remove(path.join(cwd, "node_modules"));
const commands = {
  [`install ${PACKAGES}x${FILES} files, empty cache`]: n => command(n, ["install"], cwd => (modules(cwd), remove(path.join(cwd, ".cache")))),
  "install from cache, copyfile": n => command(n, ["install", "--backend=copyfile"], modules),
  "install from cache, isolated": n => command(n, ["install", "--linker=isolated"], modules),
  "install from cache": n => command(n, ["install", "--linker=hoisted"], modules),
  "install, nothing to do": n => command(n, ["install", "--linker=hoisted"]),
  "run an empty file": n => command(n, ["empty.js"]),
  [`require ${PACKAGES * 5} modules`]: n => command(n, ["load.js"]),
  [`build ${PACKAGES * 5} modules`]: n => command(n, ["build", "load.js", "--outdir", "out"]),
  "console.log x20000 into a pipe": n => command(n, ["log.js"]),
  "fs.writeSync(1) x20000 into a pipe": n => command(n, ["writeSync.js"]),
};

const samples = new Map();
const note = (name, n, value) => (samples.get(name) ?? samples.set(name, [[], []]).get(name))[n].push(value);
for (let round = 0; round < rounds; round++) {
  process.stderr.write(`round ${round + 1} of ${rounds}\n`);
  const order = round & 1 ? [1, 0] : [0, 1];
  for (const n of order) {
    const child = spawnSync(exes[n], [import.meta.path, "--child", root, ...args.slice(2)], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    try {
      for (const [name, value] of Object.entries(JSON.parse(child.stdout.trim().split("\n").at(-1)))) note(name, n, value);
    } catch {
      note("(the run failed)", n, `exit ${child.status} ${child.stderr.slice(0, 200)}`);
    }
  }
  for (const [name, run] of Object.entries(commands)) if (wanted(name) || name === "install from cache") for (const n of order) note(name, n, await run(n));
}
server.stop(true);
remove(root);

const version = exe => spawnSync(exe, ["--revision"], { env, encoding: "utf8" }).stdout.trim();
console.log(`${os.version()} ${os.release()} ${os.arch()}, ${os.cpus().length} x ${os.cpus()[0].model.trim()}`);
console.log(`old = ${version(exes[0])}, new = ${version(exes[1])}, ${rounds} rounds, microseconds per operation\n`);
const show = ns => (ns / 1000).toFixed(ns < 1e5 ? 2 : 0);
const percent = (y, x) => `${y > x ? "+" : ""}${((y / x - 1) * 100).toFixed(1)}%`;
console.log("operation".padEnd(38), ...["old", "new", "new vs old", "old best", "new best", "new vs old"].map(text => text.padStart(11)));
for (const [name, [a, b]] of samples) {
  const failure = [...a, ...b].find(value => typeof value === "string");
  if (failure !== undefined || !a.length || !b.length) {
    console.log(name.padEnd(38), "failed:", failure);
    continue;
  }
  const [x, y, p, q] = [median(a), median(b), Math.min(...a), Math.min(...b)];
  const mark = y > x * 1.05 && q > p * 1.05 && q > x ? "  <-- slower" : "";
  console.log(name.padEnd(38), ...[show(x), show(y), percent(y, x), show(p), show(q), percent(q, p)].map(text => text.padStart(11)), mark);
}
