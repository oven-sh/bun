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

try {
  const res = await fetch(`https://localhost:${address.port}`, {
    tls: {
      rejectUnauthorized: true,
      ca: "some invalid value for a ca",
    },
  });
  await res.text();
  expect(true).toBe("unreacheable");
} catch (err) {
  expect(err.code).toBe("FailedToOpenSocket");
  expect(err.message).toBe("Was there a typo in the url or port?");
}
