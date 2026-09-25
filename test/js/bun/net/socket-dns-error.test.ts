import { expect, test } from "bun:test";
import { bunEnv, bunExe, isIPv6, isWindows, tls as tlsCert } from "harness";

// `Bun.connect` to a hostname that fails to resolve must surface the resolver
// error (code `ENOTFOUND`, `syscall: "getaddrinfo"`, `hostname`), matching
// `node:dns`, rather than collapsing it into `ECONNREFUSED` / `syscall:
// "connect"` as if a listener had refused the connection.
//
// These live in their own file because `socket.test.ts` is a large
// `describe.concurrent` block whose dual-stack `localhost` tests are
// environment-sensitive; the name-resolution contract needs a deterministic,
// hermetic home.

// A DNS label longer than 63 bytes is illegal (RFC 1035 section 2.3.4), so
// getaddrinfo rejects it locally without touching the network.
const UNRESOLVABLE_HOST = Buffer.alloc(64, "a").toString() + ".com";

const EXPECTED = {
  name: "Error",
  code: "ENOTFOUND",
  syscall: "getaddrinfo",
  hostname: UNRESOLVABLE_HOST,
  message: `getaddrinfo ENOTFOUND ${UNRESOLVABLE_HOST}`,
};

function pick({ name, code, syscall, hostname, message }: any) {
  return { name, code, syscall, hostname, message };
}

test("Bun.connect reports a failed hostname lookup as the resolver error, not ECONNREFUSED", async () => {
  const { promise: connectErrored, resolve: onConnectError } = Promise.withResolvers<Error>();
  let connectErrorCalls = 0;
  const promiseError: Error = await Bun.connect({
    hostname: UNRESOLVABLE_HOST,
    port: 80,
    socket: {
      open() {},
      data() {},
      connectError(_socket, error) {
        connectErrorCalls++;
        onConnectError(error as Error);
      },
    },
  }).then(
    () => Promise.reject(new Error("expected the connect promise to reject")),
    (e: Error) => e,
  );

  expect(pick(await connectErrored)).toEqual(EXPECTED);
  expect(pick(promiseError)).toEqual(EXPECTED);
  expect(connectErrorCalls).toBe(1);
});

// An IPv6 address with a prefix length, or with a shortened IPv4 part, is not
// an address. ares_inet_pton read "::1/64" as the first 64 bits of ::1, so
// Bun.connect dialed "::" and reached a listener on ::1. Brackets come off an
// IPv6 address only.
test.skipIf(!isIPv6()).each(["::1/64", "::1/0", "2001:db8::1/0", "::ffff:127.1", "[::1/64]"])(
  "Bun.connect does not dial %j",
  async hostname => {
    let accepted = 0;
    using listener = Bun.listen({
      hostname: "::1",
      port: 0,
      socket: {
        open(socket) {
          accepted++;
          socket.end();
        },
        data() {},
      },
    });
    const error: Error = await Bun.connect({
      hostname,
      port: listener.port,
      socket: { open: socket => void socket.end(), data() {} },
    }).then(
      () => new Error("connected"),
      (e: Error) => e,
    );
    expect({ ...pick(error), accepted }).toEqual({
      name: "Error",
      code: "ENOTFOUND",
      syscall: "getaddrinfo",
      hostname,
      message: `getaddrinfo ENOTFOUND ${hostname}`,
      accepted: 0,
    });
  },
);

// An IPv4 host is an address when the resolver of the platform reads all of
// it as one. getaddrinfo() reads the inet_aton shorthand. inet_aton itself
// stops at whitespace and reads what comes before. Each row here is decided
// without a lookup: the Windows resolver reads no shorthand, so those rows are
// in udp_socket.test.ts.
test.each([
  ["127.0.0.1", "connected"],
  ...(isWindows ? [] : [["127.1", "connected"] as const, ["0x7f000001", "connected"] as const]),
  ["127.0.0.1 db.allowed.example", "ENOTFOUND"],
  ["127.0.0.1\n", "ENOTFOUND"],
])("Bun.connect to %j: %s", async (hostname, expected) => {
  // On every address, so that a connection to 127.1.0.0 also arrives.
  const dialed: string[] = [];
  using listener = Bun.listen({
    hostname: "0.0.0.0",
    port: 0,
    socket: {
      open(socket) {
        dialed.push(socket.localAddress);
        socket.end();
      },
      data() {},
    },
  });
  const { promise: closed, resolve: onClose } = Promise.withResolvers<void>();
  const result = await Bun.connect({
    hostname,
    port: listener.port,
    socket: { open() {}, data() {}, close: () => onClose() },
  }).then(
    () => closed.then(() => "connected"),
    (e: any) => e.code,
  );
  expect({ result, dialed }).toEqual({ result: expected, dialed: expected === "connected" ? ["127.0.0.1"] : [] });
});

test("Bun.connect rejects the promise with the resolver error when connectError is not set", async () => {
  const error: Error = await Bun.connect({
    hostname: UNRESOLVABLE_HOST,
    port: 80,
    socket: { open() {}, data() {} },
  }).then(
    () => Promise.reject(new Error("expected the connect promise to reject")),
    (e: Error) => e,
  );
  expect(pick(error)).toEqual(EXPECTED);
});

