import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

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
