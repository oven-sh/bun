import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import { join } from "node:path";

const skip = !fault.available() || isWindows;

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

// An injected send() errno that is neither would-block/transient
// (EAGAIN/ENOBUFS/ENOMEM) nor a known peer-gone error (EPIPE/ECONNRESET/...)
// exercises the bounded unclassified-errno retry in
// us_socket_write_check_error. EPROTOTYPE is the canonical member of that
// class: macOS returns it racily from send() on healthy sockets. The
// contract, observed broken in darwin CI wire tapes before the fix (h2
// client writes the connection preface, then never writes again - no
// SETTINGS ACK, no error, no close):
//   - a transient burst must recover through the writable rearm/retry
//     machinery with no observable hiccup, and
//   - a sustained errno must surface as session teardown, never a silent
//     half-alive jam with the bytes parked forever.
describe.skipIf(skip)("h2 client under injected unclassified send errno (EPROTOTYPE)", () => {
  afterEach(() => fault.clear());

  /** Raw TCP server speaking just enough h2: tapes every client frame as
   * "t<type><a if ACK flag>#<streamId>" and reports them via onFrame. */
  function rawH2Server(onFrame: (frame: string) => void) {
    return net.createServer(socket => {
      socket.on("error", () => {});
      let buf = Buffer.alloc(0);
      let sawPreface = false;
      socket.on("data", d => {
        buf = Buffer.concat([buf, d]);
        if (!sawPreface && buf.length >= 24) {
          buf = buf.subarray(24);
          sawPreface = true;
        }
        while (sawPreface && buf.length >= 9) {
          const len = buf.readUIntBE(0, 3);
          if (buf.length < 9 + len) break;
          const ack = buf.readUInt8(4) & 1 ? "a" : "";
          onFrame(`t${buf.readUInt8(3)}${ack}#${buf.readUInt32BE(5) & 0x7fffffff}`);
          buf = buf.subarray(9 + len);
        }
      });
      // Server SETTINGS + ACK of the client's SETTINGS, then a PING the
      // client must ACK - the ACK proves the client write path is alive
      // end-to-end after the injected failures.
      socket.write(Buffer.from([0, 0, 0, 4, 0, 0, 0, 0, 0]));
      socket.write(Buffer.from([0, 0, 0, 4, 1, 0, 0, 0, 0]));
      socket.write(Buffer.concat([Buffer.from([0, 0, 8, 6, 0, 0, 0, 0, 0]), Buffer.alloc(8, 3)]));
    });
  }

  /** Connects an http2 client and arms the send-errno rule on its socket fd
   * as soon as the session is connected (before the SETTINGS ACK window). */
  async function connectAndJam(repeat: number) {
    const frames: string[] = [];
    let onFrame: (f: string) => void = f => frames.push(f);
    const server = rawH2Server(f => onFrame(f));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
    client.on("error", () => {});
    client.on("connect", () => {
      const fd = (client.socket as any)?._handle?.fd ?? -1;
      expect(fd).toBeGreaterThanOrEqual(0);
      fault.set({ syscall: "send", action: "errno", errno: "EPROTOTYPE", after: 0, repeat, fd });
    });
    const req = client.request({ ":path": "/" });
    req.on("error", () => {});
    return {
      frames,
      setOnFrame(f: (frame: string) => void) {
        onFrame = frame => {
          frames.push(frame);
          f(frame);
        };
      },
      client,
      req,
      server,
      [Symbol.dispose]() {
        fault.clear();
        client.destroy();
        server.close();
      },
    };
  }

  test("transient burst (x8) recovers: HEADERS, SETTINGS ACK and PING ACK all reach the server", async () => {
    using h = await connectAndJam(8);
    const pingAcked = new Promise<void>((resolve, reject) => {
      h.setOnFrame(f => f === "t6a#0" && resolve());
      h.client.on("close", () => reject(new Error(`session closed before PING ACK; tape: ${h.frames.join(",")}`)));
    });
    await pingAcked;
    // type 1 = HEADERS (the request), t4a = client's SETTINGS ACK.
    expect(h.frames.some(f => f.startsWith("t1"))).toBe(true);
    expect(h.frames).toContain("t4a#0");
  });

  test("sustained errno (forever) surfaces as session + stream close, not a silent half-alive jam", async () => {
    using h = await connectAndJam(-1);
    // No timers: the bounded retry exhausts within a handful of event-loop
    // turns of writable retries, then the transport is torn down. A
    // regression to the silent jam means these events never fire and the
    // test times out. Manual listeners, not events.once(): that helper
    // rejects when 'error' fires first, and an 'error' preceding 'close' is
    // an acceptable teardown ordering here.
    await Promise.all([
      new Promise<void>(resolve => h.client.once("close", () => resolve())),
      new Promise<void>(resolve => h.req.once("close", () => resolve())),
    ]);
    expect(h.client.closed || h.client.destroyed).toBe(true);
  });
});
