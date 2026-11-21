// @bun
// Stress run for Bun on Windows. Two to three minutes per executable.
//
//   bun.exe win-stress.js                                  tests the bun.exe that runs it
//   --only a,b   --seconds n (per scenario, default 6)   --seed n   --list
//
// It writes only below %TEMP%\bun-stress-*, talks only to 127.0.0.1 and to named pipes of its own, and kills only
// processes that it started. Crash reports are not uploaded. Each scenario is a process of its own.
//
// PASS; FAIL (wrong data or result); HANG (an operation never ended); STUCK (the event loop stopped turning);
// LINGERS (done, but the process did not exit); CRASH; SKIP.

const require = import.meta.require;
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { once } = require("node:events");

// -- shared with every child --

function library() {
  let state = (Number(process.env.STRESS_SEED ?? 1) * 2654435761) >>> 0 || 1;
  const rnd = n => ((state ^= state << 13), (state ^= state >>> 17), (state ^= state << 5), (state >>>= 0), state % n);
  const pick = list => list[rnd(list.length)];
  const pattern = (size, salt) => {
    const bytes = Buffer.allocUnsafe(size);
    for (let i = 0; i < size; i += 4096) bytes.fill(`${salt}:${i}|`, i, Math.min(size, i + 4096));
    return bytes;
  };
  const sha = bytes => Bun.SHA1.hash(bytes, "hex");
  /** The hash of the first `size` bytes of a stream. */
  const digest = (stream, size) =>
    new Promise(resolve => {
      const hash = new Bun.CryptoHasher("sha1");
      stream.on("data", chunk => (hash.update(chunk), (size -= chunk.length) <= 0 && resolve(hash.digest("hex"))));
    });
  const program = (name, ...args) => [process.execPath, require("path").join(process.env.STRESS_PROGRAMS, name + ".js"), ...args.map(String)];
  return { rnd, pick, pattern, sha, digest, program };
}
const { rnd, pick, pattern, sha, digest, program } = library();

/** Each becomes a file. None lives longer than half a minute. */
const programs = {
  nothing() {},
  idle() {
    setTimeout(() => {}, 20000);
  },
  chatty() {
    setInterval(() => process.stdout.write(Buffer.alloc(4000, "x")), 0);
    setTimeout(() => process.exit(3), 20000);
  },
  cat(how) {
    if (how === "pipe") process.stdin.pipe(process.stdout);
    else if (how === "write") Bun.write(Bun.stdout, Bun.stdin.stream());
    else if (how === "await") (async () => { for await (const chunk of Bun.stdin.stream()) await Bun.write(Bun.stdout, chunk); })();
    else {
      const fs = require("fs"), buffer = Buffer.alloc(50000);
      for (let n; (n = fs.readSync(0, buffer)); ) for (let at = 0; at < n; ) at += fs.writeSync(1, buffer, at, n - at);
    }
  },
  middle(how) {
    const idle = program("idle"), stdio = ["ignore", "inherit", "inherit"];
    require("fs").writeSync(2, "!");
    if (how === "spawn") Bun.spawn(idle, { stdio });
    else if (how === "spawnSync") Bun.spawnSync(idle, { stdio });
    else if (how === "node") require("child_process").spawn(idle[0], idle.slice(1), { stdio });
    else if (how === "three") for (let i = 0; i < 3; i++) Bun.spawn(idle, { stdio });
    else if (how === "deep") Bun.spawn(program("middle", "spawn"), { stdio });
    else Bun.$`${idle}`.then(() => {});
  },
  async duplex(how, size) {
    const net = require("net"), socket = how === "stdio" ? null : how === "fd3" ? net.connect({ fd: 3 }) : net.connect(how);
    const got = digest(socket ?? process.stdin, +size);
    await new Promise(resolve => (socket ?? process.stdout).write(pattern(+size, "c"), resolve));
    console.error(await got);
    process.stdin.destroy();
  },
  echo() {
    let next = 0;
    process.on("message", (message, handle) => {
      if (message.i !== next++) process.send({ bad: "out of order in the child" });
      if (message.handle && !handle) process.send({ bad: "no handle came" });
      if (handle instanceof require("net").Socket) handle.end("from child " + message.i);
      else handle?.close();
      if (!message.last) return process.send({ i: message.i, text: message.text });
      const leave = { exit: () => process.exit(0), disconnect: () => process.disconnect(), unref: () => process.channel.unref() };
      process.send({ done: next }, leave[message.last]);
    });
  },
  typist(port) {
    const control = require("net").connect(+port, "127.0.0.1");
    process.stdin.on("data", data => control.write(data));
    control.write("@");
    setInterval(() => {
      const k = rnd(6);
      if (k === 0) process.stdin.setRawMode(!process.stdin.isRaw);
      else if (k === 1) process.stdin.pause(), setTimeout(() => process.stdin.resume(), rnd(5));
      else if (k === 2) process.stdout.write("noise " + "x".repeat(rnd(300)) + "\n");
    }, 2);
  },
  leave(writer, way, size) {
    const fs = require("fs"), data = Buffer.alloc(+size, "x");
    const write = {
      "process.stdout": () => process.stdout.write(data),
      "many writes": () => { for (let i = 0; i < data.length; i += 1000) process.stdout.write(data.subarray(i, i + 1000)); },
      "console.log": () => console.log(data.toString().slice(1)),
      "Bun.write": () => Bun.write(Bun.stdout, data),
      "writer": () => Bun.stdout.writer().write(data),
      "writer+flush": () => { const sink = Bun.stdout.writer(); sink.write(data), sink.flush(); },
      "fs.write": () => fs.write(1, data, () => {}),
    }[writer];
    if (way === "in exit") return process.on("exit", write);
    write();
    if (way === "exit") process.exit(0);
    if (way === "tick") process.nextTick(() => process.exit(0));
    if (way === "immediate") setImmediate(() => process.exit(0));
    if (way === "throw") throw 1;
  },
  send(address, size) {
    require("net").connect(...(+address ? [+address, "127.0.0.1"] : [address])).end(pattern(+size, "s")).resume();
  },
  member() {
    require("net").createServer(socket => socket.on("error", () => {}).once("data", data => socket.end(data))).listen(0, "127.0.0.1");
  },
  async produce(size) {
    process.stdout.on("error", () => process.exit(0));
    const data = pattern(+size, "p");
    for (let at = 0; at < data.length; ) {
      if (!process.stdout.write(data.subarray(at, (at += 1 + rnd(90000))))) await new Promise(resolve => process.stdout.once("drain", resolve));
      if (rnd(4) === 0) await Bun.sleep(rnd(3));
    }
  },
  async consume(how) {
    const chunks = [], done = () => console.log(sha(Buffer.concat(chunks)));
    if (how === "pauses") {
      process.stdin.on("end", done).on("data", chunk => {
        chunks.push(chunk);
        if (rnd(2)) process.stdin.pause(), setTimeout(() => process.stdin.resume(), rnd(3));
      });
    } else if (how === "await") { for await (const chunk of process.stdin) chunks.push(chunk); done(); }
    else if (how === "stream") { for await (const chunk of Bun.stdin.stream()) chunks.push(chunk); done(); }
    else if (how === "sync") chunks.push(require("fs").readFileSync(0)), done();
    else if (how === "polls") {
      process.stdin.on("end", done);
      (function poll() {
        for (let chunk; (chunk = process.stdin.read()) !== null; ) chunks.push(chunk);
        if (!process.stdin.readableEnded) setImmediate(poll);
      })();
    } else if (how === "child") {
      chunks.push(await Bun.spawn(program("cat", "sync"), { stdin: "inherit" }).stdout.bytes());
      done();
    } else process.stdin.once("data", () => (console.log("left"), process.exit(0)));
  },
  worker() {
    const { workerData: { port, pipe, dir, mask } } = require("worker_threads"), fs = require("fs"), net = require("net"), { once } = require("events");
    const big = Buffer.alloc(300000), loop = job => (async () => { for (;;) await job(); })().catch(() => {});
    let watcher;
    process.on("uncaughtException", () => {});
    const jobs = [
      () => fetch(`http://127.0.0.1:${port}/`).then(response => response.bytes()),
      async () => { const c = net.connect(pipe); c.write(big); await once(c, "data"); c.destroy(); },
      () => Bun.spawn(program("cat", "sync"), { stdin: big, stderr: "ignore" }).stdout.bytes(),
      async () => { await Bun.write(dir + "\\w", big); await Bun.file(dir + "\\w").bytes(); },
      () => ((watcher ??= fs.watch(dir, () => {}).on("error", () => {})), fs.promises.writeFile(dir + "\\x", "1")),
      () => Bun.$`echo a | cat | cat > ${dir}\\s`.quiet(),
      async () => { const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(big) }); await (await fetch(s.url, { keepalive: false })).bytes(); s.stop(true); await Bun.sleep(5); },
      async () => { for await (const _ of fs.createReadStream(process.execPath, { end: 1e6 })); },
      () => Bun.spawn(program("nothing"), { ipc() {} }).exited,
      async () => { const w = new WebSocket(`ws://127.0.0.1:${port}/ws`); await once(w, "open"); w.send(big); await once(w, "message"); w.close(); await Bun.sleep(5); },
      async () => { Bun.spawnSync([process.env.STRESS_CMD, "/d", "/c", "exit"]); await Bun.sleep(0); },
      async () => { const u = await Bun.udpSocket({ hostname: "127.0.0.1", socket: { data() {}, error() {} } }); u.send("x", u.port, "127.0.0.1"); await Bun.sleep(1); u.close(); },
      async () => { const sink = Bun.file(dir + "\\sink").writer(); sink.write(big); await sink.end(); },
    ];
    jobs.forEach((job, i) => (mask >> i) & 1 && loop(job));
  },
};

