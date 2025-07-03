import { describe, expect, test } from "bun:test";
import { createServer } from "http";

describe("HTTP numeric headers", () => {
  test("should handle numeric header names", async () => {
    const server = createServer((req, res) => {
      // Get the custom header value
      expect(req.headers["1234"]).toBe("Hello from client!");
      expect("1234" in req.headers).toBe(true);
      expect(req.headers[1234]).toBe("Hello from client!");

      const customHeader = req.headers["1234"];

      // Send response with the header value
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(`Received header value: ${customHeader}`);
    });

    // Start server on random port
    const port = await new Promise<number>(resolve => {
      server.listen(0, () => {
        const address = server.address();
        if (address && typeof address === "object") {
          resolve(address.port);
        }
      });
    });

    // Make fetch request to the server
    const response = await fetch(`http://localhost:${port}/`, {
      headers: {
        "1234": "Hello from client!",
      },
    });

    const data = await response.text();
    expect(data).toBe("Received header value: Hello from client!");

    server.close();
  });
});
