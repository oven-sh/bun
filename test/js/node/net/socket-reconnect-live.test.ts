import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

// connect_finish must tear down a still-live previous native socket before
// reusing the wrapper, not alias two native sockets onto one ext slot.
describe.concurrent("socket.connect() on an already-connected socket", () => {
  it("does not crash and emits connect for the new connection", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { createServer, connect } = require("node:net");
          const srv = createServer(c => c.on("error", () => {})).listen(0, "127.0.0.1", () => {
            const port = srv.address().port;
            const s = connect(port, "127.0.0.1", () => {
              process.stdout.write("first ");
              s.once("connect", () => {
                process.stdout.write("second");
                s.destroy();
                srv.close();
              });
              s.once("error", e => {
                process.stdout.write("err:" + e.code);
                srv.close();
              });
              s.connect(port, "127.0.0.1");
            });
          });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "first second", stderr, exitCode: 0 });
  });

  it("pauses the new connection although the previous one was left paused", async () => {
    // The wrapper is reused, so the paused state recorded for the first connection must
    // not turn the pause of the second one (a paused stream stops its new handle in
    // afterConnect) into a no-op.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { createServer, connect } = require("node:net");
          const { once } = require("node:events");
          let connections = 0;
          const wrote = Promise.withResolvers();
          const srv = createServer(c => {
            c.on("error", () => {});
            if (++connections === 2) c.end("hello", wrote.resolve);
          });
          srv.listen(0, "127.0.0.1", async () => {
            const port = srv.address().port;
            let resumed = false;
            let deliveredWhilePaused = false;
            let received = "";
            const onread = {
              buffer: Buffer.alloc(64),
              callback(n, buf) {
                if (!resumed) deliveredWhilePaused = true;
                received += buf.toString("utf8", 0, n);
                if (received === "hello") {
                  console.log(JSON.stringify({ deliveredWhilePaused, received }));
                  s.destroy();
                  srv.close();
                }
              },
            };
            const s = connect({ port, host: "127.0.0.1", onread });
            await once(s, "connect");
            // Connected and reading: this pause stops the first connection's handle.
            s.pause();
            s.connect({ port, host: "127.0.0.1" });
            await once(s, "connect");
            // "hello" is queued on the second connection once the server's end() callback
            // ran. The loop polls once between the two immediates, so a handle that still
            // reads delivers it (to the callback above, while !resumed) before resume().
            await wrote.promise;
            await new Promise(done => setImmediate(() => setImmediate(done)));
            resumed = true;
            s.resume();
          });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({ deliveredWhilePaused: false, received: "hello" }),
      stderr,
      exitCode: 0,
    });
  });

  it("does not crash when reconnecting while the first connect is still in flight", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { createServer, connect } = require("node:net");
          const srv = createServer(c => c.on("error", () => {})).listen(0, "127.0.0.1", () => {
            const port = srv.address().port;
            const s = connect(port, "127.0.0.1");
            // Second connect while the first is still connecting.
            s.connect(port, "127.0.0.1");
            s.once("connect", () => {
              process.stdout.write("connect");
              s.destroy();
              srv.close();
            });
            s.once("error", e => {
              process.stdout.write("err:" + e.code);
              s.destroy();
              srv.close();
            });
          });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Node emits EALREADY here; Bun drops the first in-flight connect and
    // completes the second. Either is acceptable so long as the process
    // exits cleanly.
    expect(["connect", "err:EALREADY"]).toContain(stdout);
    expect({ stderr, exitCode }).toEqual({ stderr, exitCode: 0 });
  });
});

