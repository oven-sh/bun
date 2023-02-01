import { describe, expect, it } from "bun:test";
import { createServer } from "node:http";

describe("node:http", () => {
  describe("createServer", async () => {
    it("hello world", async () => {
      const server = createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Hello World");
      });
      server.listen(8123);

      const res = await fetch("http://localhost:8123");
      expect(await res.text()).toBe("Hello World");
      server.close();
    });

    it("request & response body streaming (large)", async () => {
      const bodyBlob = new Blob(["hello world", "hello world".repeat(9000)]);

      const input = await bodyBlob.text();

      const server = createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        req.on("data", chunk => {
          res.write(chunk);
        });

        req.on("end", () => {
          res.end();
        });
      });
      server.listen(8124);

      const res = await fetch("http://localhost:8124", {
        method: "POST",
        body: bodyBlob,
      });

      const out = await res.text();
      expect(out).toBe(input);
      server.close();
    });

    it("request & response body streaming (small)", async () => {
      const bodyBlob = new Blob(["hello world", "hello world".repeat(4)]);

      const input = await bodyBlob.text();

      const server = createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        req.on("data", chunk => {
          res.write(chunk);
        });

        req.on("end", () => {
          res.end();
        });
      });
      server.listen(8125);

      const res = await fetch("http://localhost:8125", {
        method: "POST",
        body: bodyBlob,
      });

      const out = await res.text();
      expect(out).toBe(input);
      server.close();
    });
  });
});
