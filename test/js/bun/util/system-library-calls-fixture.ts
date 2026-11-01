// bun system-library-calls-fixture.ts <group> <divisor>
// Each group calls, many times, into code where the operating system's libraries allocate memory that the runtime
// releases, or keep memory that the runtime allocated. It prints "done" when it gets to the end.
import { Database } from "bun:sqlite";
import dns from "node:dns";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const isMacOS = process.platform === "darwin";
const isWindows = process.platform === "win32";
const divisor = Number(process.argv[3] || 1);
const times = (count: number) => Math.max(1, Math.floor(count / divisor));

async function inBatches(total: number, batchSize: number, start: () => Promise<unknown>) {
  for (let done = 0; done < total; done += batchSize) await Promise.all(Array.from({ length: batchSize }, start));
}

function makeFolder() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "system-library-calls-")));
}

function startLookups(count: number) {
  const lookups: Promise<unknown>[] = [];
  for (let i = 0; i < count; i++) {
    lookups.push(
      dns.promises.lookup("localhost", { all: true }),
      Bun.dns.lookup("localhost", { backend: "system" }),
      Bun.dns.lookup("localhost", { backend: "libc" }),
      Bun.dns.lookup("localhost", { backend: "c-ares" }),
    );
  }
  return lookups;
}

// 24-bit BMP.
function makeBmp(width: number, height: number) {
  const pixelBytes = width * 3 * height;
  const bmp = new Uint8Array(54 + pixelBytes);
  const header = new DataView(bmp.buffer);
  bmp[0] = 0x42;
  bmp[1] = 0x4d;
  header.setUint32(2, bmp.length, true);
  header.setUint32(10, 54, true);
  header.setUint32(14, 40, true);
  header.setInt32(18, width, true);
  header.setInt32(22, height, true);
  header.setUint16(26, 1, true);
  header.setUint16(28, 24, true);
  header.setUint32(34, pixelBytes, true);
  for (let i = 54; i < bmp.length; i++) bmp[i] = (i * 7) & 0xff;
  return bmp;
}

