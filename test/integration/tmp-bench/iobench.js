// Usage: bun iobench.js <old bun.exe> <new bun.exe> [--rounds 5] [--only a,b]
// Runs every case under both executables, alternating, and prints medians. Loopback, pipes and a temp directory only.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import dns from "node:dns";
import { once } from "node:events";

const self = process.execPath,
  file = import.meta.path;
const now = () => performance.now();
const k32 = process.env.CYCLES && require("bun:ffi").dlopen("kernel32.dll", { QueryProcessCycleTime: { args: ["i64", "ptr"], returns: "i32" }, OpenProcess: { args: ["u32", "i32", "u32"], returns: "i64" } }).symbols;
const processes = [-1n];
const megacycles = () => processes.reduce((sum, handle) => { const out = new BigUint64Array(1); k32.QueryProcessCycleTime(handle, out); return sum + Number(out[0]) / 1e6; }, 0);
const role = (name, args = [], options = {}) => {
  const child = Bun.spawn([process.env.ROLE_EXE || self, file, "--role", name, ...args], { stderr: "inherit", ...options });
  if (k32) processes.push(k32.OpenProcess(0x1000, 0, child.pid));
  return child;
};
const firstLine = async stream => {
  const r = stream.getReader();
  const { value } = await r.read();
  r.releaseLock();
  return Buffer.from(value).toString().trim();
};
const MB = 1 << 20;
// SHORT=0.4 cuts the durations, SMALL=0.25 the amounts.
const SHORT = +(process.env.SHORT ?? 1), SMALL = +(process.env.SMALL ?? 1);

const roles = {
  echo() {
    const s = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(c, d) {
          c.write(d);
        },
      },
    });
    console.log(s.port);
  },
  // Sends one message every argv[5] microseconds for 2 s, whatever comes back.
  async paced() {
    const s = await Bun.connect({ hostname: "127.0.0.1", port: +process.argv[4], socket: { data() {} } });
    const gap = +process.argv[5] * 1000,
      msg = Buffer.alloc(64),
      start = Bun.nanoseconds();
    for (let n = 1; n * gap < 1e9 * SHORT; n++) {
      while (Bun.nanoseconds() - start < n * gap);
      s.write(msg);
    }
    process.exit(0);
  },
  async flood() {
    const msg = Buffer.alloc(64);
    let left = +process.argv[5];
    const pump = s => {
      while (left > 0 && s.write(msg) === 64) left -= 64;
      if (left <= 0) s.end();
    };
    await Bun.connect({ hostname: "127.0.0.1", port: +process.argv[4], socket: { open: pump, drain: pump, data() {} } });
  },
  http() {
    const big = Buffer.alloc(8 * MB, 97);
    const s = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: r =>
        r.url.endsWith("/big")
          ? new Response(big)
          : r.url.endsWith("/file")
            ? new Response(Bun.file(process.argv[4]))
            : new Response("hi"),
    });
    console.log(s.port);
  },
  pipeEcho() {
    net
      .createServer(c => {
        c.on("error", () => {});
        c.on("data", d => c.write(d));
      })
      .listen(process.argv[4], () => console.log("up"));
  },
  pipeSink() {
    net
      .createServer(c => {
        let n = 0;
        c.on("error", () => {});
        c.on("data", d => {
          n += d.length;
          if (n >= +process.argv[5]) c.write("x");
        });
      })
      .listen(process.argv[4], () => console.log("up"));
  },
  spew() {
    const b = Buffer.alloc(+process.argv[4], 97);
    for (let n = +process.argv[5]; n > 0; n -= b.length) fs.writeSync(1, b);
  },
  async drain() {
    let n = 0;
    for await (const c of Bun.stdin.stream()) n += c.length;
    console.log(n);
  },
  drainNode() {
    let n = 0;
    process.stdin.on("data", c => (n += c.length)).on("end", () => console.log(n));
  },
  stdinEcho() {
    process.stdin.on("data", c => fs.writeSync(1, c));
  },
  lines() {
    const t = now(), log = process.argv[4] === "log";
    for (let i = 0; i < 40000; i++) log ? console.log("line") : fs.writeSync(1, "line\n");
    process.send(40000 / ((now() - t) / 1000));
  },
  async stdoutStream() {
    const b = Buffer.alloc(65536);
    for (let i = 0; i < 8192 * SMALL; i++) process.stdout.write(b) || (await once(process.stdout, "drain"));
  },
  ipcEcho() {
    process.on("message", m => process.send(m));
  },
};

