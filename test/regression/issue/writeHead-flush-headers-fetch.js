// Standalone test using fetch client
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

  try {
    const res = await fetch(`http://localhost:${port}`);
    const headersReceivedTime = Date.now() - startTime;
    console.log(`Headers received after ${headersReceivedTime}ms`);

    headersFlushedImmediately = headersReceivedTime < 250;

    const body = await res.text();
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

    console.log("✓ PASS: flushHeaders() works correctly with fetch client");
    server.close();
  } catch (err) {
    console.error("Request error:", err);
    server.close();
    process.exit(1);
  }
}

runTest().catch(err => {
  console.error(err);
  process.exit(1);
});