test("a resolver error delivered to both connectError() and the promise is not released twice", async () => {
  // The resolver error owns heap-allocated strings (hostname, message). When a
  // `connectError` handler is present AND the connect promise is still pending,
  // the error is turned into a JS Error twice — once for the callback, once for
  // the rejection. Each conversion used to release the strings, so the second
  // JS Error's strings were freed while it still referenced them: a double-free
  // that surfaced as a use-after-free in the next JSString sweep.
  //
  // A subprocess so the GC that sweeps both Errors is ours to force.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const host = Buffer.alloc(64, "a").toString() + ".com";
      for (let i = 0; i < 5; i++) {
        await Bun.connect({
          hostname: host,
          port: 80,
          // Returns undefined, so the promise is rejected too.
          socket: { open() {}, data() {}, connectError() {} },
        }).then(() => { throw new Error("expected a rejection"); }, () => {});
      }
      // Sweep the Errors from both paths, destroying every JSString they hold.
      for (let i = 0; i < 10; i++) Bun.gc(true);
      console.log("ok");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: "ok\n", exitCode: 0 });
  void stderr;
});

test("consecutive Bun.connect calls to the same unresolvable hostname all get the resolver error", async () => {
  // The second attempt exercises the in-process DNS cache, which used to take
  // a different code path and report a different (also wrong) error.
  const errors = [];
  for (let i = 0; i < 3; i++) {
    errors.push(
      await Bun.connect({
        hostname: UNRESOLVABLE_HOST,
        port: 80,
        socket: { open() {}, data() {} },
      }).then(
        () => "resolved",
        (e: Error) => pick(e),
      ),
    );
  }
  expect(errors).toEqual([EXPECTED, EXPECTED, EXPECTED]);
});

// A name that cannot be a host name (a space, a colon, an empty label) is
// answered ENOTFOUND in-process, without asking the system resolver. Some DNS
// servers never answer a query for such a label, and the resolver then waits
// out its own timeout (30s on macOS) before reporting anything.
test.each(["this is not a hostname", "localhost:80", "a..b"])(
  "Bun.connect to %p, which is not a hostname, fails with ENOTFOUND without asking the resolver",
  async hostname => {
    const error = await Bun.connect({
      hostname,
      port: 80,
      socket: { open() {}, data() {} },
    }).then(
      () => "resolved",
      (e: Error) => pick(e),
    );
    expect(error).toEqual({ ...EXPECTED, hostname, message: `getaddrinfo ENOTFOUND ${hostname}` });
  },
);

// The listen side binds through a synchronous getaddrinfo, so a name the
// resolver would sit on blocks the whole thread. The same names are rejected
// before the call, with the same error the connect side reports.
test.each(["this is not a hostname", "localhost:80", "a..b"])(
  "Bun.listen on %p, which is not a hostname, throws ENOTFOUND without asking the resolver",
  hostname => {
    let error: any;
    try {
      Bun.listen({ hostname, port: 0, socket: { data() {} } }).stop(true);
    } catch (e) {
      error = e;
    }
    expect(pick(error ?? {})).toEqual({ ...EXPECTED, hostname, message: `getaddrinfo ENOTFOUND ${hostname}` });
  },
);

// An answer that is already known when Bun.connect() is called (answered
// in-process, or a cache hit) is delivered from the event loop, not inline.
// When the connect is made from the callback that delivers the previous
// answer, the loop has to be woken for it; otherwise each error waits for the
// next unrelated wakeup (about a second), and 20 of them exceed the test
// timeout.
test("back-to-back Bun.connect calls whose names are rejected in-process do not wait for a loop wakeup", async () => {
  const codes = [];
  for (let i = 0; i < 20; i++) {
    codes.push(
      await Bun.connect({
        hostname: `not a hostname ${i}`,
        port: 80,
        socket: { open() {}, data() {} },
      }).then(
        () => "resolved",
        (e: Error) => e.code,
      ),
    );
  }
  expect(codes).toEqual(Array(20).fill("ENOTFOUND"));
});

// Brackets are how a URL writes an IPv6 literal; only such a literal loses
// them. Anything else in brackets is a name the resolver gets as written, as in
// Node, and is rejected in-process without touching the network.
test("Bun.connect unwraps a bracketed IPv6 literal and nothing else", async () => {
  const outcome = (hostname: string, port: number, tls?: Bun.TLSOptions) =>
    new Promise<string | boolean>(resolve => {
      Bun.connect({
        hostname,
        port,
        tls,
        socket: {
          open(socket) {
            if (!tls) (resolve("connected"), socket.end());
          },
          handshake(socket, _success, error) {
            resolve(error ? error.message : socket.authorized);
            socket.end();
          },
          data() {},
        },
      }).catch(e => resolve(e.code + " " + e.hostname));
    });

  expect(await outcome("[example.invalid]", 80)).toBe("ENOTFOUND [example.invalid]");
  expect(await outcome("[127.0.0.1]", 80)).toBe("ENOTFOUND [127.0.0.1]");
  expect(await outcome("[]", 80)).toBe("ENOTFOUND []");
  if (!isIPv6()) return;

  using plain = Bun.listen({ hostname: "::1", port: 0, socket: { data() {} } });
  expect(await outcome("[::1]", plain.port)).toBe("connected");
  // The certificate lists IP:::1. The name it is checked against, and SNI,
  // are the bare address.
  using secure = Bun.listen({ hostname: "::1", port: 0, tls: tlsCert, socket: { data() {} } });
  expect(await outcome("[::1]", secure.port, { ca: tlsCert.cert })).toBe(true);
});
