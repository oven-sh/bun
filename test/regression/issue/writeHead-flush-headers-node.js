// Standalone test that works in both Node.js and Bun
const http = require("node:http");

async function runTest() {
  let headersFlushedImmediately = false;

  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });

    // This should flush the headers immediately, not wait for body
    res.flushHeaders();

    // Delay before sending body to verify headers were flushed
    setTimeout(() => {
      res.write("Hello ");
      res.end("World");
    }, 500);
  });

  await new Promise(resolve => {
    server.listen(0, () => resolve());
  });

  const port = server.address().port;
  const startTime = Date.now();

  await new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${port}`, res => {
      const headersReceivedTime = Date.now() - startTime;
      console.log(`Headers received after ${headersReceivedTime}ms`);

      // Headers should be received almost immediately (well before the 500ms body delay)
      // Allow some tolerance but if it's > 250ms, headers weren't flushed
      headersFlushedImmediately = headersReceivedTime < 250;

      let body = "";
      res.on("data", chunk => {
        body += chunk;
      });

      res.on("end", () => {
        console.log(`Body: "${body}"`);

        if (body !== "Hello World") {
          console.error(`✗ FAIL: Expected body "Hello World", got "${body}"`);
          server.close();
          process.exit(1);
        }

        if (!headersFlushedImmediately) {
          console.error(`✗ FAIL: Headers were not flushed immediately (took ${headersReceivedTime}ms)`);
          server.close();
          process.exit(1);
        }

        console.log("✓ PASS: flushHeaders() works correctly");
        server.close();
        resolve();
      });
    });

    req.on("error", err => {
      console.error("Request error:", err);
      server.close();
      reject(err);
    });
  });
}

runTest().catch(err => {
  console.error(err);
  process.exit(1);
});
