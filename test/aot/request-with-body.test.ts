import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { unsupported } from "./run-programs";

const files = {
  "main.cjs": String.raw`
const http = require("node:http");
const net = require("node:net");
const stream = require("node:stream");

let lines = [];
const say = text => {
  if (!lines.includes(text)) lines.push(text);
};
const consumers = {
  data(req, done) {
    let bytes = 0;
    req.on("data", chunk => { bytes += chunk.length; say("data"); });
    req.on("end", () => done(bytes));
  },
  "data, paused at the first chunk"(req, done) {
    let bytes = 0;
    let hasPaused = false;
    req.on("data", chunk => {
      bytes += chunk.length;
      say("data");
      if (hasPaused) return;
      hasPaused = true;
      req.pause();
      say("paused " + req.isPaused());
      setTimeout(() => { say("resumes"); req.resume(); }, 5);
    });
    req.on("end", () => done(bytes));
  },
  readable(req, done) {
    let bytes = 0;
    req.on("readable", () => {
      say("readable");
      for (let chunk; (chunk = req.read()) !== null; ) bytes += chunk.length;
    });
    req.on("end", () => done(bytes));
  },
  async "for await"(req, done) {
    let bytes = 0;
    for await (const chunk of req) bytes += chunk.length;
    done(bytes);
  },
  "a slow pipe"(req, done) {
    let bytes = 0;
    req.pipe(new stream.Writable({
      highWaterMark: 1024,
      write(chunk, encoding, callback) { bytes += chunk.length; say("written"); setImmediate(callback); },
      final(callback) { callback(); done(bytes); },
    }));
  },
  "read a while later"(req, done) {
    setTimeout(() => consumers.data(req, done), 10);
  },
  "the connection paused and resumed"(req, done) {
    req.socket.pause();
    say("socket paused " + req.socket.isPaused());
    setTimeout(() => { req.socket.resume(); say("socket resumed " + req.socket.isPaused()); consumers.data(req, done); }, 5);
  },
  nobody(req, done) {
    done(-1);
  },
};
const spies = {
  none() {},
  "resume of the connection"(socket) {
    if (Object.hasOwn(socket, "resume")) return;
    const { resume } = socket;
    socket.resume = function () { say("socket.resume"); return resume.call(this); };
  },
};
function spyOnPrototype(object, name, title) {
  const original = object[name];
  object[name] = function () { if (this instanceof net.Socket && this.server) say(title); return original.apply(this, arguments); };
  return () => (object[name] = original);
}
let current;
const server = http.createServer((req, res) => {
  const { consumer, spy, done } = current;
  spies[spy]?.(req.socket);
  if (consumer !== "nobody") for (const name of ["pause", "resume", "end", "close", "error", "aborted"]) req.on(name, () => say("req " + name));
  consumers[consumer](req, bytes => {
    say("bytes " + bytes);
    res.on("close", () => setTimeout(() => {
      say("at last " + [req.complete, req.readableEnded, req.destroyed, req.socket && req.socket.readableFlowing, req.socket && req.socket.isPaused()].join());
      done();
    }, 5));
    res.end("ok");
  });
});
server.listen(0, "127.0.0.1", async () => {
  for (const spy of ["none", "resume of the connection", "net.Socket.prototype.resume", "Duplex.prototype.resume"]) {
    const restore = spy === "net.Socket.prototype.resume" ? spyOnPrototype(net.Socket.prototype, "resume", "net resume") : spy === "Duplex.prototype.resume" ? spyOnPrototype(stream.Readable.prototype, "resume", "stream resume") : undefined;
    for (const consumer of Object.keys(consumers)) {
      for (const size of consumer === "read a while later" ? [2] : consumer === "nobody" ? [0, 2, 300000] : [2, 300000]) {
        const socket = net.connect(server.address().port, "127.0.0.1");
        socket.on("data", () => {});
        socket.on("error", () => {});
        await new Promise(resolve => socket.on("connect", resolve));
        for (let round = 0; round < 2; round++) {
          lines = [];
          await new Promise(done => {
            current = { consumer, spy, done };
            socket.write(size === 0 ? "GET / HTTP/1.1\r\nHost: a\r\n\r\n" : "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: " + size + "\r\n\r\n" + "x".repeat(size));
          });
          console.log("== " + spy + " | " + consumer + " | " + size + " | " + round + "\n  " + lines.join("\n  "));
        }
        socket.destroy();
      }
    }
    restore?.();
  }
  server.close();
  server.closeAllConnections();
});
`,
};

const scene = (stdout: string, title: string) => {
  const lines = stdout.split("\n");
  const at = lines.indexOf("== " + title);
  const end = lines.findIndex((line, index) => index > at && line.startsWith("== "));
  return at < 0 ? [] : lines.slice(at + 1, end).map(line => line.trim());
};

test.skipIf(!!unsupported)(
  "a request with a body is read the same however the connection is resumed",
  async () => {
    using dir = tempDir("aot-request-with-a-body", files);
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
      String(dir),
      bunEnv,
    );
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    const plain = await run([bunExe(), "run", "main.cjs"], String(dir), bunEnv);
    const compiled = await run([executable], String(dir), { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
    expect(plain.stdout.split("\n").filter(line => line.startsWith("== ")).length).toBe(128);
    expect(scene(plain.stdout, "none | data, paused at the first chunk | 300000 | 1")).toEqual([
      "req resume",
      "data",
      "req pause",
      "paused true",
      "resumes",
      "req end",
      "bytes 300000",
      "req close",
      "at last true,true,true,true,false",
    ]);
    expect(scene(plain.stdout, "net.Socket.prototype.resume | data | 2 | 1")).toContain("net resume");
    expect(scene(plain.stdout, "Duplex.prototype.resume | data | 2 | 1")).toContain("stream resume");
    expect(scene(plain.stdout, "resume of the connection | data | 2 | 1")).toContain("socket.resume");
    expect(scene(plain.stdout, "net.Socket.prototype.resume | nobody | 0 | 1")).toContain("net resume");
    expect(scene(plain.stdout, "Duplex.prototype.resume | nobody | 0 | 1")).toContain("stream resume");
    expect(scene(plain.stdout, "resume of the connection | nobody | 0 | 1")).toContain("socket.resume");
  },
  240_000,
);
