import { jscDescribe } from "bun:jsc";
import { expect, test } from "bun:test";
import http2 from "node:http2";
import type { AddressInfo } from "node:net";

// A name that repeats in one header block holds one joined value: "; " for
// cookie and ", " for the rest. The join used to copy the whole value for each
// field, so N fields of one name copied O(N^2) bytes. It is a rope now: nothing
// is copied until the value is read.
test("a header name that repeats in one block joins its values as a rope", async () => {
  const values = Array.from({ length: 300 }, (_, i) => `v${i}`);
  const server = http2.createServer({ maxHeaderListPairs: 1000 });
  let client: http2.ClientHttp2Session | undefined;
  try {
    const { promise: received, resolve: onHeaders, reject } = Promise.withResolvers<Record<string, unknown>>();
    server.on("error", reject);
    server.on("stream", (stream, headers) => {
      // The description comes first: to read the value makes it a flat string.
      const description = jscDescribe(headers["x-many"]);
      onHeaders({
        description,
        many: headers["x-many"],
        emptyInTheMiddle: headers["x-empty-in-the-middle"],
        emptyFirst: headers["x-empty-first"],
        cookie: headers.cookie,
        once: headers["x-once"],
      });
      stream.respond({ ":status": 200 });
      stream.end();
    });
    const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
    server.listen(0, () => onListening());
    await listening;
    client = http2.connect(`http://localhost:${(server.address() as AddressInfo).port}`);
    client.on("error", reject);
    const { promise: closed, resolve: onClose } = Promise.withResolvers<void>();
    const req = client.request({
      ":path": "/",
      "x-many": values,
      "x-empty-in-the-middle": ["a", "", "c"],
      "x-empty-first": ["", "b"],
      "cookie": ["a=1", "b=2", "c=3"],
      "x-once": "single",
    });
    req.on("error", reject);
    req.on("close", () => onClose());
    req.resume();
    req.end();
    const { description, ...headers } = await received;
    expect(description).toContain("(rope)");
    expect(headers).toEqual({
      many: values.join(", "),
      emptyInTheMiddle: "a, , c",
      emptyFirst: ", b",
      cookie: "a=1; b=2; c=3",
      once: "single",
    });
    await closed;
  } finally {
    client?.close();
    server.close();
  }
});
