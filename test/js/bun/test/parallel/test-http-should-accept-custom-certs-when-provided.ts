import { generateTlsCertificateChain } from "harness";
import { createTest } from "node-harness";
import https from "node:https";
const { expect } = createTest(import.meta.path);

const tls = generateTlsCertificateChain({ passphrase: "123123123" });
await using server = https.createServer(
  {
    key: tls.key,
    cert: tls.cert,
    passphrase: tls.passphrase,
  },
  (req, res) => {
    res.write("Hello from https server");
    res.end();
  },
);
server.listen(0, "localhost");
const address = server.address();
const res = await fetch(`https://localhost:${address.port}`, {
  tls: {
    rejectUnauthorized: true,
    ca: tls.ca,
  },
});
const t = await res.text();
expect(t).toEqual("Hello from https server");
