import { expect, it } from "bun:test";
import http from "node:http";

// https://github.com/oven-sh/bun/issues/31474
// A refused connection must surface the full Node.js error shape
// (errno/syscall/address/port and a `connect ECONNREFUSED <host>:<port>`
// message), not a bare `Error: ECONNREFUSED`.
//
// Connect to a fixed port that nothing listens on (rather than bind-then-close)
// so the connection is refused immediately and deterministically on every
// platform — a just-closed port can linger in TIME_WAIT on Windows and produce
// a different error. The ports are below the ephemeral range (32768+) so a
// concurrent listen(0) can't be assigned one of them and turn the refusal into
// a connect.
const REFUSED_PORT_A = 18_321;
const REFUSED_PORT_B = 18_322;
const REFUSED_PORT_C = 18_323;

it("request to a refused port reports a Node-shaped ECONNREFUSED", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<NodeJS.ErrnoException>();
  const req = http.request(
    { hostname: "127.0.0.1", port: REFUSED_PORT_A, path: "/", method: "GET", timeout: 5000 },
    () => reject(new Error("Expected request to fail")),
  );
  req.on("error", resolve);
  req.end();

  const error = await promise;
  expect(error.code).toBe("ECONNREFUSED");
  // uv errno is negative; its exact value differs by platform, so just assert
  // it is present and numeric (the pre-fix bare error had no errno at all).
  expect(typeof error.errno).toBe("number");
  expect(error.errno).toBeLessThan(0);
  expect(error.syscall).toBe("connect");
  expect(error.address).toBe("127.0.0.1");
  expect(error.port).toBe(REFUSED_PORT_A);
  expect(error.message).toBe(`connect ECONNREFUSED 127.0.0.1:${REFUSED_PORT_A}`);
});

it("reports error.port as a number even when options.port is a string", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<NodeJS.ErrnoException>();
  // Pass the port as a string — Node normalizes error.port to a number.
  const req = http.request(
    { hostname: "127.0.0.1", port: String(REFUSED_PORT_B), path: "/", method: "GET", timeout: 5000 },
    () => reject(new Error("Expected request to fail")),
  );
  req.on("error", resolve);
  req.end();

  const error = await promise;
  expect(error.code).toBe("ECONNREFUSED");
  expect(error.port).toBe(REFUSED_PORT_B);
  expect(typeof error.port).toBe("number");
  expect(error.message).toBe(`connect ECONNREFUSED 127.0.0.1:${REFUSED_PORT_B}`);
});

it("emits a single Node-shaped 'error' on the custom-lookup path", async () => {
  const errors: NodeJS.ErrnoException[] = [];
  const { promise, resolve } = Promise.withResolvers<void>();
  const req = http.request({
    host: "refused.invalid",
    port: REFUSED_PORT_C,
    path: "/",
    method: "GET",
    timeout: 5000,
    // A custom lookup routes through the iterate()/happy-eyeballs path. When
    // the (only, last) candidate is refused, exactly one 'error' must fire.
    lookup: (_host, _opts, cb) => cb(null, [{ address: "127.0.0.1", family: 4 }] as any),
  });
  req.on("error", err => {
    errors.push(err);
    // Give any erroneous second emission a chance to arrive before resolving.
    setImmediate(resolve);
  });
  req.end();

  await promise;
  expect(errors.length).toBe(1);
  const error = errors[0];
  expect(error.code).toBe("ECONNREFUSED");
  expect(error.syscall).toBe("connect");
  expect(error.address).toBe("127.0.0.1");
  expect(error.port).toBe(REFUSED_PORT_C);
  expect(error.message).toBe(`connect ECONNREFUSED 127.0.0.1:${REFUSED_PORT_C}`);
});
