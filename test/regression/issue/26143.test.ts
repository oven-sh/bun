import { describe, expect, test } from "bun:test";

describe("issue #26143 - https GET request with body hangs", () => {
  test("http.request GET with body should complete", async () => {
    const http = require("http");

    // Use Node.js-style http.createServer which properly handles bodies on all methods
    const server = http.createServer((req: any, res: any) => {
      let body = "";
      req.on("data", (chunk: string) => {
        body += chunk;
      });
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: body }));
      });
    });

    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const result = await new Promise<{ status: number; data: string }>((resolve, reject) => {
        const options = {
          hostname: "localhost",
          port,
          path: "/test",
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": 2,
          },
        };

        const req = http.request(options, (res: any) => {
          let data = "";
          res.on("data", (chunk: string) => {
            data += chunk;
          });
          res.on("end", () => {
            resolve({ status: res.statusCode, data });
          });
        });

        req.on("error", reject);
        req.write("{}");
        req.end();
      });

      expect(result.status).toBe(200);
      expect(result.data).toContain('"received":"{}"');
    } finally {
      server.close();
    }
  });

  test("GET request without body should still work", async () => {
    const http = require("http");

    const server = http.createServer((req: any, res: any) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ method: req.method }));
    });

    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const result = await new Promise<{ status: number; data: string }>((resolve, reject) => {
        const options = {
          hostname: "localhost",
          port,
          path: "/test",
          method: "GET",
        };

        const req = http.request(options, (res: any) => {
          let data = "";
          res.on("data", (chunk: string) => {
            data += chunk;
          });
          res.on("end", () => {
            resolve({ status: res.statusCode, data });
          });
        });

        req.on("error", reject);
        req.end();
      });

      expect(result.status).toBe(200);
      expect(result.data).toContain('"method":"GET"');
    } finally {
      server.close();
    }
  });

  test("HEAD request with body should complete", async () => {
    const http = require("http");

    const server = http.createServer((req: any, res: any) => {
      let body = "";
      req.on("data", (chunk: string) => {
        body += chunk;
      });
      req.on("end", () => {
        res.writeHead(200, { "X-Custom": "header", "X-Body-Received": body });
        res.end();
      });
    });

    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const result = await new Promise<{ status: number; header: string | undefined }>((resolve, reject) => {
        const options = {
          hostname: "localhost",
          port,
          path: "/test",
          method: "HEAD",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": 2,
          },
        };

        const req = http.request(options, (res: any) => {
          res.on("data", () => {});
          res.on("end", () => {
            resolve({ status: res.statusCode, header: res.headers["x-custom"] });
          });
        });

        req.on("error", reject);
        req.write("{}");
        req.end();
      });

      expect(result.status).toBe(200);
      expect(result.header).toBe("header");
    } finally {
      server.close();
    }
  });

  test("Bun.fetch without allowGetBody should still throw", async () => {
    const http = require("http");

    const server = http.createServer((req: any, res: any) => {
      res.writeHead(200);
      res.end();
    });

    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = server.address().port;

    try {
      // Without allowGetBody, this should throw
      expect(async () => {
        await fetch(`http://localhost:${port}/test`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": "2",
          },
          body: "{}",
        });
      }).toThrow("fetch() request with GET/HEAD/OPTIONS method cannot have body.");
    } finally {
      server.close();
    }
  });
});
