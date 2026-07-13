import type { Socket } from "bun";
import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "node:path";

const skip = !fault.available() || isWindows;

afterEach(() => fault.clear());

async function bunConnectedPair(handlers: {
  serverData?: (s: Socket, chunk: Buffer) => void;
  clientData?: (s: Socket, chunk: Buffer) => void;
  clientError?: (s: Socket, err: Error) => void;
  clientClose?: (s: Socket, err?: Error) => void;
  clientDrain?: (s: Socket) => void;
}) {
  const serverSock = Promise.withResolvers<Socket>();
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(s) {
        serverSock.resolve(s);
      },
      data(s, chunk) {
        handlers.serverData?.(s, chunk as Buffer);
      },
      error() {},
      close() {},
    },
  });
  const client = await Bun.connect({
    hostname: "127.0.0.1",
    port: listener.port,
    socket: {
      open() {},
      data(s, chunk) {
        handlers.clientData?.(s, chunk as Buffer);
      },
      error(s, err) {
        handlers.clientError?.(s, err);
      },
      close(s, err) {
        handlers.clientClose?.(s, err);
      },
      drain(s) {
        handlers.clientDrain?.(s);
      },
      connectError() {},
    },
  });
  const server = await serverSock.promise;
  return {
    listener,
    client,
    server,
    [Symbol.dispose]() {
      client.end();
      server.end();
      listener.stop(true);
    },
  };
}

describe.skipIf(skip)("Bun.connect/Bun.listen under injected syscall faults", () => {
  test("recv → ECONNRESET surfaces via close(socket, error)", async () => {
    // Bun-native sockets deliver read errors as the close() error argument
    // (same contract as a real peer RST), not via the error() handler.
    const closed = Promise.withResolvers<Error | undefined>();
    using p = await bunConnectedPair({
      clientClose: (_s, err) => closed.resolve(err),
    });
    fault.set({ syscall: "recv", action: "errno", errno: "ECONNRESET", repeat: 1 });
    // Trigger a recv() on the client by writing from the server.
    p.server.write("hello");
    const err = (await closed.promise) as NodeJS.ErrnoException;
    expect(err?.code).toBe("ECONNRESET");
  });

  test("recv → 1-byte short reads still deliver the complete payload", async () => {
    const payload = Buffer.from(Array.from({ length: 256 }, (_, i) => i & 0xff));
    const chunks: Buffer[] = [];
    const done = Promise.withResolvers<void>();
    using p = await bunConnectedPair({
      clientData: (_s, chunk) => {
        chunks.push(Buffer.from(chunk));
        if (Buffer.concat(chunks).length >= payload.length) done.resolve();
      },
      clientError: (_s, err) => done.reject(err),
    });
    fault.set({ syscall: "recv", action: "short", bytes: 1, repeat: -1 });
    p.server.write(payload);
    await done.promise;
    expect(Buffer.concat(chunks).equals(payload)).toBe(true);
  });

  test("send → 16-byte short writes still deliver the complete payload to the peer", async () => {
    const payload = Buffer.alloc(512, "b");
    let received = Buffer.alloc(0);
    const done = Promise.withResolvers<void>();
    let offset = 0;
    // Bun-native sockets report partial writes; the app resumes on drain().
    const pump = (s: Socket) => {
      while (offset < payload.length) {
        const n = s.write(payload.subarray(offset));
        if (n <= 0) break;
        offset += n;
      }
    };
    using p = await bunConnectedPair({
      serverData: (_s, chunk) => {
        received = Buffer.concat([received, chunk]);
        if (received.length >= payload.length) done.resolve();
      },
      clientError: (_s, err) => done.reject(err),
      clientDrain: s => pump(s),
    });
    fault.set({ syscall: "send", action: "short", bytes: 16, repeat: -1 });
    pump(p.client);
    await done.promise;
    expect(received.equals(payload)).toBe(true);
  });

  test("connect → ECONNREFUSED rejects Bun.connect and fires connectError", async () => {
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { open() {}, data() {}, close() {} },
    });
    try {
      fault.set({ syscall: "connect", action: "errno", errno: "ECONNREFUSED", repeat: 1 });
      const connectErr = Promise.withResolvers<Error>();
      const rejection = await Bun.connect({
        hostname: "127.0.0.1",
        port: listener.port,
        socket: {
          open() {},
          data() {},
          close() {},
          connectError(_s, err) {
            connectErr.resolve(err);
          },
        },
      }).then(
        () => null,
        err => err,
      );
      expect(rejection).not.toBeNull();
      const err = (await connectErr.promise) as NodeJS.ErrnoException;
      expect(["ECONNREFUSED", "ConnectionRefused"]).toContain(err.code);
    } finally {
      listener.stop(true);
    }
  });
});

// uSockets' TLS low-priority handshake queue (loop->data.low_prio_head)
// shares its prev/next links with group->head_sockets. A socket already
// parked in the queue used to be parked a SECOND time whenever a writable
// dispatch re-enabled its readable poll bit (a backpressured handshake
// flight retry does that), running us_internal_socket_group_unlink_socket on
// low-prio-queue links and cross-wiring the two lists. In debug/ASAN builds
// the double-incremented low_prio_count trips the group-deinit assertion; in
// release builds freed sockets stay reachable from both lists
// (heap-use-after-free in us_internal_socket_group_unlink_socket /
// us_internal_handle_low_priority_sockets).
//
// The explicit timeout is required: a bare `bun bd test <file>` applies Bun's
// 5000ms default, and this fixture spawns two Bun processes and has to hold
// 32 concurrent TLS handshakes across several event-loop ticks, which takes
// ~25s on a debug+ASAN build. 180s keeps comfortable headroom over the
// CI runner's ASAN per-test budget instead of capping below it.
test.skipIf(skip)(
  "TLS low-prio queue: a parked socket whose readable poll is re-enabled is not parked twice",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "tls-low-prio-queue-fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // `stderrTail` is only populated when the fixture did not exit cleanly, so
    // the abort/assertion message shows up in the failure diff.
    expect({
      stdout: stdout.trim(),
      signalCode: proc.signalCode,
      exitCode,
      stderrTail: exitCode === 0 ? "" : stderr.slice(-2000),
    }).toEqual({ stdout: "OK", signalCode: null, exitCode: 0, stderrTail: "" });
  },
  180_000,
);