const certificate = JSON.parse(process.env.STRESS_TLS);

// -- what a scenario has to work with --

const budget = Number(process.env.STRESS_MS), started = performance.now(), hasTime = () => performance.now() - started < budget;
const tally = { ok: 0, bad: {}, notes: {} }, open = new Map();
const ok = () => void tally.ok++;
const note = what => void (tally.notes[what] = (tally.notes[what] ?? 0) + 1);
function bad(what, detail = "") {
  const entry = (tally.bad[what] ??= { count: 0, details: [] });
  if (++entry.count <= 2 && detail !== "") entry.details.push(String(detail).slice(0, 400));
}
const check = (good, what, detail) => (good ? ok() : bad(what, detail));
/** Runs `job(i, describe)`, `width` at a time, until the time is up. What was described last is printed if it hangs. */
async function pool(width, job, limit = Infinity) {
  let next = 0;
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (hasTime() && next < limit) {
        const i = next++, key = Symbol();
        open.set(key, "#" + i);
        await job(i, text => open.set(key, text)).catch(error => bad("threw " + (error?.code ?? error?.message), `${open.get(key)}: ${error?.stack}`));
        open.delete(key);
      }
    }),
  );
}
const within = (ms, promise) => {
  let timer;
  return Promise.race([promise.then(() => true), new Promise(resolve => (timer = setTimeout(resolve, ms, false)))]).finally(() => clearTimeout(timer));
};
const after = {
  now: f => f(),
  microtask: f => queueMicrotask(f),
  immediate: f => setImmediate(f),
  soon: f => setTimeout(f, rnd(6)),
  later: f => setTimeout(f, rnd(70)),
};
const pipeName = () => `\\\\.\\pipe\\bun-stress-${process.pid}-${crypto.randomUUID()}`;
const tcp = { port: 0, host: "127.0.0.1" };
const listen = async (server, address = tcp) => (await once(server.listen(address), "listening"), server);
const close = server => new Promise(resolve => server.close(resolve));
const quote = words => words.map(word => `"${word}"`).join(" ");
const cmd = (line, options) => Bun.spawn([process.env.STRESS_CMD, "/d", "/s", "/c", `"${line}"`], { windowsVerbatimArguments: true, ...options });
async function pair(address) {
  const net = require("net"), server = await listen(net.createServer({ allowHalfOpen: true }), address);
  const client = net.connect(address === tcp ? server.address() : address);
  const [[accepted]] = await Promise.all([once(server, "connection"), once(client, "connect")]);
  return { client, accepted, close: () => (client.destroy(), accepted.destroy(), close(server)) };
}
/** A virus scanner or the indexer may look at a new file for a moment. */
async function remove(dir, tries = 40) {
  for (;;) {
    try { return fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { if (!tries--) throw error; }
    await Bun.sleep(50);
  }
}
async function retry(call) {
  for (let tries = 20; ; await Bun.sleep(25)) {
    try { return await call(); } catch (error) { if (!/^(EPERM|EBUSY|EACCES)$/.test(error.code) || !tries--) throw error; note("retried after " + error.code); }
  }
}
let handles = () => NaN, handlesByType;
try {
  const { dlopen, ptr } = require("bun:ffi");
  const kernel32 = dlopen("kernel32.dll", { GetCurrentProcess: { args: [], returns: "ptr" }, GetProcessHandleCount: { args: ["ptr", "ptr"], returns: "i32" } }).symbols;
  const ntdll = dlopen("ntdll.dll", { NtQueryObject: { args: ["u64", "u32", "ptr", "u32", "ptr"], returns: "i32" } }).symbols;
  const count = new Uint32Array(1), info = Buffer.alloc(1024);
  handles = () => (kernel32.GetProcessHandleCount(kernel32.GetCurrentProcess(), count), count[0]);
  handlesByType = () => {
    const types = {};
    for (let handle = 4, left = handles(); left > 0 && handle < 40000; handle += 4) {
      if (ntdll.NtQueryObject(handle, 2 /* ObjectTypeInformation */, info, info.length, null) !== 0) continue;
      const at = Number(info.readBigUInt64LE(8)) - ptr(info), type = info.toString("utf16le", at, at + info.readUInt16LE(0));
      types[type] = (types[type] ?? 0) + 1;
      left--;
    }
    return types;
  };
} catch {}

async function sockets(kind) {
  const net = require("net"), secure = kind === "tls", lib = secure ? require("tls") : net, plans = new Map();
  const address = kind === "pipe" ? pipeName() : kind === "unix" ? path.resolve("s") : tcp;
  function act(socket, me, peer) {
    return new Promise(resolve => {
      const got = [], data = pattern(me.size, me.salt);
      let ended = false, failure, at = 0;
      socket.on("data", chunk => {
        got.push(chunk);
        if (rnd(6) === 0) socket.pause(), setTimeout(() => socket.resume(), rnd(4));
      });
      socket.on("end", () => ((ended = true), me.leave === "last" && socket.end())).on("error", error => (failure = error.code));
      socket.on("close", () => {
        const all = Buffer.concat(got), want = pattern(peer.size, peer.salt), plan = JSON.stringify({ me, peer, got: all.length, ended, failure });
        // A pipe has no half-close, so only a peer that stays to the end and has nothing to say is owed everything.
        const isOwedAll = peer.leave === "end" && (me.leave === "last" || (me.leave === "end" && kind !== "pipe"));
        if (!all.equals(want.subarray(0, all.length))) bad("wrong bytes", plan);
        else check(!isOwedAll || (all.length === want.length && ended && !failure), "incomplete after end()", plan);
        resolve();
      });
      (function more() {
        if (socket.destroyed || me.leave === "last") return;
        if (at >= data.length)
          return setTimeout(() => (me.leave === "end" ? socket.end() : me.leave === "reset" && kind === "tcp" ? socket.resetAndDestroy() : socket.destroy()), me.wait);
        socket.write(data.subarray(at, (at += 1 + rnd(200000)))) ? setImmediate(more) : socket.once("drain", more);
      })();
    });
  }
  const server = lib.createServer({ allowHalfOpen: true, ...(secure && certificate) }, socket => {
    socket.on("error", () => {}).once("readable", function first() {
      const id = socket.read(8);
      if (!id) return socket.readableEnded || socket.once("readable", first);
      const plan = id.length === 8 && plans.get(Number(id));
      if (!plan) return socket.destroy();
      plan.served(act(socket, plan.b, plan.a));
      socket.resume();
    });
  });
  try { await listen(server, address); } catch (error) { if (kind === "unix") return "SKIP " + error.code; throw error; }
  const side = salt => ({ salt, size: pick([0, 1, 100, 70000, 600000, 2500000]), leave: pick(["end", "end", "end", "destroy", "reset"]), wait: pick([0, 0, 1, 5]) });
  await pool(30, async (i, describe) => {
    const plan = { a: side("a" + i), b: side("b" + i) }, served = Promise.withResolvers();
    if (rnd(3) === 0) { const [writer, reader] = rnd(2) ? [plan.a, plan.b] : [plan.b, plan.a]; (writer.leave = "end"), (reader.leave = "last"), (reader.size = 0); }
    if (process.env.STRESS_ONE_RUDE && !/end|last/.test(plan.a.leave + plan.b.leave)) plan.b.leave = "end";
    describe(JSON.stringify(plan));
    plans.set(i, { ...plan, served: served.resolve });
    const client = lib.connect({ ...(address === tcp ? server.address() : { path: address }), host: "127.0.0.1", allowHalfOpen: true, rejectUnauthorized: false });
    await once(client, secure ? "secureConnect" : "connect");
    client.write(String(i).padStart(8, "0"));
    await act(client, plan.a, plan.b);
    // The server may never see the number of a client that was rude.
    await (/end|last/.test(plan.a.leave) ? served.promise : within(300, served.promise));
    plans.delete(i);
  }, 800);
  open.set("close", "server.close()");
  await close(server);
}

// -- scenarios --

const scenarios = {
  async "spawn-kill"() {
    const cp = require("child_process");
    await pool(8, async (i, describe) => {
      const kind = pick(["idle", "chatty", "nothing", "cmd waits", "cmd exits"]), api = pick(["kill", "kill", "signal", "timeout", "node", "execFile", "sync"]), when = pick(Object.keys(after));
      const argv = kind === "cmd waits" ? [process.env.STRESS_CMD, "/d", "/c", "set /p x="] : kind === "cmd exits" ? [process.env.STRESS_CMD, "/d", "/c", "exit"] : program(kind);
      const what = `${api} ${when} ${kind}`, mayFinish = /nothing|exits/.test(kind);
      describe(what);
      if (api === "sync") {
        const result = Bun.spawnSync(program(kind.startsWith("cmd") ? "idle" : kind), { timeout: 1 + rnd(40) });
        return check(result.exitedDueToTimeout || (kind === "nothing" && result.exitCode === 0), "spawnSync: timeout not reported", what);
      }
      if (api === "node" || api === "execFile") {
        let exits = 0;
        const child = api === "node" ? cp.spawn(argv[0], argv.slice(1)) : cp.execFile(argv[0], argv.slice(1), { timeout: 1 + rnd(40), maxBuffer: 1e9 }, () => {});
        child.on("exit", () => exits++).stdout.resume();
        child.stderr.resume();
        if (api === "node") after[when](() => child.kill());
        const [code, signal] = await once(child, "close");
        child.kill();
        return check(exits === 1 && (signal === "SIGTERM" || (mayFinish && code === 0)), "wrong exit", `${what}: ${exits} ${code} ${signal}`);
      }
      let exits = 0;
      const controller = new AbortController();
      const child = Bun.spawn(argv, {
        stdio: ["pipe", "pipe", "pipe"],
        onExit: () => void exits++,
        ...(api === "signal" ? { signal: controller.signal } : api === "timeout" ? { timeout: 1 + rnd(40) } : {}),
      });
      if (api !== "timeout") after[when](() => (api === "kill" ? child.kill() : controller.abort()));
      const output = Promise.all([child.stdout.bytes(), child.stderr.bytes()]);
      await child.exited;
      describe(what + ": exited, its pipes are still open");
      await output;
      child.kill();
      await Bun.sleep(0);
      check(exits === 1 && (child.signalCode === "SIGTERM" || (mayFinish && child.exitCode === 0)), "wrong exit", `${what}: ${exits} ${child.exitCode} ${child.signalCode}`);
    });
  },

  async "kill-tree"() {
    await pool(6, async (i, describe) => {
      const how = pick(["spawn", "spawnSync", "node", "three", "deep", "shell"]), delay = pick([0, 0, 1, 2, 4, rnd(30), rnd(90)]);
      describe(`${how} after ${delay} ms`);
      const child = Bun.spawn(program("middle", how), { stdio: ["ignore", "pipe", "pipe"] }), errors = child.stderr.getReader();
      await errors.read();
      if (delay) await Bun.sleep(delay);
      child.kill();
      await child.exited;
      const output = child.stdout.getReader();
      check(await within(5000, output.read()), "a grandchild survived", `${how} after ${delay} ms`);
      output.cancel(), errors.cancel();
    });
  },

  async "run-filter"() {
    const write = (dir, json) => (fs.mkdirSync(dir, { recursive: true }), fs.writeFileSync(dir + "/package.json", JSON.stringify(json)));
    fs.writeFileSync("package.json", JSON.stringify({ name: "root", workspaces: ["p/*"] }));
    write("p/a", { name: "a", scripts: { fail: "exit 1", talk: "echo from-a" } });
    write("p/b", { name: "b", scripts: { fail: quote(program("idle")).replaceAll("\\", "/"), talk: "echo from-b" } });
    await pool(4, async (i, describe) => {
      const args = pick([["--parallel", "--filter", "*", "fail"], ["--parallel", "--filter", "*", "fail"], ["--parallel", "--filter", "*", "talk"], ["--sequential", "--filter", "*", "talk"], ["--filter", "*", "talk"]]);
      describe(args.join(" "));
      const child = Bun.spawn([process.execPath, "run", ...args], { stdio: ["ignore", "pipe", "pipe"] });
      const [out, err, code] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
      check(args.at(-1) === "fail" ? code === 1 : code === 0 && /from-a/.test(out) && /from-b/.test(out), "wrong result", `${args.join(" ")}: ${code} ${out} ${err}`);
    });
  },

  async "spawn-stdio"() {
    const cp = require("child_process");
    const inputs = {
      pipe: data => ["pipe", child => (child.stdin.write(data), child.stdin.end())],
      buffer: data => [data],
      blob: data => [new Blob([data])],
      response: data => [new Response(data)],
      file: (data, i) => (fs.writeFileSync("i" + i, data), [Bun.file("i" + i)]),
      fd: (data, i) => { fs.writeFileSync("i" + i, data); const fd = fs.openSync("i" + i); return [fd, () => fs.closeSync(fd)]; },
      stream: data => [new ReadableStream({ start(c) { for (let at = 0; at < data.length; at += 50000) c.enqueue(data.subarray(at, at + 50000)); c.close(); } })],
    };
    await pool(8, async (i, describe) => {
      const data = pattern(pick([0, 5, 65536, 300000, 1500000]), i), argv = program("cat", pick(["pipe", "write", "await", "sync"]));
      const api = pick(["bun", "bun", "bun", "sync", "node", "execFile", "shell"]), kill = api !== "shell" && rnd(5) === 0;
      let got, what = `${api} ${argv.at(-1)} ${data.length}${kill ? " killed" : ""}`;
      describe(what);
      if (api === "bun") {
        const input = pick(Object.keys(inputs)), output = pick(["pipe", "file", "late"]), [stdin, then] = inputs[input](data, i);
        describe((what += ` ${input} > ${output}`));
        const child = Bun.spawn(argv, { stdin, stdout: output === "file" ? Bun.file("o" + i) : "pipe", stderr: pick(["pipe", "ignore"]) });
        (async () => then?.(child))().catch(error => kill || bad("stdin " + error.code, what));
        if (kill) after.later(() => child.kill());
        if (output === "late") await Bun.sleep(rnd(120));
        got = output === "file" ? (await child.exited, fs.readFileSync("o" + i)) : Buffer.from(await child.stdout.bytes());
        if ((await child.exited) !== 0 && !kill) bad("exit code", `${what}: ${child.exitCode}`);
      } else if (api === "sync") got = Bun.spawnSync(argv, { stdin: data, stderr: "ignore", timeout: kill ? 1 + rnd(60) : 25000 }).stdout;
      else if (api === "node") {
        const child = cp.spawn(argv[0], argv.slice(1)), chunks = [];
        child.stdin.on("error", () => {}).end(data);
        if (kill) after.later(() => child.kill());
        child.stdout.on("data", chunk => chunks.push(chunk));
        child.stderr.resume();
        await once(child, "close");
        got = Buffer.concat(chunks);
      } else if (api === "execFile") {
        const options = { encoding: "buffer", maxBuffer: 1e8, timeout: kill ? 1 + rnd(60) : 0 };
        got = await new Promise(resolve => cp.execFile(argv[0], argv.slice(1), options, (_, out) => resolve(out)).stdin.on("error", () => {}).end(data));
      } else got = (await Bun.$`${argv} < ${data} | cat | ${program("cat", "sync")}`.quiet().nothrow()).stdout;
      if (!got.equals(data.subarray(0, got.length))) bad("wrong bytes", what);
      else check(kill || got.length === data.length, "incomplete", `${what}: ${got.length}`);
      for (const file of ["i" + i, "o" + i]) fs.rm(file, { force: true }, () => {});
    });
  },

  // Anonymous pipes, as cmd.exe makes them.
  async "cmd-pipes"() {
    await pool(5, async (i, describe) => {
      const size = pick([1, 5000, 300000, 3000000]), how = pick(["pauses", "await", "stream", "sync", "polls", "child", "leaves"]), via = pick([[], [], ["pipe"], ["write"], ["await"]]);
      const what = `${size} | ${via} | ${how}`;
      describe(what);
      const stages = [program("produce", size), ...via.map(it => program("cat", it)), program("consume", how)];
      const out = (await cmd(stages.map(quote).join(" | "), { stdio: ["ignore", "pipe", "ignore"] }).stdout.text()).trim();
      check(out === (how === "leaves" ? "left" : sha(pattern(size, "p"))), "wrong bytes", `${what}: ${out}`);
    });
  },

  async "exit-flush"() {
    await pool(8, async (i, describe) => {
      if (rnd(8) === 0) {
        const size = pick([100, 1e6, 5e6]), name = rnd(2) ? pipeName() : tcp, server = await listen(require("net").createServer({ pauseOnConnect: true }), name), connection = once(server, "connection");
        describe(`end() on a ${name === tcp ? "socket" : "named pipe"}, ${size}`);
        const child = Bun.spawn(program("send", name === tcp ? server.address().port : name, size), { stdio: ["ignore", "ignore", "ignore"] }), [socket] = await connection;
        await Bun.sleep(pick([0, 200]));
        const got = Buffer.concat(await Array.fromAsync(socket));
        await Promise.all([child.exited, close(server)]);
        return check(got.equals(pattern(size, "s")), `output lost: end() on a ${name === tcp ? "socket" : "named pipe"}, then return`, `${got.length} of ${size}`);
      }
      const writer = pick(["process.stdout", "many writes", "console.log", "Bun.write", "writer", "writer+flush", "fs.write"]);
      const way = pick(["return", "exit", "tick", "immediate", "throw", "in exit"]), size = pick([100, 1e6]), sink = pick(["pipe", "slow pipe", "file", "cmd pipe"]);
      const argv = program("leave", writer, way, size);
      describe(`${writer}, ${way}, ${size}, ${sink}`);
      let got;
      if (sink === "cmd pipe") got = (await cmd(`${quote(argv)} | ${quote(program("cat", "sync"))}`, { stderr: "ignore" }).stdout.bytes()).length;
      else if (sink === "file") await Bun.spawn(argv, { stdout: Bun.file("f" + i), stderr: "ignore" }).exited, (got = fs.statSync("f" + i).size), fs.rm("f" + i, () => {});
      else {
        const child = Bun.spawn(argv, { stderr: "ignore", lazy: true });
        if (sink === "slow pipe") await Bun.sleep(250);
        got = (await child.stdout.bytes()).length;
      }
      check(got === size, `output lost: ${writer}, then ${way}`, `${got} of ${size} to a ${sink}`);
    });
  },

  tcp: () => sockets("tcp"),
  tls: () => sockets("tls"),
  unix: () => sockets("unix"),
  "named-pipe": () => sockets("pipe"),

  async duplex() {
    const size = 24 << 20, mine = pattern(size, "p"), expected = [sha(pattern(size, "c")), sha(mine)];
    await pool(1, async (i, describe) => {
      const how = ["stdio", "fd3", "pipe"][i % 3], name = pipeName();
      describe(how);
      const server = how === "pipe" && (await listen(require("net").createServer(), name)), connection = server && once(server, "connection");
      const [exe, ...args] = program("duplex", server ? name : how, size);
      const child = require("child_process").spawn(exe, args, { stdio: ["pipe", "pipe", "pipe", "pipe"] });
      const socket = how === "fd3" ? child.stdio[3] : server ? (await connection)[0] : null;
      const down = digest(socket ?? child.stdout, size), exited = once(child, "exit");
      (socket ?? child.stdin).on("error", () => {}).write(mine);
      const [up] = await once(child.stderr, "data");
      check((await down) === expected[0] && String(up).trim() === expected[1], "wrong bytes", `${how}: ${up}`);
      describe(how + ": the child does not exit");
      socket?.destroy(), child.stdio[3].destroy(), child.stdin.destroy(), server && server.close();
      await exited;
    });
  },

  async ipc() {
    const net = require("net");
    let accept, turn = Promise.resolve();
    const server = await listen(net.createServer({ pauseOnConnect: true }, socket => accept(socket)));
    const connect = () => (turn = turn.then(async () => { const accepted = new Promise(resolve => (accept = resolve)); return [net.connect(server.address()), await accepted]; }));
    await pool(5, async (n, describe) => {
      const serialization = pick(["json", "advanced"]), last = pick(["exit", "disconnect", "unref"]), total = 80, replies = [];
      const child = require("child_process").fork(program("echo")[1], { serialization }), closed = once(child, "close");
      let next = 0, done;
      describe(`${serialization}: sending`);
      child.on("message", message => (message.bad ? bad(message.bad) : message.done ? (done = message.done) : message.i !== next++ && bad("out of order in the parent")));
      for (let i = 0; i < total; i++) {
        const k = rnd(20);
        if (k === 0) {
          const [client, socket] = await connect();
          replies.push(Array.fromAsync(client).then(text => text.join("") === "from child " + i || bad("a socket that was sent is mute"), error => bad("a socket that was sent: " + error.code)));
          child.send({ i, handle: true }, socket);
        } else if (k === 1) {
          const other = await listen(net.createServer());
          child.send({ i, handle: true }, other, () => other.close());
        } else child.send({ i, text: "x".repeat(pick([0, 10, 5000, 70000, 300000])) });
      }
      describe(`${serialization}: waiting for the sockets that were sent`);
      await Promise.all(replies);
      describe(`${serialization}: waiting for the child to ${last}`);
      child.send({ i: total, last });
      await closed;
      check(done === total + 1 && next === total, "messages lost", `${serialization}, ${last}: ${next} of ${total}, done ${done}`);
    });
    server.close();
  },

  async cluster() {
    const cluster = require("cluster"), net = require("net");
    cluster.schedulingPolicy = rnd(2) ? cluster.SCHED_RR : cluster.SCHED_NONE;
    cluster.setupPrimary({ exec: program("member")[1], args: [] });
    note(cluster.schedulingPolicy === cluster.SCHED_RR ? "round robin" : "shared socket");
    await pool(1, async (round, describe) => {
      describe("starting");
      const members = [cluster.fork(), cluster.fork(), cluster.fork()], exited = members.map(member => once(member, "exit"));
      const [[{ port }]] = await Promise.all(members.map(member => once(member, "listening")));
      const ask = async (i, mayDrop) => {
        const socket = net.connect(port, "127.0.0.1");
        let got = "", failure;
        socket.on("data", data => (got += data)).on("error", error => (failure = error.code)).write("ask " + i);
        if (!(await within(5000, new Promise(resolve => socket.once("close", resolve))))) return socket.destroy(), bad("a connection was never served", mayDrop ? "while a member was killed" : "");
        check(mayDrop || got === "ask " + i, "a connection was dropped", failure);
      };
      const asks = mayDrop => Promise.all(Array.from({ length: 12 }, (_, i) => ask(i, mayDrop)));
      describe("asking");
      await asks(false);
      after.soon(() => members[0].process.kill());
      await Promise.all([asks(true), exited[0]]);
      await asks(false);
      describe("disconnecting");
      members[1].disconnect(), members[2].disconnect();
      await Promise.all(exited);
    }, 40);
  },

  async workers() {
    const { Worker } = require("worker_threads"), big = Buffer.alloc(200000), pipe = pipeName();
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (request, self) => (self.upgrade(request) ? undefined : new Response(big)), websocket: { message: (socket, data) => void socket.send(data) } });
    const pipes = await listen(require("net").createServer(socket => socket.on("error", () => {}).once("data", () => socket.write("x")).resume()), pipe);
    await pool(5, async (i, describe) => {
      const dir = path.resolve("w" + i), mask = (rnd(1 << 14) & rnd(1 << 14)) | (1 << rnd(14));
      fs.mkdirSync(dir);
      describe("jobs " + mask.toString(2));
      const worker = new Worker(program("worker")[1], { workerData: { port: server.port, pipe, dir, mask } }).on("error", error => bad("error in the Worker", error.stack));
      await once(worker, "online");
      await Bun.sleep(rnd(90));
      const before = performance.now();
      await worker.terminate();
      check(performance.now() - before < 3000, "terminate() is slow", "jobs " + mask.toString(2));
      await remove(dir).catch(error => bad("its files stay in use", `${error.code}, jobs ${mask.toString(2)}`));
    }, 400);
    server.stop(true), pipes.close();
  },

  async watch() {
    await pool(1, async (round, describe) => {
      const dir = path.resolve("d" + round), recursive = round % 2 === 1, seen = new Set(), others = [], names = [];
      let overflows = 0;
      fs.mkdirSync(dir + "\\sub", { recursive: true });
      const watcher = fs.watch(dir, { recursive }, (_, name) => (name === null ? overflows++ : seen.add(name))).on("error", error => note("error " + error.code));
      for (let i = 0, n = 20 + rnd(300); i < n; i++) {
        const name = (recursive && rnd(2) ? "sub\\" : "") + "f" + i + "x".repeat(rnd(60)), file = `${dir}\\${name}`;
        names.push(name);
        fs.writeFileSync(file, "");
        if (rnd(10) === 0) await Bun.sleep(0);
        if (rnd(15) === 0) others.push(fs.watch(rnd(2) ? dir : file, { recursive: rnd(2) === 1 }, () => {}).on("error", error => note("error " + error.code)));
        if (rnd(20) === 0) others.pop()?.close();
        if (rnd(8) === 0) await retry(() => fs.renameSync(file, file + "r"));
      }
      for (let tries = 0; !seen.has("end") && tries < 200; tries++) fs.writeFileSync(dir + "\\end", String(tries)), await Bun.sleep(10);
      const missing = names.filter(name => !seen.has(name));
      if (!seen.has("end")) bad("the watcher went deaf");
      else check(!missing.length || overflows, "events lost without notice", `${missing.length} of ${names.length}, e.g. ${missing[0]}`);
      if (overflows) note("overflow reported");
      if (rnd(2)) describe("removing what is watched"), await remove(dir);
      await Bun.sleep(rnd(3));
      watcher.close(), others.forEach(other => other.close());
    });
  },

  async files() {
    const { pipeline } = require("stream/promises"), fsp = fs.promises;
    await pool(24, async (i, describe) => {
      const data = pattern(pick([0, 1, 4096, 70000, 1200000]), i), a = path.resolve("a" + i), b = path.resolve("b" + i);
      const write = pick(["writeFile", "Bun.write", "writer", "stream", "handle", "append", "response"]), move = pick(["rename", "copyFile", "Bun.write", "pipeline", "replace"]), read = pick(["readFile", "bytes", "stream", "web stream", "handle", "sync"]);
      describe(`${write}, ${move}, ${read}`);
      if (write === "writeFile") await fsp.writeFile(a, data);
      else if (write === "Bun.write") await Bun.write(a, data);
      else if (write === "response") await Bun.write(a, new Response(new Blob([data]).stream()));
      else if (write === "writer") { const sink = Bun.file(a).writer(); for (let at = 0; at < data.length; at += 100000) sink.write(data.subarray(at, at + 100000)); await sink.end(); }
      else if (write === "stream") await new Promise(resolve => fs.createWriteStream(a).on("close", resolve).end(data));
      else if (write === "append") await fsp.appendFile(a, data.subarray(0, 100)), await fsp.appendFile(a, data.subarray(100));
      else { const file = await fsp.open(a, "w"), half = data.length >> 1; await Promise.all([file.write(data, half, data.length - half, half), file.write(data, 0, half, 0)]); await file.close(); }
      if (move === "rename") await retry(() => fsp.rename(a, b));
      else if (move === "replace") await fsp.writeFile(b, "old"), await retry(() => fsp.rename(a, b));
      else if (move === "copyFile") await fsp.copyFile(a, b);
      else if (move === "Bun.write") await Bun.write(b, Bun.file(a));
      else await pipeline(fs.createReadStream(a), fs.createWriteStream(b));
      let got;
      if (read === "readFile") got = await fsp.readFile(b);
      else if (read === "bytes") got = Buffer.from(await Bun.file(b).bytes());
      else if (read === "stream") got = Buffer.concat(await Array.fromAsync(fs.createReadStream(b)));
      else if (read === "web stream") got = Buffer.concat(await Array.fromAsync(Bun.file(b).stream()));
      else if (read === "sync") got = fs.readFileSync(b);
      else { const file = await fsp.open(b); got = await file.readFile(); await file.close(); }
      check(got.equals(data) && (await fsp.stat(b)).size === data.length, "wrong bytes", `${write}, ${move}, ${read}: ${got.length} of ${data.length}`);
      await Promise.all([retry(() => fsp.rm(a, { force: true })), retry(() => fsp.unlink(b))]);
    });
  },

  async http() {
    const http = require("http"), body = size => pattern(size, "b"), file = pattern(2000000, "f");
    fs.writeFileSync("served", file);
    const bun = Bun.serve({
      port: 0, hostname: "127.0.0.1", maxRequestBodySize: 1e9,
      async fetch(request, self) {
        const { pathname, searchParams } = new URL(request.url), size = +searchParams.get("n");
        if (pathname === "/ws") return void self.upgrade(request);
        if (pathname === "/echo") return new Response(request.body);
        if (pathname === "/sha") return new Response(sha(await request.bytes()));
        if (pathname === "/file") return new Response(Bun.file("served").slice(0, size));
        if (pathname !== "/stream") return new Response(body(size));
        const data = body(size);
        let at = 0;
        return new Response(new ReadableStream({ async pull(c) { if (at >= size) return c.close(); c.enqueue(data.subarray(at, (at += 40000))); if (rnd(5) === 0) await Bun.sleep(1); } }));
      },
      websocket: { maxPayloadLength: 1e8, message: (socket, data) => void socket.send(data) },
    });
    const node = await listen(http.createServer(async (request, response) => {
      const { pathname, searchParams } = new URL(request.url, "http://x");
      request.on("error", () => {});
      if (pathname === "/echo") request.pipe(response);
      else if (pathname === "/sha") response.end(sha(Buffer.concat(await Array.fromAsync(request))));
      else response.end(body(+searchParams.get("n")));
    }));
    const agent = new http.Agent({ keepAlive: true, maxSockets: 8 }), bytes = async response => Buffer.from(await (await response).bytes());
    await pool(24, async (i, describe) => {
      const size = pick([0, 10, 5000, 200000, 2000000]), toBun = rnd(2) === 1, base = `http://127.0.0.1:${toBun ? bun.port : node.address().port}`;
      const kind = pick(["get", "sha", "echo", "abort", "slow", "request", "destroy", ...(toBun ? ["stream", "file", "ws"] : [])]), what = `${kind} ${size} ${toBun ? "Bun.serve" : "node:http"}`;
      const is = (got, want) => check(got.equals(want), "wrong bytes", `${what}: ${got.length}`);
      describe(what);
      if (kind === "get" || kind === "stream") is(await bytes(fetch(`${base}/${kind}?n=${size}`)), body(size));
      else if (kind === "file") is(await bytes(fetch(`${base}/file?n=${size}`)), file.subarray(0, size));
      else if (kind === "sha") is(await bytes(fetch(`${base}/sha`, { method: "POST", body: body(size) })), Buffer.from(sha(body(size))));
      else if (kind === "echo") is(await bytes(fetch(`${base}/echo`, { method: "POST", body: body(size) })), body(size));
      else if (kind === "abort") await bytes(fetch(`${base}/get?n=${size}`, { signal: AbortSignal.timeout(rnd(6)) })).then(ok, ok);
      else if (kind === "slow") { const chunks = []; for await (const chunk of (await fetch(`${base}/get?n=${size}`)).body ?? []) chunks.push(chunk), await Bun.sleep(rnd(3)); is(Buffer.concat(chunks), body(size)); }
      else if (kind === "request") { const [response] = await once(http.request(`${base}/echo`, { method: "POST", agent }).end(body(size)), "response"); is(Buffer.concat(await Array.fromAsync(response)), body(size)); }
      else if (kind === "destroy") {
        const request = http.get(`${base}/get?n=${size}`, { agent }).on("error", () => {}).on("response", response => response.on("error", () => {}).resume());
        after.soon(() => request.destroy());
        await new Promise(resolve => request.once("close", resolve));
        ok();
      } else {
        const socket = new WebSocket(`ws://127.0.0.1:${bun.port}/ws`);
        socket.binaryType = "nodebuffer";
        await once(socket, "open");
        socket.send(body(size));
        is((await once(socket, "message"))[0].data, body(size));
        rnd(2) ? socket.close() : socket.terminate();
      }
    }, 2000);
    open.set("close", "stopping the servers");
    agent.destroy(), await bun.stop(true), node.closeAllConnections(), node.close();
  },

  async udp() {
    await pool(8, async (i, describe) => {
      // The short ones go to ports that were closed, which another socket may have got since.
      let wake, last;
      const options = { hostname: "127.0.0.1", socket: { data: (_, data) => data.length > 8 && ((last = Buffer.from(data)), wake?.()), error() {} } };
      const [a, b, gone] = await Promise.all([Bun.udpSocket(options), Bun.udpSocket(options), Bun.udpSocket(options)]), closed = gone.port;
      gone.close();
      for (let n = 0; n < 30; n++) {
        const data = pattern(9 + rnd(8000), `${i}.${n}`), arrived = new Promise(resolve => (wake = resolve)), [from, to] = n % 2 ? [a, b] : [b, a];
        // The answer to this one is an error, which must not silence the socket.
        if (rnd(5) === 0) to.send("x", closed, "127.0.0.1");
        from.send(data, to.port, "127.0.0.1");
        if (await within(2000, arrived)) check(last.equals(data), "wrong bytes");
        else bad("a datagram did not arrive", `number ${n}`);
      }
      for (let n = 0; n < 10; n++) a.send("burst", b.port, "127.0.0.1");
      after[pick(["now", "microtask", "immediate"])](() => b.close());
      a.close();
      await Bun.sleep(1);
    }, 1200);
  },

  // Numbered words are typed while the program switches modes, pauses and prints.
  async terminal() {
    const word = i => `<${i}${String.fromCharCode(0xe9)}>`;
    await pool(3, async (n, describe) => {
      const server = await listen(require("net").createServer()), connection = once(server, "connection");
      const child = Bun.spawn(program("typist", server.address().port), { env: { ...process.env, STRESS_SEED: String(rnd(1e6)) }, terminal: { data: (_, d) => (screen = (screen + Buffer.from(d).toString("latin1")).slice(-300)), exit: () => (ended = true) } });
      let screen = "", ended = false, last = "";
      const write = child.terminal.write.bind(child.terminal);
      child.terminal.write = text => { try { write(text); } catch (e) { throw new Error(`${e.code} exit=${child.exitCode} ended=${ended} last=${last} screen=${JSON.stringify(screen)}`); } };
      describe("waiting for the program to start");
      const [control] = await connection;
      let got = "", want = "@";
      control.setEncoding("utf8").on("data", text => (got += text)).on("error", () => {});
      await once(control, "data");
      for (let i = 0; i < 100; i++) {
        want += word(i);
        child.terminal.write(word(i) + (rnd(3) ? "" : "\r"));
        if (rnd(2)) await Bun.sleep(rnd(5));
        if (rnd(40) === 0) child.terminal.resize(60 + rnd(60), 20 + rnd(20)), (last = "resize at " + i + "/");
      }
      for (let i = 0; i < 300 && !got.includes(word(99)); i++) child.terminal.write("\r"), await Bun.sleep(10);
      got = got.replace(/[\r\n]/g, "");
      let same = 0;
      while (same < want.length && got[same] === want[same]) same++;
      check(got === want, got.length < want.length ? "input lost" : "input doubled or changed", `wanted ${JSON.stringify(want.slice(same, same + 30))}, got ${JSON.stringify(got.slice(same, same + 30))}`);
      describe("kill and close");
      child.kill(), await child.exited, child.terminal.close(), control.destroy(), server.close();
    });
  },

  // I/O has to get its turn whatever else keeps the thread busy.
  async "busy-loop"() {
    const links = [await pair(tcp), await pair(pipeName())];
    for (const { accepted } of links) accepted.on("data", data => accepted.write(data));
    const child = require("child_process").spawn(...(([exe, ...args]) => [exe, args])(program("cat", "pipe")));
    const trip = (out, back) => () => (out.write("x"), once(back, "data"));
    const waits = {
      "socket": trip(links[0].client, links[0].client), "named pipe": trip(links[1].client, links[1].client), "child's pipes": trip(child.stdin, child.stdout),
      "timer": () => Bun.sleep(1), "file": () => fs.promises.stat("."), "lookup": () => require("dns").promises.lookup("localhost"),
    };
    const { port1, port2 } = new MessageChannel();
    const loads = {
      "immediates": again => setImmediate(again),
      "zero timers": again => setTimeout(again, 0),
      "messages": again => ((port2.onmessage = again), port1.postMessage(0)),
      "file calls": again => fs.stat(".", again),
      "spawnSync": again => setTimeout(() => (Bun.spawnSync([process.env.STRESS_CMD, "/d", "/c", "exit"], { timeout: 20000 }), again()), 1),
    };
    await waits["child's pipes"]();
    await pool(1, async (i, describe) => {
      const load = Object.keys(loads)[i % 5];
      let on = true;
      (function again() { if (on) loads[load](again); })();
      for (const until = performance.now() + 300; performance.now() < until; )
        for (const wait in waits) {
          describe(`${wait} during ${load}`);
          const before = performance.now();
          await waits[wait]();
          check(performance.now() - before < 1000, "slow", `${wait} during ${load}: ${Math.round(performance.now() - before)} ms`);
        }
      on = false;
    });
    port1.close(), child.stdin.end(), await Promise.all(links.map(link => link.close()));
  },

  async timers() {
    const late = [];
    for (const until = performance.now() + budget / 2; performance.now() < until; ) {
      const ms = pick([1, 2, 3, 5, 7, 15, 16, 17, 31]), before = process.hrtime.bigint();
      await new Promise(resolve => setTimeout(resolve, ms));
      late.push(Number(process.hrtime.bigint() - before) / 1e6 - ms);
    }
    late.sort((a, b) => a - b);
    note(`late by ${late[late.length >> 1].toFixed(2)} ms (median), ${late.at(-1).toFixed(1)} ms (worst)`);
    check(late[0] >= 0, "a timer was early", late[0]);
    check(late[late.length >> 1] < 8, "timers are late");
    // With all of this open and quiet, the thread has to sleep.
    const big = Buffer.alloc(8 << 20), links = await Promise.all([tcp, tcp, tcp, tcp, pipeName(), pipeName()].map(pair));
    for (const { client, accepted } of links) client.on("error", () => {}), accepted.on("error", () => {});
    links[0].accepted.resume(), links[1].client.end("data"), links[2].client.write(big), links[2].client.write(big), links[2].client.write(big);
    links[3].client.end(), links[3].accepted.resume(), links[4].accepted.resume(), links[5].client.write(big);
    const child = Bun.spawn(program("idle"), { stdio: ["pipe", "pipe", "pipe"], ipc() {} }), watcher = fs.watch(".", { recursive: true }, () => {});
    child.stdout.text(), Promise.resolve(child.stdin.write(big)).catch(() => {});
    await Bun.sleep(300);
    const usage = process.threadCpuUsage ?? process.cpuUsage, before = usage.call(process);
    await Bun.sleep(1500);
    const { user, system } = usage.call(process, before);
    check(user + system < 150000, "busy while idle", `${(user + system) / 1000} ms of 1500`);
    child.kill(), watcher.close(), await Promise.all([child.exited, ...links.map(link => link.close())]);
  },

  async handles() {
    if (!handlesByType) return "SKIP no bun:ffi";
    const { Worker } = require("worker_threads"), quick = [process.env.STRESS_CMD, "/d", "/c", "exit"];
    const worker = code => async () => {
      const leave = pick(["", "", "process.exit(0)", "setImmediate(() => process.exit(0))", "setTimeout(() => { throw 1; }, 1)"]);
      const it = new Worker(`${code}; require("worker_threads").parentPort.on("message", () => {}).postMessage(0); ${leave}`, { eval: true }).on("error", () => {});
      if (!leave) it.once("message", () => after[pick(["now", "immediate", "soon"])](() => it.terminate()));
      await new Promise(resolve => it.once("exit", resolve));
    };
    fs.writeFileSync("big", Buffer.alloc(4 << 20));
    const cycles = {
      "spawn": () => Bun.spawn(quick, { stdio: ["pipe", "pipe", "pipe"] }).exited,
      "spawn and kill": () => { const child = Bun.spawn(program("idle"), { stdio: ["pipe", "pipe", "pipe"] }); child.stdout.text(), child.kill(); return child.exited; },
      "spawn with ipc": () => Bun.spawn(quick, { ipc() {} }).exited,
      "spawnSync": async () => Bun.spawnSync(quick),
      "fd 3": () => once(require("child_process").spawn(quick[0], quick.slice(1), { stdio: ["pipe", "pipe", "pipe", "pipe"] }), "close"),
      "shell": () => Bun.$`echo a | cat | cat`.quiet(),
      "terminal": async () => { const child = Bun.spawn(quick, { terminal: { data() {} } }); await child.exited; child.terminal.close(); },
      "watch": async () => (fs.watch(".").close(), Bun.sleep(1)),
      "named pipe": async () => (await pair(pipeName())).close(),
      "tcp": async () => (await pair(tcp)).close(),
      "udp": async () => (await Bun.udpSocket({ hostname: "127.0.0.1" })).close(),
      "fetch": async () => { const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") }); await (await fetch(server.url, { keepalive: false })).text(); await server.stop(true); },
      "file stream, cancelled": async () => { const reader = Bun.file("big").stream().getReader(); await reader.read(); await reader.cancel(); },
      "Worker": worker("0"),
      "Worker with a server": worker(`require("net").createServer().listen(0, "127.0.0.1")`),
      "Worker with a watcher": worker(`require("fs").watch(".", () => {})`),
      "Worker that reads files": worker(`Bun.file("big").bytes(), Bun.file("big").stream().getReader().read(), require("fs").promises.readFile("big")`),
      "Worker that writes files": worker(`const big = Buffer.alloc(4 << 20); Bun.write("copy", big), require("fs").promises.writeFile("other", big)`),
      "Worker with a file writer": worker(`const sink = Bun.file("sink").writer(); sink.write(Buffer.alloc(4 << 20)), sink.flush()`),
      "Worker that opens files": worker(`require("fs").open("big", () => {}), require("fs").createReadStream("big").resume()`),
    };
    await Promise.all(Array.from({ length: 64 }, () => fs.promises.stat("big")));
    const settle = async () => (Bun.gc(true), await Bun.sleep(30), Bun.gc(true), handlesByType());
    // Threads come and go with the pools, and up to 64 events are kept for reuse.
    const growth = (before, now, n) => Object.entries(now).map(([type, count]) => [type, count - (before[type] ?? 0)]).filter(([type, more]) => !/^(Thread|Event)$/.test(type) && more >= (/^(File|IoCompletion|Process|Job|Section|WaitCompletionPacket|.*Timer)$/.test(type) ? Math.max(2, n / 10) : n / 2));
    const first = await settle();
    for (const [name, cycle] of Object.entries(cycles)) {
      open.set("cycle", name);
      for (let i = 0; i < 2; i++) await cycle();
      const before = await settle(), until = performance.now() + budget / 16;
      let n = 0;
      while (n < (name.startsWith("Worker") ? 30 : 10) || (n < 40 && performance.now() < until)) await cycle(), n++;
      let grown = growth(before, await settle(), n);
      for (let i = 0; i < 15 && grown.length; i++) grown = growth(before, await settle(), n);
      check(!grown.length, "handles leak: " + name, `${grown.map(([type, more]) => `${more} ${type}`).join(", ")} in ${n} rounds`);
    }
    const events = ((await settle()).Event ?? 0) - (first.Event ?? 0);
    check(events < 120, "handles leak: events", events);
  },
};