async function pingPong(connections, ms, open) {
  let count = 0,
    stop = false;
  const all = await Promise.all(
    Array.from({ length: connections }, () =>
      open(send => {
        count++;
        if (!stop) send();
      }),
    ),
  );
  const t = now();
  for (const c of all) c.send();
  await Bun.sleep(ms * SHORT);
  stop = true;
  const rate = count / ((now() - t) / 1000);
  for (const c of all) c.close();
  return rate;
}
const tcp = k => async () => {
  const p = role("echo");
  const port = +(await firstLine(p.stdout));
  const msg = Buffer.alloc(64);
  try {
    return await pingPong(k, 1500, async got => {
      const s = await Bun.connect({
        hostname: "127.0.0.1",
        port,
        socket: {
          data(c) {
            got(() => c.write(msg));
          },
        },
      });
      return { send: () => s.write(msg), close: () => s.terminate() };
    });
  } finally {
    p.kill();
  }
};
const paced = (gap, echo) => async () => {
  using s = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: (c, d) => void (echo && c.write(d)) } });
  const k = require("bun:ffi").dlopen("kernel32.dll", { QueryProcessCycleTime: { args: ["i64", "ptr"], returns: "i32" } }).symbols;
  const out = new BigUint64Array(1), cycles = () => (k.QueryProcessCycleTime(-1n, out), Number(out[0]));
  const a = cycles();
  await role("paced", [s.port, gap]).exited;
  return (cycles() - a) / 1e6;
};
const rawHttp = k => async tmp => {
  const p = role("http", [small(tmp)]);
  const port = +(await firstLine(p.stdout));
  const msg = Buffer.from("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  try {
    return await pingPong(k, 1500, async got => {
      const s = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data: c => got(() => c.write(msg)) } });
      return { send: () => s.write(msg), close: () => s.terminate() };
    });
  } finally {
    p.kill();
  }
};
const http =
  (route, workers, init, unit = () => 1) =>
  async tmp => {
    const f = path.join(tmp, "served.bin");
    fs.writeFileSync(f, Buffer.alloc(8 * MB, 98));
    const p = role("http", [f]);
    const url = `http://127.0.0.1:${await firstLine(p.stdout)}${route}`;
    try {
      let n = 0;
      const t = now();
      await Promise.all(
        Array.from({ length: workers }, async () => {
          while (now() - t < 1500 * SHORT) n += unit((await (await fetch(url, init)).arrayBuffer()).byteLength);
        }),
      );
      return n / ((now() - t) / 1000);
    } finally {
      p.kill();
    }
  };
const pipeName = () => `\\\\.\\pipe\\iobench-${process.pid}-${Math.random().toString(36).slice(2)}`;
const repeat = (ms, width, f) => async tmp => {
  let n = 0;
  const t = now();
  await Promise.all(
    Array.from({ length: width }, async (_, i) => {
      while (now() - t < ms * SHORT) {
        await f(tmp, i, n);
        n++;
      }
    }),
  );
  return n / ((now() - t) / 1000);
};
const repeatSync = (ms, f) => async tmp => {
  let n = 0;
  const t = now();
  while (now() - t < ms * SHORT) f(tmp, n++);
  return n / ((now() - t) / 1000);
};
const small = tmp => {
  const f = path.join(tmp, "small.txt");
  if (!fs.existsSync(f)) fs.writeFileSync(f, Buffer.alloc(2048, 97));
  return f;
};
const largePingPong = size => async () => {
  const name = pipeName(),
    p = role("pipeEcho", [name]),
    b = Buffer.alloc(size);
  await firstLine(p.stdout);
  try {
    return await pingPong(1, 1500, async got => {
      const c = net.connect(name);
      await once(c, "connect");
      let n = 0;
      c.on("data", d => (n += d.length) === size && ((n = 0), got(() => c.write(b))));
      return { send: () => c.write(b), close: () => c.destroy() };
    });
  } finally {
    p.kill();
  }
};
const cmd = ["cmd.exe", "/d", "/c", "exit"];

