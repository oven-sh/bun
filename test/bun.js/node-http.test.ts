import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { createServer, request, get, Agent, globalAgent, Server } from "node:http";
import { createDoneDotAll } from "node-test-helpers";

describe("node:http", () => {
  describe("createServer", async () => {
    it("hello world", async () => {
      const server = createServer((req, res) => {
        expect(req.url).toBe("/hello?world");
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Hello World");
      });
      server.listen(8123);

      const res = await fetch("http://localhost:8123/hello?world");
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

    it("listen should return server", async () => {
      const server = createServer();
      const listenResponse = server.listen(8129);
      expect(listenResponse instanceof Server).toBe(true);
      expect(listenResponse).toBe(server);
      listenResponse.close();
    });
  });

  describe("request", () => {
    let server;
    let serverPort;
    let timer: Timer | null = null;
    beforeAll(() => {
      server = createServer((req, res) => {
        const reqUrl = new URL(req.url!, `http://${req.headers.host}`);
        if (reqUrl.pathname) {
          if (reqUrl.pathname === "/redirect") {
            // Temporary redirect
            res.writeHead(301, {
              Location: `http://localhost:${serverPort}/redirected`,
            });
            res.end("Got redirect!\n");
            return;
          }
          if (reqUrl.pathname === "/redirected") {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
            return;
          }
          if (reqUrl.pathname.includes("timeout")) {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              res.end("Hello World");
              timer = null;
            }, 3000);
            return;
          }
          if (reqUrl.pathname === "/pathTest") {
            res.end("Path correct!\n");
            return;
          }
        }

        res.writeHead(200, { "Content-Type": "text/plain" });

        if (req.headers["x-test"]) {
          res.write(`x-test: ${req.headers["x-test"]}\n`);
        }

        // Check for body
        if (req.method === "POST") {
          req.on("data", chunk => {
            res.write(chunk);
          });

          req.on("end", () => {
            res.write("POST\n");
            res.end("Hello World");
          });
        } else {
          if (req.headers["X-Test"] !== undefined) {
            res.write(`X-Test: test\n`);
          }
          res.write("Maybe GET maybe not\n");
          res.end("Hello World");
        }
      });
      server.listen({ port: 0 }, (_, __, port) => {
        serverPort = port;
      });
    });
    afterAll(() => {
      server.close();
      if (timer) clearTimeout(timer);
    });

    it("check for expected fields", done => {
      const req = request({ host: "localhost", port: serverPort, method: "GET" }, res => {
        res.on("end", () => {
          done();
        });
        res.on("error", err => done(err));
      });
      expect(req.path).toEqual("/");
      expect(req.method).toEqual("GET");
      expect(req.host).toEqual("localhost");
      expect(req.protocol).toEqual("http:");
      req.end();
    });

    it("should make a standard GET request when passed string as first arg", done => {
      const req = request(`http://localhost:${serverPort}`, res => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", chunk => {
          data += chunk;
        });
        res.on("end", () => {
          expect(data).toBe("Maybe GET maybe not\nHello World");
          done();
        });
        res.on("error", err => done(err));
      });
      req.end();
    });

    it("should make a https:// GET request when passed string as first arg", done => {
      const req = request("https://example.com", res => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", chunk => {
          data += chunk;
        });
        res.on("end", () => {
          expect(data).toContain("This domain is for use in illustrative examples in documents");
          done();
        });
        res.on("error", err => done(err));
      });
      req.end();
    });

    it("should make a POST request when provided POST method, even without a body", done => {
      const req = request({ host: "localhost", port: serverPort, method: "POST" }, res => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", chunk => {
          data += chunk;
        });
        res.on("end", () => {
          expect(data).toBe("POST\nHello World");
          done();
        });
        res.on("error", err => done(err));
      });
      req.end();
    });

    it("should correctly handle a POST request with a body", done => {
      const req = request({ host: "localhost", port: serverPort, method: "POST" }, res => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", chunk => {
          data += chunk;
        });
        res.on("end", () => {
          expect(data).toBe("Posting\nPOST\nHello World");
          done();
        });
        res.on("error", err => done(err));
      });
      req.write("Posting\n");
      req.end();
    });

    it("should noop request.setSocketKeepAlive without error", () => {
      const req = request(`http://localhost:${serverPort}`);
      req.setSocketKeepAlive(true, 1000);
      req.end();
      expect(true).toBe(true);
    });

    it("should allow us to set timeout with request.setTimeout or `timeout` in options", done => {
      const createDone = createDoneDotAll(done);
      const req1Done = createDone();
      const req2Done = createDone();

      // const start = Date.now();
      const req1 = request(
        {
          host: "localhost",
          port: serverPort,
          path: "/timeout",
          timeout: 500,
        },
        res => {
          req1Done(new Error("Should not have received response"));
        },
      );
      req1.on("timeout", () => req1Done());

      const req2 = request(
        {
          host: "localhost",
          port: serverPort,
          path: "/timeout",
        },
        res => {
          req2Done(new Error("Should not have received response"));
        },
      );

      req2.setTimeout(500, () => {
        req2Done();
      });
      req1.end();
      req2.end();
    });

    it("should correctly set path when path provided", done => {
      const createDone = createDoneDotAll(done);
      const req1Done = createDone();
      const req2Done = createDone();

      const req1 = request(`http://localhost:${serverPort}/pathTest`, res => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", chunk => {
          data += chunk;
        });
        res.on("end", () => {
          expect(data).toBe("Path correct!\n");
          req1Done();
        });
        res.on("error", err => req1Done(err));
      });

      const req2 = request(`http://localhost:${serverPort}`, { path: "/pathTest" }, res => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", chunk => {
          data += chunk;
        });
        res.on("end", () => {
          expect(data).toBe("Path correct!\n");
          req2Done();
        });
        res.on("error", err => req2Done(err));
      });

      req1.end();
      req2.end();

      expect(req1.path).toBe("/pathTest");
      expect(req2.path).toBe("/pathTest");
    });

    it("should emit response when response received", done => {
      const req = request(`http://localhost:${serverPort}`);

      req.on("response", res => {
        expect(res.statusCode).toBe(200);
        done();
      });
      req.end();
    });

    // NOTE: Node http.request doesn't follow redirects by default
    it("should handle redirects properly", done => {
      const req = request(`http://localhost:${serverPort}/redirect`, res => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", chunk => {
          data += chunk;
        });
        res.on("end", () => {
          expect(data).toBe("Got redirect!\n");
          done();
        });
        res.on("error", err => done(err));
      });
      req.end();
    });

    it("should correctly attach headers to request", done => {
      const req = request({ host: "localhost", port: serverPort, headers: { "X-Test": "test" } }, res => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", chunk => {
          data += chunk;
        });
        res.on("end", () => {
          expect(data).toBe("x-test: test\nMaybe GET maybe not\nHello World");
          done();
        });
        res.on("error", err => done(err));
      });
      req.end();
      expect(req.getHeader("X-Test")).toBe("test");
    });

    it("should correct casing of method param", done => {
      const req = request({ host: "localhost", port: serverPort, method: "get" }, res => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", chunk => {
          data += chunk;
        });
        res.on("end", () => {
          expect(data).toBe("Maybe GET maybe not\nHello World");
          done();
        });
        res.on("error", err => done(err));
      });
      req.end();
    });

    it("should allow for port as a string", done => {
      const req = request({ host: "localhost", port: `${serverPort}`, method: "GET" }, res => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", chunk => {
          data += chunk;
        });
        res.on("end", () => {
          expect(data).toBe("Maybe GET maybe not\nHello World");
          done();
        });
        res.on("error", err => done(err));
      });
      req.end();
    });

    it("should allow us to pass a URL object", done => {
      const req = request(new URL(`http://localhost:${serverPort}`), { method: "POST" }, res => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", chunk => {
          data += chunk;
        });
        res.on("end", () => {
          expect(data).toBe("Hello WorldPOST\nHello World");
          done();
        });
        res.on("error", err => done(err));
      });
      req.write("Hello World");
      req.end();
    });

    it("should ignore body when method is GET/HEAD/OPTIONS", done => {
      const createDone = createDoneDotAll(done);
      const methods = ["GET", "HEAD", "OPTIONS"];
      const dones = {};
      for (const method of methods) {
        dones[method] = createDone();
      }
      for (const method of methods) {
        const req = request(`http://localhost:${serverPort}`, { method }, res => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", chunk => {
            data += chunk;
          });
          res.on("end", () => {
            expect(data).toBe(method === "GET" ? "Maybe GET maybe not\nHello World" : "");
            dones[method]();
          });
          res.on("error", err => dones[method](err));
        });
        req.write("BODY");
        req.end();
      }
    });
  });

  describe("signal", () => {
    it("should abort and close the server", done => {
      const server = createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Hello World");
      });

      //force timeout to not hang tests
      const interval = setTimeout(() => {
        expect(false).toBe(true);
        server.close();
        done();
      }, 100);

      const signal = AbortSignal.timeout(30);
      signal.addEventListener("abort", () => {
        clearTimeout(interval);
        expect(true).toBe(true);
        done();
      });

      server.listen({ signal, port: 8130 });
    });
  });

  describe("get", () => {
    let server;
    beforeAll(() => {
      server = createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Hello World");
      });
      server.listen(8127);
    });
    afterAll(() => {
      server.close();
    });
    it("should make a standard GET request, like request", done => {
      get("http://127.0.0.1:8127", res => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", chunk => {
          data += chunk;
        });
        res.on("end", () => {
          expect(data).toBe("Hello World");
          done();
        });
        res.on("error", err => done(err));
      });
    });
  });

  describe("Agent", () => {
    let server;
    let dummyReq;
    let dummyAgent;
    beforeAll(() => {
      dummyAgent = new Agent();
      server = createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Hello World");
      });
      server.listen(8128, () => {
        // Setup request after server is listening
        dummyReq = request(
          {
            host: "localhost",
            port: 8128,
            agent: dummyAgent,
          },
          res => {},
        );
        dummyReq.on("error", () => {});
      });
    });

    afterAll(() => {
      dummyReq.end();
      server.close();
    });

    it("should be a class", () => {
      expect(Agent instanceof Function).toBe(true);
    });

    it("should have a default maxSockets of Infinity", () => {
      expect(dummyAgent.maxSockets).toBe(Infinity);
    });

    it("should have a keepAlive value", () => {
      expect(dummyAgent.keepAlive).toBe(false);
    });

    it("should noop keepSocketAlive", () => {
      const agent = new Agent({ keepAlive: true });
      // @ts-ignore
      expect(agent.keepAlive).toBe(true);

      agent.keepSocketAlive(dummyReq.socket);
    });

    it("should provide globalAgent", () => {
      expect(globalAgent instanceof Agent).toBe(true);
    });
  });

  describe("ClientRequest.signal", () => {
    let server;
    let server_port;
    let server_host;
    beforeAll(() => {
      server = createServer((req, res) => {
        Bun.sleep(10).then(() => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("Hello World");
        });
      });
      server.listen({ port: 0 }, (_err, host, port) => {
        server_port = port;
        server_host = host;
      });
    });
    afterAll(() => {
      server.close();
    });
    it("should attempt to make a standard GET request and abort", done => {
      get(`http://127.0.0.1:${server_port}`, { signal: AbortSignal.timeout(5) }, res => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", chunk => {
          data += chunk;
        });
        res.on("end", () => {
          expect(true).toBeFalsy();
          done();
        });
        res.on("error", _ => {
          expect(true).toBeFalsy();
          done();
        });
      }).on("error", err => {
        expect(err?.name).toBe("AbortError");
        done();
      });
    });
  });
});
