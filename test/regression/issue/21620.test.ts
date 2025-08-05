/**
 * Regression test for issue #21620 - Multiple data writes on outgoing http/https request cause the connection to hang
 * @see https://github.com/oven-sh/bun/issues/21620
 */
import { test, expect } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";

const COMMON_TLS_CERT = {
  cert: `-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJAKKkAbUUoCAuMA0GCSqGSIb3DQEBCwUAMBQxEjAQBgNVBAMMCWxv
Y2FsaG9zdDAeFw0yMzA4MDkxODU4NTlaFw0yNDA4MDgxODU4NTlaMBQxEjAQBgNV
BAMMCWxvY2FsaG9zdDBcMA0GCSqGSIb3DQEBAQUAA0sAMEgCQQC7Ut9X5Hs3o/d3
RQznTaEEvw1tZnDww4RJRgkAPsK6HoAo+SxsPrCRQ1M/3S7Sc7YNjkOT6K/OP9lk
yVxRcN29AgMBAAEwDQYJKoZIhvcNAQELBQADQQBAFqJMRdVFNWYMnSRj8xXYYvHI
KV5yqSYhcmPF6BvFzWUPJlxbhZZU4I3KWqkT2qKrOyKwlsrpVECNxTUmjJX8
-----END CERTIFICATE-----`,
  key: `-----BEGIN RSA PRIVATE KEY-----
MIIBOwIBAAJBALtS31fkezej93dFDOdNoQS/DW1mcPDDhElGCQA+wroegCj5LGw+
sJFDUz/dLtJztg2OQ5Por84/2WTJXFFw3b0CAwEAAQJBAK5cXmHfCaYJTwJKpqHi
NZIb4HOw3l8JLT6V8lJoJjkUyQeRfHRoqMTBNV7HGVr8HXeJF6mHYVzXhh7CKKBn
lCECIQDcOTGFE7gU6zW8bV2b1JzG1Hv5jJiO2xON9U3qxnKNZwIhAOKGOLQcHrOO
hGdJWp5YTJD5K3vxrW6HzfN/Lr8yTpGVAiEA4mD8YjQxuCJ3yDY1zR5U2n7rE5ON
LYZa5GGl9g5w6YMCIQDH4U+7K3mw7yV3U6gHfLaV0+6nOW9l1lCY2vXzjUr5HQIg
YMU+J1Y5SBo9PHLLqJQ9E3mH2LZU7q9Z9lkJdA+6TnE=
-----END RSA PRIVATE KEY-----`
};

test("multiple http request writes should not hang (issue #21620)", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  let responseReceived = false;
  
  await using server = http.createServer((req, res) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk.toString();
    });
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ receivedBody: body }));
    });
  });

  server.listen(0);
  await once(server, "listening");
  const address = server.address() as AddressInfo;

  const jsonStr = JSON.stringify({ key: "val", key2: 200 });
  
  const req = http.request(
    {
      hostname: "localhost",
      port: address.port,
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
    },
    (res) => {
      let data = "";
      res.on("data", chunk => {
        data += chunk.toString();
      });
      res.on("end", () => {
        try {
          const response = JSON.parse(data);
          expect(response.receivedBody).toBe(jsonStr);
          responseReceived = true;
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    }
  );

  req.on("error", reject);

  // Add timeout to prevent hanging - the issue was that this would timeout
  const timeout = setTimeout(() => {
    if (!responseReceived) {
      req.destroy();
      reject(new Error("Request timed out - indicates the hanging bug is present"));
    }
  }, 2000);

  // Multiple writes should not cause hanging
  req.write(jsonStr.slice(0, 10));
  
  // Add small delay between writes to trigger the race condition
  setTimeout(() => {
    req.write(jsonStr.slice(10));
    req.end();
  }, 50);

  try {
    await promise;
    clearTimeout(timeout);
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
});

test("multiple https request writes should not hang (issue #21620)", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  let responseReceived = false;
  
  await using server = https.createServer(COMMON_TLS_CERT, (req, res) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk.toString();
    });
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ receivedBody: body }));
    });
  });

  server.listen(0);
  await once(server, "listening");
  const address = server.address() as AddressInfo;

  const jsonStr = JSON.stringify({ key: "val", key2: 200 });
  
  const req = https.request(
    {
      hostname: "localhost",
      port: address.port,
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      rejectUnauthorized: false, // For test cert
    },
    (res) => {
      let data = "";
      res.on("data", chunk => {
        data += chunk.toString();
      });
      res.on("end", () => {
        try {
          const response = JSON.parse(data);
          expect(response.receivedBody).toBe(jsonStr);
          responseReceived = true;
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    }
  );

  req.on("error", reject);

  // Add timeout to prevent hanging 
  const timeout = setTimeout(() => {
    if (!responseReceived) {
      req.destroy();
      reject(new Error("HTTPS request timed out - indicates the hanging bug is present"));
    }
  }, 2000);

  // Multiple writes should not cause hanging
  req.write(jsonStr.slice(0, 10));
  
  // Add small delay between writes to trigger the race condition
  setTimeout(() => {
    req.write(jsonStr.slice(10));
    req.end();
  }, 50);

  try {
    await promise;
    clearTimeout(timeout);
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
});