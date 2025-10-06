import { createTest } from "node-harness";
import nodefs from "node:fs";
import https from "node:https";
import * as path from "node:path";
const { expect } = createTest(import.meta.path);

await using server = https.createServer(
  {
    key: nodefs.readFileSync(path.join(import.meta.dir, "../../..", "node/http/fixtures", "openssl.key")),
    cert: nodefs.readFileSync(path.join(import.meta.dir, "../../..", "node/http/fixtures", "openssl.crt")),
    passphrase: "123123123",
  },
  (req, res) => {
    res.write("Hello from https server");
    res.end();
  },
);
server.listen(0, "127.0.0.1");
const address = server.address();

try {
  let url_address = address.address;
  if (address.family === "IPv6") {
    url_address = `[${url_address}]`;
  }
  const res = await fetch(`https://${url_address}:${address.port}`, {
    tls: {
      rejectUnauthorized: true,
    },
  });
  await res.text();
  expect.unreachable();
} catch (err) {
  expect(err.code).toBe("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  expect(err.message).toBe("unable to verify the first certificate");
}
