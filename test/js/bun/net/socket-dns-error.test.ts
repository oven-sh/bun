import { expect, test } from "bun:test";

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