export const groups: Record<string, () => Promise<void> | void> = {
  async "dns.lookup"() {
    await inBatches(times(2000), 100, () => dns.promises.lookup("localhost", { all: true }));
    await inBatches(times(1000), 100, () => dns.promises.lookup("127.0.0.1"));
  },

  async "Bun.dns.lookup with every backend"() {
    for (const backend of ["system", "libc", "c-ares"] as const) {
      await inBatches(times(1000), 100, () => Bun.dns.lookup("localhost", { backend }));
      await inBatches(times(500), 100, () => Bun.dns.lookup("127.0.0.1", { backend }));
    }
    await Promise.all(startLookups(times(300)));
  },

  "process.exit while lookups are in flight"() {
    startLookups(100);
    console.log("done");
    process.exit(0);
  },

  async "process.exit while some lookups have finished"() {
    await Promise.race(startLookups(100));
    console.log("done");
    process.exit(0);
  },

  async "connections by host name"() {
    using server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    await inBatches(times(600), 50, () => fetch(`http://localhost:${server.port}/`).then(response => response.text()));
    await inBatches(
      times(300),
      50,
      () =>
        new Promise<void>((resolve, reject) => {
          const socket = net.connect(server.port!, "localhost", () => socket.end());
          socket.on("close", () => resolve());
          socket.on("error", reject);
        }),
    );
    Bun.dns.prefetch("localhost", server.port);
    Bun.dns.getCacheStats();
  },

  async paths() {
    const folder = makeFolder();
    const before = process.cwd();
    fs.mkdirSync(path.join(folder, "a/b/c"), { recursive: true });
    if (!isWindows) fs.symlinkSync(path.join(folder, "a/b"), path.join(folder, "link"));
    const deep = path.join(folder, isWindows ? "a/b" : "link", "c");
    for (let i = 0; i < times(3000); i++) {
      fs.realpathSync(deep);
      fs.realpathSync.native(deep);
      if (!isWindows) fs.readlinkSync(path.join(folder, "link"));
      process.chdir(i % 2 ? folder : deep);
      process.cwd();
    }
    process.chdir(before);
    await inBatches(times(2000), 50, () => fs.promises.realpath(deep));
    for (let i = 0; i < times(300); i++) fs.rmdirSync(fs.mkdtempSync(path.join(folder, "made-")));
    fs.rmSync(folder, { recursive: true, force: true });
  },

  "users, hosts and network interfaces"() {
    for (let i = 0; i < times(2000); i++) {
      os.userInfo();
      os.userInfo({ encoding: "buffer" });
      os.homedir();
      os.hostname();
      os.networkInterfaces();
      os.release();
      os.version();
      os.machine();
      os.loadavg();
      os.uptime();
      os.totalmem();
      os.freemem();
      os.tmpdir();
    }
    for (let i = 0; i < times(300); i++) os.cpus();
  },

  async directories() {
    const folder = makeFolder();
    for (let i = 0; i < 100; i++) {
      fs.mkdirSync(path.join(folder, `folder-${i % 10}`), { recursive: true });
      fs.writeFileSync(path.join(folder, `folder-${i % 10}`, `file-${i}-${"n".repeat(i)}`), "");
    }
    for (let i = 0; i < times(500); i++) {
      fs.readdirSync(folder);
      fs.readdirSync(folder, { withFileTypes: true });
      fs.readdirSync(folder, { recursive: true });
      const opened = fs.opendirSync(folder);
      while (opened.readSync());
      opened.closeSync();
      Array.from(new Bun.Glob("**/file-*").scanSync({ cwd: folder }));
    }
    await inBatches(times(1000), 50, () => fs.promises.readdir(folder, { recursive: true, withFileTypes: true }));
    for (let i = 0; i < times(100); i++) {
      fs.cpSync(path.join(folder, "folder-1"), path.join(folder, "copy"), { recursive: true });
      fs.rmSync(path.join(folder, "copy"), { recursive: true });
    }
    fs.rmSync(folder, { recursive: true, force: true });
  },

  "stack traces and profiles"() {
    const { profile } = require("bun:jsc");
    function recurse(depth: number): string {
      return depth ? recurse(depth - 1) : new Error("deep").stack!;
    }
    for (let i = 0; i < times(3000); i++) {
      recurse(30);
      Error.captureStackTrace({});
    }
    // The sampling profiler is not relied on there.
    if (isWindows) return;
    for (let i = 0; i < times(10); i++) {
      profile(() => {
        let text = "";
        for (let j = 0; j < 200_000; j++) text = String(j) + text.slice(0, 20);
        return JSON.stringify(Array.from({ length: 20_000 }, (_, index) => ({ index, text })));
      }, 50);
    }
  },

  "Intl and Unicode"() {
    const locales = ["en-US", "de-DE", "ja-JP", "ar-EG", "hi-IN", "tr-TR"];
    const zones = ["UTC", "America/Los_Angeles", "Asia/Kolkata", "Europe/Berlin"];
    const date = new Date(1_700_000_000_000);
    for (let i = 0; i < times(300); i++) {
      const locale = locales[i % locales.length];
      const timeZone = zones[i % zones.length];
      new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "full", timeZone }).formatToParts(date);
      new Intl.DateTimeFormat(locale, { timeZone }).formatRange(date, new Date(+date + 1e9));
      new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).formatToParts(1234567.891);
      new Intl.NumberFormat(locale, { notation: "compact" }).formatRange(3, 5000);
      new Intl.Collator(locale, { numeric: true }).compare("a10", "a9");
      new Intl.PluralRules(locale, { type: "ordinal" }).select(i);
      new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).formatToParts(-i, "day");
      new Intl.ListFormat(locale, { type: "disjunction" }).formatToParts(["a", "b", "c"]);
      new Intl.DisplayNames(locale, { type: "region" }).of("JP");
      new Intl.Locale(locale).maximize().minimize().toString();
      Array.from(new Intl.Segmenter(locale, { granularity: "word" }).segment("The quick brown fox. 吾輩は猫である。"));
      new Intl.DurationFormat(locale, { style: "long" }).format({ hours: 1, minutes: i });
      "İstanbul straße ǆ".toLocaleUpperCase(locale).toLocaleLowerCase(locale);
      "é ﬃ Å".normalize("NFC").normalize("NFKD");
      "résumé".localeCompare("resume", locale, { sensitivity: "base" });
      date.toLocaleString(locale, { timeZone });
      (123456.789).toLocaleString(locale);
      if (i % 50 === 0) {
        Intl.supportedValuesOf("timeZone");
        Intl.getCanonicalLocales(locales);
        Bun.gc(true);
      }
    }
  },

  "time zones and the environment"() {
    for (let i = 0; i < times(5000); i++) {
      process.env[`SYSTEM_LIBRARY_CALLS_${i % 50}`] = "v".repeat(i % 300);
      if (i % 3 === 0) delete process.env[`SYSTEM_LIBRARY_CALLS_${(i + 7) % 50}`];
    }
    for (let i = 0; i < times(1000); i++) {
      process.env.TZ = ["UTC", "America/New_York", "Asia/Tokyo", "Australia/Lord_Howe"][i % 4];
      new Date(2020, i % 12, 1).toString();
      new Date().getTimezoneOffset();
    }
    for (let i = 0; i < times(200); i++) process.title = "title " + "t".repeat(i % 40);
  },

  sqlite() {
    const { DatabaseSync } = require("node:sqlite");
    for (let i = 0; i < times(200); i++) {
      const db = new Database(":memory:");
      db.run("CREATE TABLE t (id INTEGER PRIMARY KEY, text TEXT, blob BLOB, real REAL)");
      const insert = db.prepare("INSERT INTO t (text, blob, real) VALUES (?, ?, ?)");
      db.transaction(() => {
        for (let row = 0; row < 50; row++)
          insert.run("text ☃ " + "x".repeat(row * 20), new Uint8Array(row * 50), row / 3);
      })();
      db.query("SELECT * FROM t WHERE id > ? ORDER BY text DESC").all(5);
      db.query("SELECT group_concat(text, ',') AS joined, upper(text) FROM t").get();
      db.query("SELECT * FROM t").values();
      insert.toString();
      try {
        db.run("SELECT * FROM missing");
      } catch {}
      const copy = Database.deserialize(db.serialize());
      copy.run("INSERT INTO t (text) VALUES (?)", ["y".repeat(100_000)]);
      copy.query("SELECT count(*) FROM t").get();
      copy.close();
      db.close();

      const sync = new DatabaseSync(":memory:");
      sync.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, text TEXT, blob BLOB)");
      const statement = sync.prepare("INSERT INTO t (text, blob) VALUES (?, ?)");
      for (let row = 0; row < 20; row++) statement.run("z".repeat(row * 30), new Uint8Array(row * 10));
      sync.prepare("SELECT * FROM t").all();
      statement.expandedSQL;
      sync.function("twice", (text: string) => text + text);
      sync.prepare("SELECT twice(text) FROM t").all();
      sync.close();
    }
  },

  async images() {
    const bmp = makeBmp(320, 200);
    for (const backend of ["system", "bun"] as const) {
      Bun.Image.backend = backend;
      for (let i = 0; i < times(40); i++) {
        const png = await new Bun.Image(bmp)
          .resize(160 + i, 100)
          .png()
          .bytes();
        const jpeg = await new Bun.Image(png).resize(64, 64, { filter: "lanczos3" }).jpeg({ quality: 80 }).bytes();
        await new Bun.Image(jpeg).webp().bytes();
        await new Bun.Image(png).metadata();
        for (const format of ["heic", "avif"] as const) {
          // Not every machine has an encoder for these.
          await new Bun.Image(png)
            [format]()
            .bytes()
            .then(
              bytes => new Bun.Image(bytes).png().bytes(),
              () => {},
            )
            .catch(() => {});
        }
      }
    }
    for (let i = 0; i < times(50); i++) {
      Bun.Image.clipboardChangeCount();
      if (Bun.Image.hasClipboardImage()) await Bun.Image.fromClipboard()?.png().bytes();
    }
  },

  async "web views"() {
    if (!isMacOS) return;
    for (let i = 0; i < times(10); i++) {
      const view = new Bun.WebView({ width: 200, height: 100 });
      try {
        await view.navigate("data:text/html," + encodeURIComponent(`<h1 id=t>${"text ".repeat(i * 100)}</h1>`));
        await view.evaluate("document.getElementById('t').textContent");
        await view.evaluate("Array.from({ length: 5000 }, (_, i) => 'item ' + i)");
      } finally {
        view.close();
      }
    }
  },

  async secrets() {
    for (let i = 0; i < times(30); i++) {
      // Whether there is a store to ask, and whether it answers, depends on the machine.
      const answered = await Promise.race([
        Bun.secrets.get({ service: "bun-test-system-library-calls", name: "missing-" + i }).then(
          () => true,
          () => true,
        ),
        Bun.sleep(3000).then(() => false),
      ]);
      if (!answered) {
        console.log("done");
        process.exit(0);
      }
    }
  },

  async "file watchers"() {
    const folder = makeFolder();
    for (let i = 0; i < times(60); i++) {
      const { promise, resolve } = Promise.withResolvers<void>();
      const watcher = fs.watch(folder, { recursive: isMacOS || isWindows }, () => resolve());
      const writing = setInterval(() => fs.writeFileSync(path.join(folder, `file-${i}`), String(Date.now())), 5);
      await promise;
      clearInterval(writing);
      watcher.close();
    }
    fs.rmSync(folder, { recursive: true, force: true });
  },

  async "child processes"() {
    const command = isWindows ? ["cmd", "/c", "exit 0"] : ["true"];
    for (let i = 0; i < times(200); i++) {
      Bun.spawnSync(command, { env: { ...process.env, [`VARIABLE_${i}`]: "v".repeat(i) }, cwd: os.tmpdir() });
    }
    await inBatches(times(200), 20, () => Bun.spawn(command, { stdout: "pipe", stderr: "pipe" }).exited);
    require("node:child_process").execFileSync(process.execPath, ["--version"]);
  },

  async "sockets that buffer what the peer does not read"() {
    const body = Buffer.alloc(6 * 1024 * 1024, "b").toString();
    const message = "m".repeat(256 * 1024);
    using server = Bun.serve({
      port: 0,
      fetch(request, server) {
        if (server.upgrade(request)) return;
        return new Response(body);
      },
      websocket: {
        open(socket) {
          for (let i = 0; i < 40; i++) socket.send(message);
          socket.send("last");
        },
        message() {},
      },
    });
    await inBatches(
      times(20),
      5,
      () =>
        new Promise<void>((resolve, reject) => {
          let received = 0;
          const socket = net.connect(server.port!, "127.0.0.1", () => {
            socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
            socket.pause();
            setTimeout(() => socket.resume(), 30);
          });
          socket.on("data", chunk => void (received += chunk.length));
          socket.on("close", () => (received > body.length ? resolve() : reject(new Error("a short response"))));
          socket.on("error", reject);
        }),
    );
    await inBatches(
      times(20),
      5,
      () =>
        new Promise<void>((resolve, reject) => {
          const socket = new WebSocket(`ws://127.0.0.1:${server.port}/`);
          socket.onmessage = event => {
            if (event.data === "last") {
              socket.close();
              resolve();
            }
          };
          socket.onerror = () => reject(new Error("the WebSocket failed"));
        }),
    );
  },
};

if (import.meta.main) {
  await groups[process.argv[2]]();
  console.log("done");
}