// -- running one, and running all --

const GRACE = 20000;

async function runScenario(name) {
  const before = handles();
  const report = verdict => fs.writeFileSync(path.resolve("..", name + ".json"), JSON.stringify({ verdict, ...tally, open: [...open.values()].slice(0, 5), ms: performance.now() - started, handles: handles() - before }));
  process.on("uncaughtException", error => bad("uncaught " + (error?.code ?? error?.message), error?.stack));
  process.on("unhandledRejection", error => bad("unhandled " + (error?.code ?? error?.message), error?.stack));
  // It keeps the loop alive, so a promise that nothing will ever settle is a hang too.
  const watchdog = setTimeout(() => (report("HANG"), process.exit(9)), budget + GRACE + (name === "handles" ? GRACE : 0));
  const verdict = await scenarios[name]().catch(error => bad("threw " + (error?.code ?? error?.message), error?.stack));
  clearTimeout(watchdog);
  open.clear();
  report(verdict ?? (Object.keys(tally.bad).length || !tally.ok ? "FAIL" : "PASS"));
  setTimeout(() => console.log("still here:", JSON.stringify(process.getActiveResourcesInfo?.()), JSON.stringify(handlesByType?.())), 5000).unref();
}

async function main() {
  const { values } = require("node:util").parseArgs({ options: { exe: { type: "string", multiple: true }, only: { type: "string" }, seconds: { type: "string" }, seed: { type: "string" }, list: { type: "boolean" } } });
  if (values.list) return console.log(Object.keys(scenarios).join("\n"));
  if (process.platform !== "win32") return console.log("This is for Windows.");
  const seed = values.seed ?? String(1 + Math.floor(Math.random() * 1e6)), ms = 1000 * Number(values.seconds ?? 6);
  const names = values.only?.split(",") ?? Object.keys(scenarios), root = fs.mkdtempSync(path.join(os.tmpdir(), "bun-stress-"));
  const unknown = names.filter(name => !(name in scenarios));
  if (unknown.length) return console.log("No such scenario:", unknown.join());
  fs.mkdirSync(root + "\\programs");
  for (const [name, code] of Object.entries(programs))
    fs.writeFileSync(`${root}\\programs\\${name}.js`, `const { rnd, pick, pattern, sha, digest, program } = (${library})();\nsetTimeout(() => process.exit(99), 30000).unref();\n({ ${code} }).${name}(...process.argv.slice(2));\n`);
  const env = { ...process.env, STRESS_SEED: seed, STRESS_MS: String(ms), STRESS_PROGRAMS: root + "\\programs", STRESS_CMD: process.env.ComSpec ?? "cmd.exe", TEMP: root, TMP: root, NO_PROXY: "*", NO_COLOR: "1" };
  for (const key of Object.keys(env)) if (/^(https?|all)_proxy$|^(BUN|NODE)_OPTIONS$|^BUN_CRASH_REPORT_URL$|^FORCE_COLOR$/i.test(key)) delete env[key];
  Object.assign(env, { BUN_ENABLE_CRASH_REPORTING: "0", DO_NOT_TRACK: "1", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", BUN_DEBUG_QUIET_LOGS: "1" });

  let failures = 0;
  for (const [n, exe] of (values.exe ?? [process.execPath]).map(it => path.resolve(it)).entries()) {
    const revision = Bun.spawnSync([exe, "--revision"], { env }).stdout.toString().trim();
    console.log(`\nbun ${revision} | Windows ${os.release()} ${os.arch()} | ${os.availableParallelism()} cpus | seed ${seed}`);
    const totals = {};
    for (const name of names) {
      const dir = `${root}\\${n}\\${name}`, file = dir + ".json", log = dir + ".log";
      fs.mkdirSync(dir, { recursive: true });
      const output = fs.openSync(log, "w"), child = Bun.spawn([exe, import.meta.path, "--scenario", name], { cwd: dir, env, stdio: ["ignore", output, output], windowsHide: true });
      let exited = false, reported;
      child.exited.then(() => (exited = true));
      for (const limit = performance.now() + ms + 2 * GRACE + 10000; !exited && performance.now() < Math.min(limit, (reported ?? Infinity) + 8000); await Bun.sleep(50))
        if (!reported && fs.existsSync(file)) reported = performance.now();
      const wasKilled = !exited;
      if (wasKilled) child.kill(), await within(5000, child.exited);
      fs.closeSync(output);
      const result = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { bad: {}, notes: {}, open: [] };
      const printed = fs.readFileSync(log, "utf8"), crashed = /panic|has crashed|Segmentation fault|ASSERTION/.test(printed);
      let verdict = result.verdict;
      if (wasKilled) verdict = /HANG|FAIL/.test(verdict) ? verdict : verdict ? "LINGERS" : "STUCK";
      else if (crashed || !verdict || (verdict !== "HANG" && child.exitCode !== 0)) verdict = "CRASH";
      const word = verdict.split(" ")[0], good = word === "PASS" || word === "SKIP";
      totals[word] = (totals[word] ?? 0) + 1;
      failures += !good;
      const figures = result.ms ? `${String(result.ok).padStart(6)} ok ${(result.ms / 1000).toFixed(1).padStart(5)} s  ${result.handles >= 0 ? "+" : ""}${result.handles} handles` : "";
      console.log(`${name.padEnd(12)} ${verdict.padEnd(8)}${figures}  ${Object.entries(result.notes).map(([text, count]) => (count > 1 ? `${text} x${count}` : text)).join("; ")}`.trimEnd());
      for (const [text, { count, details }] of Object.entries(result.bad).slice(0, 8)) console.log(`    ${count} x ${text}${details.map(detail => "\n        " + detail.replaceAll("\n", "\n        ")).join("")}`);
      for (const text of result.open) console.log("    still open: " + text.slice(0, 300));
      if (word === "CRASH") console.log(`    exit code ${child.exitCode}`);
      if (!good && printed.trim()) console.log(printed.trim().slice(-1500).replace(/^/gm, "    | "));
      await remove(dir).catch(() => {});
    }
    console.log(Object.entries(totals).map(([word, count]) => `${count} ${word}`).join(", "));
  }
  await remove(root, 600).catch(() => console.log("Could not remove " + root));
  process.exit(failures ? 1 : 0);
}

process.argv[2] === "--scenario" ? runScenario(process.argv[3]) : main();
