import { createTest } from "node-harness";
import nodefs from "node:fs";
import https from "node:https";
import { sep } from "node:path";
const { expect } = createTest(import.meta.path);

await using server = https.createServer(
  {
    key: nodefs.readFileSync(
      `${import.meta.dir}/../../../node/http/fixtures/openssl_localhost.key`.replaceAll("/", sep),
    ),
    cert: nodefs.readFileSync(
      `${import.meta.dir}/../../../node/http/fixtures/openssl_localhost.crt`.replaceAll("/", sep),
    ),
    passphrase: "123123123",
  },
  (req, res) => {
    res.write("Hello from https server");
    res.end();
  },
);
server.listen(0, "localhost");
const address = server.address();
let url_address = address.address;
const res = await fetch(`https://localhost:${address.port}`, {
  tls: {
    rejectUnauthorized: true,
    ca: nodefs.readFileSync(
      `${import.meta.dir}/../../../node/http/fixtures/openssl_localhost_ca.pem`.replaceAll("/", sep),
    ),
  },
});
const t = await res.text();
expect(t).toEqual("Hello from https server");
