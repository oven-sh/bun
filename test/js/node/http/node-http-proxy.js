import assert from "node:assert";
import { createServer, request } from "node:http";
import url from "node:url";

export async function run() {
  const { promise, resolve, reject } = Promise.withResolvers();

  const proxyServer = createServer(function (req, res) {
    // Use URL object instead of deprecated url.parse
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

    const options = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: req.method,
      headers: req.headers,
    };

    const proxyRequest = request(options, function (proxyResponse) {
      res.writeHead(proxyResponse.statusCode, proxyResponse.headers);
      proxyResponse.pipe(res); // Use pipe instead of manual data handling
    });

    proxyRequest.on("error", error => {
      console.error("Proxy Request Error:", error);
      res.writeHead(500);
      res.end("Proxy Error");
    });

    req.pipe(proxyRequest); // Use pipe instead of manual data handling
  });

  proxyServer.listen(0, "localhost", async () => {
    const address = proxyServer.address();

    const options = {
      protocol: "http:",
      hostname: "localhost",
      port: address.port,
      path: "/", // Change path to /
      headers: {
        Host: "example.com",
        "accept-encoding": "identity",
      },
    };

    const req = request(options, res => {
      let data = "";
      res.on("data", chunk => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          assert.strictEqual(res.statusCode, 200);
          assert(data.length > 0);
          assert(data.includes("This domain is for use in illustrative examples in documents"));
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on("error", err => {
      reject(err);
    });

    req.end();
  });

  await promise;
  proxyServer.close();
}

if (import.meta.main) {
  run().catch(console.error);
}
