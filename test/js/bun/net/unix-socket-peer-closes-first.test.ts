import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { isLinux, isWindows, tempDir } from "harness";
import { once } from "node:events";
import net from "node:net";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { mysqlRawPacket } from "../../sql/wire-frames";

// The peer runs on a worker thread, so it can act while this thread is blocked and cannot poll.
// The first event this thread then sees for the connection is the peer's hangup.
// Not concurrent: the tests share one peer and its state.
// Skipped on Windows: not run there, and the branch under test is not reached. The libuv backend
// takes the error and eof flags of an event from the poll status, and the peer's close is an
// event with status 0, so it sets neither flag on the first event of a connect.
describe.skipIf(isWindows)("a unix socket peer that closes before the connecting thread polls", () => {
  // state[0]: the peer sets it when its part is done (1: as asked, 2: not as asked).
  // state[1]: this thread sets it when its connect call has returned.
  const state = new Int32Array(new SharedArrayBuffer(8));
  let dir: ReturnType<typeof tempDir>;
  let worker: Worker;
  let sockets = 0;

  beforeAll(() => {
    dir = tempDir("uds-peer-closes-first", {
      "peer.mjs": `
        import { parentPort, workerData as state } from "node:worker_threads";
        let listener;
        parentPort.on("message", ({ listen, answer }) => {
          listener?.stop(true);
          Atomics.store(state, 0, 0);
          Atomics.store(state, 1, 0);
          let accepted = 0;
          listener = Bun.listen({
            ...listen,
            socket: {
              open(socket) {
                accepted++;
                if (!answer) return;
                const wrote = socket.write(answer);
                // close(2) at once for a unix socket. A FIN for TCP, where terminate() is a reset.
                if (listen.unix) socket.terminate();
                else socket.end();
                Atomics.store(state, 0, wrote === answer.byteLength ? 1 : 2);
                Atomics.notify(state, 0);
              },
              data() {},
            },
          });
          parentPort.postMessage(listener.port ?? 0);
          if (answer) return;
          // No answer: close the listener with the connection still in its accept queue.
          // This thread stays blocked, so it cannot accept, until the client has connected.
          Atomics.wait(state, 1, 0, 10_000);
          listener.stop(true);
          listener = undefined;
          Atomics.store(state, 0, accepted === 0 ? 1 : 2);
          Atomics.notify(state, 0);
        });
      `,
    });
    worker = new Worker(join(String(dir), "peer.mjs"), { workerData: state });
  });

  afterAll(async () => {
    await worker?.terminate();
    dir?.[Symbol.dispose]();
  });

  // With an answer, the peer sends it as soon as it accepts, and closes.
  // With no answer, the peer closes its listener and never accepts.
  async function peer(answer?: Uint8Array, transport: "unix" | "tcp" = "unix") {
    const unix = join(String(dir), `${sockets++}.sock`);
    const listening = once(worker, "message");
    worker.postMessage({ listen: transport === "tcp" ? { hostname: "127.0.0.1", port: 0 } : { unix }, answer });
    const [port] = await listening;
    return { unix, port: port as number };
  }

  // This thread must not poll between its connect call and the peer's last step:
  // call this right after the connect call, with no await between the two.
  function blockUntilPeerIsDone() {
    Atomics.store(state, 1, 1);
    Atomics.notify(state, 1);
    if (Atomics.wait(state, 0, 0, 10_000) === "timed-out") return "timed out";
    return Atomics.load(state, 0) === 1 ? "done" : "not as asked";
  }

  async function bunConnect(unix: string) {
    const events: string[] = [];
    const chunks: Buffer[] = [];
    const closed = Promise.withResolvers<void>();
    const connecting = Bun.connect({
      unix,
      socket: {
        open() {
          events.push("open");
        },
        data(_socket, chunk) {
          chunks.push(Buffer.from(chunk));
        },
        end() {
          events.push("end");
        },
        close() {
          events.push("close");
          closed.resolve();
        },
        connectError(_socket, error) {
          events.push(`connectError ${(error as NodeJS.ErrnoException).code}`);
          closed.resolve();
        },
      },
    });
    const peer = blockUntilPeerIsDone();
    const connect = await connecting.then(
      () => "fulfilled",
      () => "rejected",
    );
    await closed.promise;
    return { peer, connect, events, received: Buffer.concat(chunks) };
  }

  async function netConnect(unix: string) {
    const events: string[] = [];
    const chunks: Buffer[] = [];
    const closed = Promise.withResolvers<void>();
    const socket = net.connect(unix);
    socket.on("connect", () => events.push("connect"));
    socket.on("data", chunk => chunks.push(chunk));
    socket.on("end", () => events.push("end"));
    socket.on("error", (error: NodeJS.ErrnoException) => events.push(`error ${error.syscall} ${error.code}`));
    socket.on("close", () => {
      events.push("close");
      closed.resolve();
    });
    const peer = blockUntilPeerIsDone();
    await closed.promise;
    return { peer, events, received: Buffer.concat(chunks) };
  }

  async function bunTlsConnect(unix: string) {
    const events: string[] = [];
    const closed = Promise.withResolvers<void>();
    const connecting = Bun.connect({
      unix,
      tls: true,
      socket: {
        open() {
          events.push("open");
        },
        handshake(_socket, success, error) {
          events.push(`handshake ${success} ${(error as NodeJS.ErrnoException | null)?.code}`);
        },
        data() {
          events.push("data");
        },
        end() {
          events.push("end");
        },
        close() {
          events.push("close");
          closed.resolve();
        },
        connectError(_socket, error) {
          events.push(`connectError ${(error as NodeJS.ErrnoException).code}`);
          closed.resolve();
        },
      },
    });
    const peer = blockUntilPeerIsDone();
    const connect = await connecting.then(
      () => "fulfilled",
      () => "rejected",
    );
    await closed.promise;
    return { peer, connect, events };
  }

  // The peer's one write has to fit in the socket buffer, because the client does not read yet.
  // The default buffer of a unix socket is 8 KiB on macOS, so the large answer is for Linux only.
  for (const bytes of [0, 5, isLinux ? 126892 : 4096]) {
    const answer = Buffer.alloc(bytes, "x");

    it(`Bun.connect opens and reads an answer of ${bytes} bytes`, async () => {
      const { unix } = await peer(answer);
      const { received, ...rest } = await bunConnect(unix);
      expect({ ...rest, received: received.length }).toEqual({
        peer: "done",
        connect: "fulfilled",
        events: ["open", "end", "close"],
        received: bytes,
      });
      expect(received.equals(answer)).toBe(true);
    });

    it(`net.connect emits 'connect' and reads an answer of ${bytes} bytes`, async () => {
      const { unix } = await peer(answer);
      const { received, ...rest } = await netConnect(unix);
      expect({ ...rest, received: received.length }).toEqual({
        peer: "done",
        events: ["connect", "end", "close"],
        received: bytes,
      });
      expect(received.equals(answer)).toBe(true);
    });
  }

  // A TLS client opens in the same way. Its handshake then fails, because the stream ends first,
  // or because the answer is not TLS.
  // Not compared with TCP, as the Bun.SQL test below is: this client writes first, and a TCP peer
  // that has closed answers that write with a reset, which arrives before or after the FIN is read.
  for (const [bytes, code] of [
    [0, "ECONNRESET"],
    [5, "EPROTO"],
  ] as const) {
    it(`Bun.connect with tls opens, and its handshake fails on an answer of ${bytes} bytes`, async () => {
      const { unix } = await peer(Buffer.alloc(bytes, "x"));
      expect(await bunTlsConnect(unix)).toEqual({
        peer: "done",
        connect: "fulfilled",
        events: ["open", `handshake false ${code}`, "close"],
      });
    });
  }

  it("Bun.SQL (mysql) reports a full server through its socket file as it does over TCP", async () => {
    // A MySQL server at max_connections sends error 1040 as soon as it accepts, and closes.
    const tooManyConnections = mysqlRawPacket(
      0,
      Buffer.concat([Buffer.from([0xff, 1040 & 0xff, 1040 >> 8]), Buffer.from("Too many connections")]),
    );
    async function connectError(transport: "unix" | "tcp") {
      const { unix, port } = await peer(tooManyConnections, transport);
      const sql = new SQL({
        adapter: "mysql",
        username: "u",
        password: "p",
        database: "d",
        max: 1,
        ...(transport === "unix" ? { path: unix } : { hostname: "127.0.0.1", port }),
      });
      try {
        const connecting = sql.connect();
        const peer = blockUntilPeerIsDone();
        const error = await connecting.then(
          () => null,
          error => error,
        );
        return { peer, code: error?.code, errno: error?.errno };
      } finally {
        await sql.close({ timeout: 0 });
      }
    }
    // Over TCP the peer's close is a FIN, which is not a hangup: the client always reads the packet.
    const overTcp = await connectError("tcp");
    expect(overTcp).toEqual({ peer: "done", code: "ERR_MYSQL_SERVER_ERROR", errno: 1040 });
    expect(await connectError("unix")).toEqual(overTcp);
  });

  // Linux resets a connection that its listener never accepted: SO_ERROR is ECONNRESET.
  it.skipIf(!isLinux)("Bun.connect fails for a connection that the listener never accepted", async () => {
    const { unix } = await peer();
    const { received, ...rest } = await bunConnect(unix);
    expect({ ...rest, received: received.length }).toEqual({
      peer: "done",
      connect: "rejected",
      events: ["connectError ECONNRESET"],
      received: 0,
    });
  });

  it.skipIf(!isLinux)("net.connect fails for a connection that the listener never accepted", async () => {
    const { unix } = await peer();
    const { received, ...rest } = await netConnect(unix);
    expect({ ...rest, received: received.length }).toEqual({
      peer: "done",
      events: ["error connect ECONNRESET", "close"],
      received: 0,
    });
  });
});