// [unit, higher is better, run]
const cases = {
  "tcp ping-pong k=1": ["msg/s", 1, tcp(1)],
  "tcp ping-pong k=64": ["msg/s", 1, tcp(64)],
  "tcp ping-pong k=512": ["msg/s", 1, tcp(512)],
  "http keep-alive x1": ["req/s", 1, http("/", 1)],
  "http keep-alive x16": ["req/s", 1, http("/", 16)],
  "http server k=1": ["req/s", 1, rawHttp(1)],
  "http server k=64": ["req/s", 1, rawHttp(64)],
  "http 8 MB body": ["MB/s", 1, http("/big", 2, undefined, n => n / MB)],
  "http 8 MB file": ["MB/s", 1, http("/file", 2, undefined, n => n / MB)],
  "cpu, a message every 12 us": ["Mcyc", 0, paced(12)],
  "cpu, a message every 16 us": ["Mcyc", 0, paced(16)],
  "cpu, a message every 28 us": ["Mcyc", 0, paced(28)],
  "cpu, a message every 20 us": ["Mcyc", 0, paced(20)],
  "cpu, a message every 40 us": ["Mcyc", 0, paced(40)],
  "cpu, a message every 80 us": ["Mcyc", 0, paced(80)],
  "cpu, a message every 200 us": ["Mcyc", 0, paced(200)],
  "tcp stream of 64 B writes": [
    "MB/s",
    1,
    async () => {
      let n = 0, t;
      const { promise, resolve } = Promise.withResolvers();
      using s = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open: () => (t = now()), data: (_, d) => (n += d.length), close: resolve } });
      role("flood", [s.port, 16 * MB * SMALL]);
      await promise;
      return n / MB / ((now() - t) / 1000);
    },
  ],
  "cpu of an echo server, a message every 40 us": ["Mcyc", 0, paced(40, true)],
  "cpu of an echo server, a message every 80 us": ["Mcyc", 0, paced(80, true)],
  "tcp 500 connections in a row": [
    "ms",
    0,
    async () => {
      const p = role("echo");
      const port = +(await firstLine(p.stdout));
      const t = now();
      for (let i = 0; i < 500; i++) {
        const { promise, resolve } = Promise.withResolvers();
        await Bun.connect({ hostname: "127.0.0.1", port, socket: { open: c => c.write("x"), data: c => (c.terminate(), resolve()) } });
        await promise;
      }
      p.kill();
      return now() - t;
    },
  ],
  ...Object.fromEntries(
    Object.entries({
      "open + close": async f => (await fs.promises.open(f)).close(),
      "writer()": async f => { const s = Bun.file(f).writer(); s.write("x"); await s.end(); },
      "shell redirect": f => Bun.$`echo hi > ${f}`,
      "Bun.sleep(1)": () => Bun.sleep(1),
    }).map(([name, use]) => [
      `busy cpus, 8 x ${name}`,
      [
        "ms",
        0,
        async tmp => {
          const f = path.join(tmp, "busy.txt");
          fs.writeFileSync(f, "");
          for (let i = 0; i < 4 * navigator.hardwareConcurrency; i++) require("crypto").pbkdf2("a", "b", 2e7, 32, "sha256", () => {});
          for (const end = now() + 50; now() < end; );
          const t = now();
          for (let i = 0; i < 8; i++) await use(f);
          return now() - t;
        },
      ],
    ]),
  ),
  "fs.read one by one": ["/s", 1, async tmp => { const fd = fs.openSync(small(tmp), "r"), buf = Buffer.alloc(64); let n = 0; const t = now(); while (now() - t < 1500 * SHORT) await new Promise(r => fs.read(fd, buf, 0, 64, 0, r)), n++; return n / ((now() - t) / 1000); }],
  "setTimeout(1) lateness p50": [
    "ms",
    0,
    async () => {
      const l = [];
      for (let i = 0; i < 300; i++) {
        const t = now();
        await new Promise(r => setTimeout(r, 1));
        l.push(now() - t - 1);
      }
      return l.sort((a, b) => a - b)[150];
    },
  ],
  "setTimeout(0) chain": ["/s", 1, repeat(1000, 1, () => new Promise(r => setTimeout(r, 0)))],
  "setImmediate chain": ["/s", 1, repeat(1000, 1, () => new Promise(r => setImmediate(r)))],
  "idle cpu with a server": [
    "ms",
    0,
    async () => {
      using s = Bun.serve({ port: 0, fetch: () => new Response() });
      await Bun.sleep(200);
      const a = process.cpuUsage();
      await Bun.sleep(2000);
      const b = process.cpuUsage(a);
      return (b.user + b.system) / 1000;
    },
  ],
  "worker ping-pong": [
    "msg/s",
    1,
    async () => {
      const w = new Worker("data:text/javascript,onmessage=e=>postMessage(e.data)");
      await new Promise(r => {
        w.onmessage = r;
        w.postMessage(0);
      });
      return pingPong(1, 1000, async got => {
        w.onmessage = () => got(() => w.postMessage(0));
        return { send: () => w.postMessage(0), close: () => w.terminate() };
      });
    },
  ],
  "worker start+stop": [
    "/s",
    1,
    repeat(1500, 1, async () => {
      const w = new Worker("data:text/javascript,postMessage(0)");
      await new Promise(r => (w.onmessage = r));
      await w.terminate();
    }),
  ],
  "startup bun -e 1": [
    "/s",
    1,
    repeatSync(2000, () => Bun.spawnSync([self, "-e", "1"], { stdio: ["ignore", "ignore", "ignore"] })),
  ],
  "spawnSync ignore": ["/s", 1, repeatSync(2000, () => Bun.spawnSync(cmd, { stdio: ["ignore", "ignore", "ignore"] }))],
  "spawnSync pipes": ["/s", 1, repeatSync(2000, () => Bun.spawnSync(cmd, { stdio: ["pipe", "pipe", "pipe"] }))],
  "spawn x16": ["/s", 1, repeat(2000, 16, () => Bun.spawn(cmd, { stdio: ["pipe", "pipe", "pipe"] }).exited)],
  "spawn call with 300 live pipes": [
    "ms",
    0,
    async () => {
      const live = Array.from({ length: 100 }, () =>
        Bun.spawn(["cmd.exe", "/d", "/c", "pause"], { stdio: ["pipe", "pipe", "pipe"] }),
      );
      let total = 0;
      for (let i = 0; i < 20; i++) {
        const t = now();
        const p = Bun.spawn(cmd, { stdio: ["pipe", "pipe", "pipe"] });
        total += now() - t;
        await p.exited;
      }
      for (const p of live) p.kill();
      await Promise.all(live.map(p => p.exited));
      return total / 20;
    },
  ],
  "child stdout 64K writes, stream": [
    "MB/s",
    1,
    async () => {
      const p = role("spew", [65536, 1024 * MB * SMALL]);
      const t = now();
      let n = 0;
      for await (const c of p.stdout) n += c.length;
      return n / MB / ((now() - t) / 1000);
    },
  ],
  "child stdout 128 B writes, stream": [
    "MB/s",
    1,
    async () => {
      const p = role("spew", [128, 24 * MB * SMALL]);
      const t = now();
      let n = 0;
      for await (const c of p.stdout) n += c.length;
      return n / MB / ((now() - t) / 1000);
    },
  ],
  "child stdout buffered": [
    "MB/s",
    1,
    async () => {
      const t = now();
      const n = (await role("spew", [65536, 512 * MB]).stdout.bytes()).length;
      return n / MB / ((now() - t) / 1000);
    },
  ],
  ...Object.fromEntries(
    [65536, 48 * MB].map(size => [
      `child stdout, ${size} B writes, 50 ms turns`,
      [
        "ms",
        0,
        async () => {
          const busy = setInterval(() => { for (const end = now() + 50; now() < end; ); }, 1);
          const t = now();
          await role("spew", [size, 48 * MB]).stdout.bytes();
          clearInterval(busy);
          return now() - t;
        },
      ],
    ]),
  ),
  "child stdout, spawnSync": [
    "MB/s",
    1,
    async () => {
      const t = now();
      const n = Bun.spawnSync([self, file, "--role", "spew", 65536, 512 * MB]).stdout.length;
      return n / MB / ((now() - t) / 1000);
    },
  ],
  "child stdin buffer -> Bun.stdin": [
    "MB/s",
    1,
    async () => {
      const b = Buffer.alloc(512 * MB * SMALL);
      const t = now();
      const n = +(await role("drain", [], { stdin: b }).stdout.text());
      return n / MB / ((now() - t) / 1000);
    },
  ],
  "child stdin sink -> process.stdin": [
    "MB/s",
    1,
    async () => {
      const b = Buffer.alloc(65536);
      const p = role("drainNode", [], { stdin: "pipe" });
      const t = now();
      for (let i = 0; i < 8192 * SMALL; i++) await p.stdin.write(b);
      await p.stdin.end();
      return +(await p.stdout.text()) / MB / ((now() - t) / 1000);
    },
  ],
  "child stdio ping-pong": [
    "msg/s",
    1,
    async () => {
      const p = role("stdinEcho", [], { stdin: "pipe" });
      const r = p.stdout.getReader();
      let n = 0;
      p.stdin.write("x");
      await r.read();
      const t = now();
      while (now() - t < 1500 * SHORT) {
        p.stdin.write("x");
        p.stdin.flush();
        await r.read();
        n++;
      }
      p.kill();
      return n / ((now() - t) / 1000);
    },
  ],
  "ipc ping-pong": [
    "msg/s",
    1,
    async () => {
      let on;
      const p = role("ipcEcho", [], { ipc: m => on(m), serialization: "json" });
      await new Promise(r => {
        on = r;
        p.send(0);
      });
      return pingPong(1, 1500, async got => {
        on = () => got(() => p.send(0));
        return { send: () => p.send(0), close: () => p.kill() };
      });
    },
  ],
  "ipc burst": [
    "msg/s",
    1,
    async () => {
      let n = 0,
        done;
      const p = role("ipcEcho", [], { ipc: () => ++n === 200000 && done(), serialization: "json" });
      const t = now();
      await new Promise(r => {
        done = r;
        for (let i = 0; i < 200000; i++) p.send(i);
      });
      p.kill();
      return n / ((now() - t) / 1000);
    },
  ],
  "ipc paced, 16 per turn": [
    "msg/s",
    1,
    async () => {
      let on;
      const p = role("ipcEcho", [], { ipc: () => on(), serialization: "json" });
      let n = 0;
      const t = now();
      while (now() - t < 1500 * SHORT) {
        await new Promise(r => {
          let left = 16;
          on = () => --left === 0 && r();
          for (let i = 0; i < 16; i++) p.send(i);
        });
        n += 16;
      }
      p.kill();
      return n / ((now() - t) / 1000);
    },
  ],
  "named pipe ping-pong": [
    "msg/s",
    1,
    async () => {
      const name = pipeName(),
        p = role("pipeEcho", [name]);
      await firstLine(p.stdout);
      try {
        return await pingPong(1, 1500, async got => {
          const c = net.connect(name);
          await once(c, "connect");
          c.on("data", () => got(() => c.write("x")));
          return { send: () => c.write("x"), close: () => c.destroy() };
        });
      } finally {
        p.kill();
      }
    },
  ],
  ...Object.fromEntries(
    Object.entries({
      "open": "await (await require('fs').promises.open(process.execPath)).close()",
      "Bun.file": "await Bun.file(process.execPath).slice(0, 10).text()",
      "lookup": "await require('dns').promises.lookup('localhost')",
      "stdin": "for await (const c of process.stdin);",
    }).map(([name, code]) => [`first ${name} of a process`, ["/s", 1, repeatSync(300, () => Bun.spawnSync([process.execPath, "-e", code], { stdin: Buffer.from("x") }))]]),
  ),
  "worker burst of messages": [
    "msg/s",
    1,
    async () => {
      const N = 200000, w = new Worker(`data:text/javascript,let n = 0; onmessage = () => ++n % ${N} || postMessage(n); postMessage(0)`), next = () => new Promise(r => (w.onmessage = r));
      await next(), await Bun.sleep(300);
      for (const end = now() + 450; now() < end; );
      const t = now(), done = next();
      for (let i = 0; i < N; i++) w.postMessage(i);
      await done;
      return N / ((now() - t) / 1000);
    },
  ],
  ...Object.fromEntries(
    ["late timers", "reads"].map(what => [
      `8 workers that read and compute: ${what}`,
      [
        what === "reads" ? "/s" : "ms",
        +(what === "reads"),
        async tmp => {
          const n = new Int32Array(new SharedArrayBuffer(4)), f = path.join(tmp, "eight.bin");
          fs.writeFileSync(f, Buffer.alloc(4 * MB));
          const code = `onmessage = async e => { const h = await require("fs").promises.open(${JSON.stringify(f)}), b = Buffer.alloc(4 << 20); postMessage(0); for (;;) { await h.read(b, 0, b.length, 0); for (const end = performance.now() + 10; performance.now() < end; ); Atomics.add(e.data, 0, 1); } }`;
          await Promise.all(Array.from({ length: 8 }, () => new Promise(r => { const w = new Worker("data:text/javascript," + encodeURIComponent(code)); w.onmessage = r, w.postMessage(n); })));
          await Bun.sleep(500);
          const t = now(), first = n[0];
          let turns = 0;
          while (now() - t < 3000) await Bun.sleep(25), turns++;
          return what === "reads" ? (n[0] - first) / ((now() - t) / 1000) : (now() - t) / turns - 25;
        },
      ],
    ]),
  ),
  ...Object.fromEntries(
    [[8, "late"], [8, "worst"], [16, "late"], [16, "worst"]].map(([count, what]) => [
      `${count} begin to read: ${what}`,
      [
        "ms",
        0,
        async tmp => {
          const f = path.join(tmp, "begin.bin");
          fs.writeFileSync(f, Buffer.alloc(4 * MB));
          const code = `const fs = require("fs"), burn = ms => { for (const end = performance.now() + ms; performance.now() < end; ); }; onmessage = async () => { const fd = fs.openSync(${JSON.stringify(f)}), b = Buffer.alloc(4 << 20); burn(300); for (;;) { await new Promise(r => fs.read(fd, b, 0, b.length, 0, r)); burn(10); } }; postMessage(0);`;
          const all = await Promise.all(Array.from({ length: count }, () => new Promise(r => { const w = new Worker("data:text/javascript," + encodeURIComponent(code)); w.onmessage = () => r(w); })));
          for (const w of all) w.postMessage(0);
          const t = now();
          let turns = 0, worst = 0;
          for (let last = t; now() - t < 3000; last = now()) await Bun.sleep(25), turns++, (worst = Math.max(worst, now() - last));
          return what === "late" ? (now() - t) / turns - 25 : worst;
        },
      ],
    ]),
  ),
  "fs.write, 5000 at once": [
    "op/s",
    1,
    async tmp => {
      const fd = fs.openSync(path.join(tmp, "many.bin"), "w"), b = Buffer.alloc(64), t = now();
      for (let round = 0; round < 8; round++) await Promise.all(Array.from({ length: 5000 }, () => new Promise(r => fs.write(fd, b, r))));
      return 40000 / ((now() - t) / 1000);
    },
  ],
  "Bun.write 512 KB, for longer": ["/s", 1, async tmp => { const b = Buffer.alloc(512 * 1024); return repeat(5000, 1, () => Bun.write(path.join(tmp, "out.bin"), b))(tmp); }],
  "fs.read 4 MB one by one": ["/s", 1, async tmp => { const f = path.join(tmp, "four.bin"), b = Buffer.alloc(4 * MB); fs.writeFileSync(f, b); const fd = fs.openSync(f); return repeat(1500, 1, () => new Promise(r => fs.read(fd, b, 0, b.length, 0, r)))(tmp); }],
  "fs.read, 5000 at once": [
    "op/s",
    1,
    async tmp => {
      const fd = fs.openSync(small(tmp)), b = Buffer.alloc(64), t = now();
      for (let round = 0; round < 8; round++) await Promise.all(Array.from({ length: 5000 }, () => new Promise(r => fs.read(fd, b, 0, 64, 0, r))));
      return 40000 / ((now() - t) / 1000);
    },
  ],
  "open + close, 2000 at once": [
    "op/s",
    1,
    async tmp => {
      const f = small(tmp), t = now();
      for (let round = 0; round < 5; round++) await Promise.all(Array.from({ length: 2000 }, () => new Promise(r => fs.open(f, (e, fd) => fs.close(fd, r)))));
      return 10000 / ((now() - t) / 1000);
    },
  ],
  "named pipe ping-pong, 100 KiB": ["msg/s", 1, largePingPong(100 * 1024)],
  "named pipe ping-pong, 300 KiB": ["msg/s", 1, largePingPong(300 * 1024)],
  "named pipe stream": [
    "MB/s",
    1,
    async () => {
      const name = pipeName(),
        total = 512 * MB,
        p = role("pipeSink", [name, total]);
      await firstLine(p.stdout);
      const c = net.connect(name);
      await once(c, "connect");
      const b = Buffer.alloc(65536),
        t = now(),
        done = once(c, "data");
      for (let n = 0; n < total; n += b.length) if (!c.write(b)) await once(c, "drain");
      await done;
      c.destroy();
      p.kill();
      return total / MB / ((now() - t) / 1000);
    },
  ],
  "named pipe 200 connects": [
    "ms",
    0,
    async () => {
      const name = pipeName(),
        p = role("pipeEcho", [name]);
      await firstLine(p.stdout);
      const t = now();
      const all = await Promise.all(
        Array.from({ length: 200 }, async () => {
          const c = net.connect(name);
          await once(c, "connect");
          return c;
        }),
      );
      const ms = now() - t;
      for (const c of all) c.destroy();
      p.kill();
      return ms;
    },
  ],
  "shell echo | cat": ["/s", 1, repeat(1500, 1, () => Bun.$`echo hello | cat`.quiet())],
  "fs.statSync": [
    "/s",
    1,
    repeatSync(1000, tmp => fs.statSync(path.join(tmp, "small.txt"), { throwIfNoEntry: false })),
  ],
  "fs.lstatSync missing": [
    "/s",
    1,
    repeatSync(1000, tmp => fs.lstatSync(path.join(tmp, "nope"), { throwIfNoEntry: false })),
  ],
  "fs open+fstat+read+close sync": [
    "/s",
    1,
    async tmp => {
      const f = small(tmp),
        b = Buffer.alloc(4096);
      return repeatSync(1000, () => {
        const fd = fs.openSync(f, "r");
        fs.fstatSync(fd);
        fs.readSync(fd, b, 0, 4096, 0);
        fs.closeSync(fd);
      })(tmp);
    },
  ],
  "fs write+unlink sync": [
    "/s",
    1,
    repeatSync(1500, (tmp, n) => {
      const f = path.join(tmp, "w" + n);
      fs.writeFileSync(f, "x");
      fs.unlinkSync(f);
    }),
  ],
  "fs.realpathSync.native": [
    "/s",
    1,
    async tmp => {
      const f = small(tmp);
      return repeatSync(1000, () => fs.realpathSync.native(f))(tmp);
    },
  ],
  "fs.promises open+read+close x1": [
    "/s",
    1,
    async tmp => {
      const f = small(tmp),
        b = Buffer.alloc(4096);
      return repeat(1000, 1, async () => {
        const h = await fs.promises.open(f);
        await h.read(b, 0, 4096, 0);
        await h.close();
      })(tmp);
    },
  ],
  "fs.promises open+read+close x32": [
    "/s",
    1,
    async tmp => {
      const f = small(tmp);
      return repeat(1000, 32, async () => {
        const h = await fs.promises.open(f);
        await h.read(Buffer.allocUnsafe(4096), 0, 4096, 0);
        await h.close();
      })(tmp);
    },
  ],
  "Bun.file.text x1": [
    "/s",
    1,
    async tmp => {
      const f = small(tmp);
      return repeat(1000, 1, () => Bun.file(f).text())(tmp);
    },
  ],
  "Bun.file.text x32": [
    "/s",
    1,
    async tmp => {
      const f = small(tmp);
      return repeat(1000, 32, () => Bun.file(f).text())(tmp);
    },
  ],
  "Bun.write 512 KB": [
    "/s",
    1,
    async tmp => {
      const b = Buffer.alloc(512 * 1024);
      return repeat(1500, 1, () => Bun.write(path.join(tmp, "out.bin"), b))(tmp);
    },
  ],
  "Bun.write file -> file 8 MB": [
    "/s",
    1,
    async tmp => {
      const f = path.join(tmp, "src.bin");
      fs.writeFileSync(f, Buffer.alloc(8 * MB));
      return repeat(1500, 1, () => Bun.write(path.join(tmp, "copy.bin"), Bun.file(f)))(tmp);
    },
  ],
  "Bun.file.stream 256 MB": [
    "MB/s",
    1,
    async tmp => {
      const f = path.join(tmp, "big.bin");
      fs.writeFileSync(f, Buffer.alloc(256 * MB * SMALL));
      const t = now();
      let n = 0;
      for await (const c of Bun.file(f).stream()) n += c.length;
      return n / MB / ((now() - t) / 1000);
    },
  ],
  "FileSink 256 MB": [
    "MB/s",
    1,
    async tmp => {
      const w = Bun.file(path.join(tmp, "sink.bin")).writer(),
        b = Buffer.alloc(65536),
        t = now();
      for (let i = 0; i < 4096; i++) await w.write(b);
      await w.end();
      return 256 / ((now() - t) / 1000);
    },
  ],
  "fs.createReadStream 256 MB": [
    "MB/s",
    1,
    async tmp => {
      const f = path.join(tmp, "big.bin");
      fs.writeFileSync(f, Buffer.alloc(256 * MB * SMALL));
      const t = now();
      let n = 0;
      for await (const c of fs.createReadStream(f)) n += c.length;
      return n / MB / ((now() - t) / 1000);
    },
  ],
  "dns.lookup localhost x8": [
    "/s",
    1,
    repeat(1000, 8, (_, i, n) => dns.promises.lookup(n % 2 ? "localhost" : "LOCALHOST", { family: i % 2 ? 4 : 6 })),
  ],
  "fs.watch event latency p50": [
    "ms",
    0,
    async tmp => {
      const d = fs.mkdtempSync(path.join(tmp, "w"));
      let on;
      const w = fs.watch(d, (_, f) => on(f));
      const l = [];
      for (let i = 0; i < 200; i++) {
        const seen = new Promise(r => (on = f => f === "f" + i && r()));
        const t = now();
        fs.closeSync(fs.openSync(path.join(d, "f" + i), "w"));
        await seen;
        l.push(now() - t);
      }
      w.close();
      return l.sort((a, b) => a - b)[100];
    },
  ],
  "promises.stat x1": ["/s", 1, repeat(1500, 1, tmp => fs.promises.stat(path.join(tmp, "small.txt")))],
  "promises.stat, bursts of 32": ["/s", 1, repeat(1500, 1, tmp => Promise.all(Array.from({ length: 32 }, () => fs.promises.stat(path.join(tmp, "small.txt")))))],
  "fs.read, bursts of 32": ["/s", 1, tmp => { const fds = Array.from({ length: 32 }, () => fs.openSync(small(tmp), "r")), b = Buffer.alloc(64); return repeat(1500, 1, () => Promise.all(fds.map(fd => new Promise(r => fs.read(fd, b, 0, 64, 0, r)))))(tmp); }],
  "dns 127.0.0.n, bursts of 32": ["/s", 1, repeat(1500, 1, () => Promise.all(Array.from({ length: 32 }, (_, k) => Bun.dns.lookup("127.0.0." + (k + 1), { backend: "system" }))))],
  "open + close one by one": ["/s", 1, repeat(1500, 1, async tmp => (await fs.promises.open(path.join(tmp, "small.txt"))).close())],
  "writer() one by one": ["/s", 1, repeat(1500, 1, async tmp => { const s = Bun.file(path.join(tmp, "w.txt")).writer(); s.write("x"); await s.end(); })],
  "bursts of 100 worker round trips": ["/s", 1, async () => {
    const w = new Worker("data:text/javascript,onmessage=e=>postMessage(e.data)");
    let on, spent = 0, n = 0;
    w.onmessage = () => on();
    const trip = () => new Promise(r => ((on = r), w.postMessage(1)));
    await trip();
    for (const end = now() + 1500 * SHORT; now() < end; n += 100) { const t = now(); for (let i = 0; i < 100; i++) await trip(); spent += now() - t; await Bun.sleep(3); }
    w.terminate();
    return n / (spent / 1000);
  }],
  ...Object.fromEntries(["log", "writeSync"].map(how => [`lines into a pipe, ${how}`, ["/s", 1, async () => {
    let rate;
    const p = role("lines", [how], { ipc: value => (rate = value), serialization: "json" });
    await Promise.all([p.stdout.bytes(), p.exited]);
    return rate;
  }]])),
  "process.stdout of a child, 64K writes": ["MB/s", 1, async () => {
    const p = role("stdoutStream"), t = now();
    let n = 0;
    for await (const c of p.stdout) n += c.length;
    return n / MB / ((now() - t) / 1000);
  }],
  "os.cpus+networkInterfaces": ["/s", 1, repeatSync(1000, () => (os.cpus(), os.networkInterfaces()))],
};

