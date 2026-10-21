// c-ares opens a TCP socket when the UDP response has TC=1. At
// ares_open_connection() it reports (readable=1, writable=1) for that fd via
// the sock_state_cb so it learns when the nonblocking connect() completes.
// onDNSSocketState registers both directions on one FilePoll; before the fix,
// unregisterWithFd asserted !(poll_readable && poll_writable) and crashed the
// debug build, and on epoll the second register()'s CTL_MOD silently dropped
// the first direction's mask so the response was never read.
//
// The server and resolver run together in a subprocess: the assertion aborts
// the whole process, and the busy-loop on EPOLLOUT (pre-fix) would otherwise
// starve the test runner.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("clang");

test.skipIf(isWindows)("c-ares TCP DNS fd registers readable+writable on one FilePoll without asserting", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "dns-tcp-bidirectional-poll-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr.trim()).toBe("");
  expect(stdout.trim()).toBe('[["hello"]]');
  expect(exitCode).toBe(0);
});

// macOS has TCP Fast Open only through connectx(), and c-ares calls it only
// when its config defines HAVE_CONNECTX. The answer is the same with connect(),
// so the call itself is observed: a dylib inserted into the fixture prints the
// flags of each connectx() and forwards it.
test.skipIf(!isMacOS || !cc)("c-ares opens its TCP DNS connection with connectx() on macOS", async () => {
  using dir = tempDir("dns-connectx", {
    "connectx.c": /* c */ `
      #include <stdio.h>
      #include <sys/socket.h>

      static int logged_connectx(int fd, const sa_endpoints_t *endpoints, sae_associd_t associd, unsigned int flags,
                                 const struct iovec *iov, unsigned int iovcnt, size_t *len, sae_connid_t *connid) {
        dprintf(2, "connectx flags=%u\\n", flags);
        return connectx(fd, endpoints, associd, flags, iov, iovcnt, len, connid);
      }

      __attribute__((used, section("__DATA,__interpose"))) static const struct {
        const void *replacement, *original;
      } interpose[] = {{(const void *)logged_connectx, (const void *)connectx}};
    `,
  });
  {
    await using build = Bun.spawn({
      cmd: [cc!, "-dynamiclib", "-o", "connectx.dylib", "connectx.c"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "inherit",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
    if (exitCode !== 0) throw new Error(`could not compile connectx.c: ${stderr}`);
  }

  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "dns-tcp-bidirectional-poll-fixture.ts")],
    env: { ...bunEnv, DYLD_INSERT_LIBRARIES: join(String(dir), "connectx.dylib") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // 3 is CONNECT_RESUME_ON_READ_WRITE | CONNECT_DATA_IDEMPOTENT: connect at
  // the first write, and that data may go in the SYN.
  expect({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode }).toEqual({
    stdout: '[["hello"]]',
    stderr: "connectx flags=3",
    exitCode: 0,
  });
});

// A DNS answer to `query` with one TXT record "hello", framed for TCP.
function txtHelloAnswer(query: Buffer): Buffer {
  // The question ends after the root label of the name, QTYPE and QCLASS.
  let end = 12;
  while (query[end] !== 0) end += query[end] + 1;
  end += 5;

  const header = Buffer.alloc(12);
  query.copy(header, 0, 0, 2); // ID
  header[2] = 0x81; // QR, RD
  header[3] = 0x80; // RA
  header[5] = 1; // QDCOUNT
  header[7] = 1; // ANCOUNT
  // NAME (a pointer to the question name), TYPE=TXT, CLASS=IN, TTL=60, RDLENGTH=6, <5>"hello"
  const answer = Buffer.from([0xc0, 0x0c, 0, 16, 0, 1, 0, 0, 0, 60, 0, 6, 5, ...Buffer.from("hello")]);
  const message = Buffer.concat([header, query.subarray(12, end), answer]);

  const framed = Buffer.alloc(2 + message.length);
  framed.writeUInt16BE(message.length, 0);
  message.copy(framed, 2);
  return framed;
}

// With Fast Open, c-ares writes the query when it opens the socket and tells
// Bun about the socket afterwards. The fixture blocks its event loop until the
// answer is sent, so its first poll finds the socket readable and writable in
// one batch. With connect() the query waits for that poll, and this test times
// out. Only macOS: there the kernel takes the query before the handshake ends.
test.skipIf(!isMacOS)("a TCP DNS answer that waits at the first poll is delivered once", async () => {
  const { promise: answered, resolve: onAnswered } = Promise.withResolvers<void>();
  using server = Bun.listen<{ received: Buffer }>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = { received: Buffer.alloc(0) };
      },
      data(socket, chunk) {
        // DNS over TCP puts a 2-byte length in front of each message.
        const received = (socket.data.received = Buffer.concat([socket.data.received, chunk]));
        if (received.length < 2 || received.length < 2 + received.readUInt16BE(0)) return;
        socket.write(txtHelloAnswer(received.subarray(2, 2 + received.readUInt16BE(0))));
        onAnswered();
      },
    },
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "dns-tcp-answer-before-poll-fixture.ts"), `127.0.0.1:${server.port}`],
    // use-vc: c-ares sends every query over TCP.
    env: { ...bunEnv, RES_OPTIONS: "use-vc" },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  await answered;
  proc.stdin.write("\n");
  await proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode }).toEqual({
    stdout: JSON.stringify({ calls: 1, code: null, records: [["hello"]] }),
    stderr: "",
    exitCode: 0,
  });
});
