import { createTest } from "node-harness";
import nodefs from "node:fs";
import https from "node:https";
import * as path from "node:path";
const { expect } = createTest(import.meta.path);

await using server = https.createServer(
  {
    key: nodefs.readFileSync(path.join(import.meta.dir, "../../..", "node/http/fixtures", "openssl_localhost.key")),
    cert: nodefs.readFileSync(path.join(import.meta.dir, "../../..", "node/http/fixtures", "openssl_localhost.crt")),
    passphrase: "123123123",
  },
  (req, res) => {
    res.write("Hello from https server");
    res.end();
  },
);
server.listen(0, "localhost");
const address = server.address();

try {
  let url_address = address.address;
  const res = await fetch(`https://localhost:${address.port}`, {
    tls: {
      rejectUnauthorized: true,
      ca: "some invalid value for a ca",
    },
  });
  await res.text();
  expect(true).toBe("unreacheable");
} catch (err) {
  // fetch errors are now TypeError with "fetch failed" message and .cause (Node.js compat)
  expect(err).toBeInstanceOf(TypeError);
  expect(err.message).toBe("fetch failed");
  expect(err.code).toBe("FailedToOpenSocket");
  expect(err.cause).toBeDefined();
  expect(err.cause.code).toBe("FailedToOpenSocket");
  expect(err.cause.message).toBe("Was there a typo in the url or port?");
}