const argv = process.argv.slice(2);
if (argv[0] === "--role") await roles[argv[1]]();
else if (argv[0] === "--list") console.log(JSON.stringify(Object.entries(cases).map(([name, [, higher]]) => [name, higher])));
else if (argv[0] === "--case") {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iobench-"));
  try {
    small(tmp);
    const started = now(), value = await cases[argv[1]][2](tmp);
    console.log(value, ...(k32 ? [megacycles(), now() - started] : []));
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
    } catch {}
  }
  process.exit(0);
} else {
  const [a, b] = argv,
    option = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
  const rounds = +option("--rounds", 5),
    only = option("--only", "").split(",");
  const run = (exe, name) => {
    const r = Bun.spawnSync([exe, file, "--case", name], { timeout: 60000, stdin: "ignore" });
    const v = parseFloat(r.stdout.toString());
    if (Number.isNaN(v))
      console.log(`# ${name} failed under ${exe}: exit=${r.exitCode} ${r.stderr.toString().slice(0, 300)}`);
    return v;
  };
  const version = exe => Bun.spawnSync([exe, "--revision"]).stdout.toString().trim();
  console.log(
    `# os=${os.release()} ${process.arch} cpus=${os.availableParallelism()} old=${version(a)} new=${version(b)} rounds=${rounds}`,
  );
  const show = v => (v >= 100 ? v.toFixed(0) : v.toFixed(2)).padStart(9);
  for (const [name, [unit, higher]] of Object.entries(cases)) {
    if (!only.some(o => name.includes(o))) continue;
    const x = [],
      y = [];
    for (let i = 0; i < rounds; i++)
      i % 2 ? (y.push(run(b, name)), x.push(run(a, name))) : (x.push(run(a, name)), y.push(run(b, name)));
    for (const l of [x, y]) l.sort((p, q) => p - q);
    const m = l => l[l.length >> 1],
      gain = higher ? m(y) / m(x) : m(x) / m(y);
    console.log(
      `${name.padEnd(36)} ${unit.padEnd(6)} old ${show(m(x))} [${show(x[0])} ${show(x.at(-1))}]  new ${show(m(y))} [${show(y[0])} ${show(y.at(-1))}]  x${gain.toFixed(2)}`,
    );
  }
  console.log("# done");
}