// A TLS socket that adopts the fd of the socket it wraps leaves two handles over one native socket: its own, which
// the native socket reports to, and the wrapped socket's. Neither can drop that socket for a new dial on its own.
// Node calls connect(2) on the fd it has: EISCONN, except that Linux answers 0 the first time and 'connect' fires again.
// A dial here opens a new fd, so there is no kernel to ask and the answer is EISCONN every time.
describe.concurrent("socket.connect() through a handle that shares its transport", () => {
  // Runs the scenarios in one child, one after the other. Each returns the sockets it made.
  async function run(scenarios: Record<string, string>) {
    const script = `
      const net = require("node:net");
      const tls = require("node:tls");
      const { once } = require("node:events");
      const { Duplex } = require("node:stream");
      const next = (socket, event) => new Promise(done => socket.once(event, done));
      const scenarios = {
        ${Object.entries(scenarios)
          .map(([name, body]) => `${JSON.stringify(name)}: async ({ server, target, dial, watch }) => { ${body} }`)
          .join(",\n")}
      };
      (async () => {
        const results = {};
        for (const name in scenarios) {
          const events = [];
          const watch = (name, socket) => {
            socket.on("connect", () => events.push(name + " connect"));
            socket.on("error", err => events.push(name + " " + err.code));
            return next(socket, "close");
          };
          const uncaught = err => events.push("uncaught " + err.code);
          process.on("uncaughtException", uncaught);
          const accepted = [];
          const server = net.createServer(c => (accepted.push(c.remotePort), c.on("error", () => {})));
          await once(server.listen(0, "127.0.0.1"), "listening");
          const target = { host: "127.0.0.1", port: server.address().port };
          let meant = 0;
          const dial = () => (meant++, net.connect(target));
          const sockets = await scenarios[name]({ server, target, dial, watch });
          // Connections are accepted in the order they were made: once this one is, so is any dial before it.
          const last = dial();
          await once(last, "connect");
          while (!accepted.includes(last.localPort)) await once(server, "connection");
          sockets.push(last);
          // Closed native sockets are freed at the end of a loop turn. Had the dial closed one behind a handle, these read it.
          await new Promise(done => setImmediate(() => setImmediate(done)));
          for (const socket of sockets) socket._handle?.remoteAddress, socket.getProtocol?.();
          // A connection that is reset early may never be accepted, so fewer than were meant is fine.
          results[name] = { events, otherDials: Math.max(0, accepted.length - meant) };
          for (const socket of sockets) socket.destroy();
          server.close();
          process.off("uncaughtException", uncaught);
        }
        console.log(JSON.stringify(results));
      })();
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { results: stdout && JSON.parse(stdout), stderr, exitCode };
  }

  it("fails with EISCONN on the wrapped socket and dials nothing", async () => {
    const wrapped = (connect: string) => `
      const plain = dial();
      await once(plain, "connect");
      const secure = tls.connect({ socket: plain });
      const closed = Promise.all([watch("plain", plain), watch("secure", secure)]);
      ${connect}
      await Promise.race([closed, next(plain, "connect")]);
      return [plain, secure];
    `;
    const { results, stderr, exitCode } = await run({
      "an address": wrapped(`plain.connect(target);`),
      "an address and TLS options": wrapped(`plain[Symbol.for("::buntls::")] = () => ({}); plain.connect(target);`),
      "an address and unusable TLS options": wrapped(
        `plain[Symbol.for("::buntls::")] = () => ({ ca: "garbage" }); plain.connect(target);`,
      ),
      "a path": wrapped(`plain.connect({ path: "/nowhere.sock" });`),
      "an fd": wrapped(`plain.connect({ fd: 0 });`),
      "an fd adopted between connect() and its dial": `
        const plain = dial();
        // Ahead of the listener by which tls.connect() adopts the fd.
        plain.once("connect", () => plain.connect(target));
        const secure = tls.connect({ socket: plain });
        await Promise.all([watch("plain", plain), watch("secure", secure)]);
        return [plain, secure];
      `,
      "an accepted socket wrapped as the server side": `
        const peer = dial().on("error", () => {});
        const [plain] = await once(server, "connection");
        const secure = new tls.TLSSocket(plain, { isServer: true, secureContext: tls.createSecureContext({}) });
        const closed = Promise.all([watch("plain", plain), watch("secure", secure)]);
        plain.connect(target);
        await Promise.race([closed, next(plain, "connect")]);
        return [plain, secure, peer];
      `,
    });
    const refused = { events: ["secure EISCONN", "plain EISCONN"], otherDials: 0 };
    expect({ results, stderr, exitCode }).toEqual({
      results: {
        "an address": refused,
        "an address and TLS options": refused,
        "an address and unusable TLS options": refused,
        "a path": refused,
        "an fd": refused,
        "an fd adopted between connect() and its dial": {
          events: ["secure connect", "plain connect", "secure EISCONN", "plain EISCONN"],
          otherDials: 0,
        },
        "an accepted socket wrapped as the server side": { events: ["plain EISCONN"], otherDials: 0 },
      },
      stderr,
      exitCode: 0,
    });
  });

  // `_handle` is public. Destroying `other` then closes the handle it was given, and its owners hear of that.
  it("fails with EISCONN on another socket that was given the handle", async () => {
    const given = (transport: string, owner: string) => `
      const plain = dial();
      await once(plain, "connect");
      const secure = tls.connect({ socket: ${transport} }).on("error", () => {});
      const other = new tls.TLSSocket();
      other._handle = ${owner}._handle;
      const closed = Promise.all([watch("other", other), next(secure, "close")]);
      other.connect(target);
      await Promise.race([closed, next(other, "connect")]);
      return [plain, secure, other];
    `;
    const { results, stderr, exitCode } = await run({
      "of the wrapped socket": given("plain", "plain"),
      "of the TLS socket": given("plain", "secure"),
      "of a TLS socket over a Duplex": given(
        "new Duplex({ read() {}, write(chunk, encoding, cb) { cb(); } })",
        "secure",
      ),
    });
    const refused = { events: ["other EISCONN"], otherDials: 0 };
    expect({ results, stderr, exitCode }).toEqual({
      results: {
        "of the wrapped socket": refused,
        "of the TLS socket": refused,
        "of a TLS socket over a Duplex": refused,
      },
      stderr,
      exitCode: 0,
    });
  });
});
