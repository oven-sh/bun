import { expect, test } from "bun:test";
import http from "node:http";

test("flushHeaders after writeHead should flush response immediately (using fetch client)", async () => {
  let headersFlushedImmediately = false;
  let resolveTest: () => void;
  const testPromise = new Promise<void>(resolve => {
    resolveTest = resolve;
  });

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

  await new Promise<void>(resolve => {
    server.listen(0, () => resolve());
  });

  const port = server.address()!.port;
  const startTime = Date.now();

  // Use fetch instead of http.get to rule out client issues
  fetch(`http://localhost:${port}`)
    .then(async res => {
      const headersReceivedTime = Date.now() - startTime;
      console.log(`Headers received after ${headersReceivedTime}ms`);

      // Headers should be received almost immediately (well before the 500ms body delay)
      // Allow some tolerance but if it's > 250ms, headers weren't flushed
      headersFlushedImmediately = headersReceivedTime < 250;

      const body = await res.text();

      expect(body).toBe("Hello World");
      expect(headersFlushedImmediately).toBe(true);
      server.close();
      resolveTest();
    })
    .catch(err => {
      server.close();
      throw err;
    });

  await testPromise;
}, 10000);
