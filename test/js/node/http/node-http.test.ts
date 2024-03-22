// @ts-nocheck
import {
  createServer,
  request,
  get,
  Agent,
  globalAgent,
  Server,
  validateHeaderName,
  validateHeaderValue,
  ServerResponse,
  IncomingMessage,
  OutgoingMessage,
} from "node:http";

import https from "node:https";
import { EventEmitter } from "node:events";
import { createServer as createHttpsServer } from "node:https";
import { createTest } from "node-harness";
import url from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import nodefs from "node:fs";
import { join as joinPath } from "node:path";
import { unlinkSync } from "node:fs";
import { PassThrough } from "node:stream";
const { describe, expect, it, beforeAll, afterAll, createDoneDotAll } = createTest(import.meta.path);

function listen(server: Server, protocol: string = "http"): Promise<URL> {
  return new Promise((resolve, reject) => {
    server.listen({ port: 0 }, (err, hostname, port) => {
      if (err) {
        reject(err);
      } else {
        resolve(new URL(`${protocol}://${hostname}:${port}`));
      }
    });
    setTimeout(() => reject("Timed out"), 5000);
  });
}

describe("node:http", () => {
  describe("createServer", async () => {
    it("hello world", async () => {
      try {
        var server = createServer((req, res) => {
          expect(req.url).toBe("/hello?world");
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("Hello World");
        });
        const url = await listen(server);
        const res = await fetch(new URL("/hello?world", url));
        expect(await res.text()).toBe("Hello World");
      } catch (e) {
        throw e;
      } finally {
        server.close();
      }
    });
    it("is not marked encrypted (#5867)", async () => {
      try {
        var server = createServer((req, res) => {
          expect(req.connection.encrypted).toBe(undefined);
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("Hello World");
        });
        const url = await listen(server);
        const res = await fetch(new URL("", url));
        expect(await res.text()).toBe("Hello World");
      } catch (e) {
        throw e;
      } finally {
        server.close();
      }
    });
    it("request & response body streaming (large)", async () => {
      try {
        const bodyBlob = new Blob(["hello world", "hello world".repeat(9000)]);
        const input = await bodyBlob.text();

        var server = createServer((req, res) => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          req.on("data", chunk => {
            res.write(chunk);
          });

          req.on("end", () => {
            res.end();
          });
        });
        const url = await listen(server);
        const res = await fetch(url, {
          method: "POST",
          body: bodyBlob,
        });

        const out = await res.text();
        expect(out).toBe(input);
      } finally {
        server.close();
      }
    });

    it("request & response body streaming (small)", async () => {
      try {
        const bodyBlob = new Blob(["hello world", "hello world".repeat(4)]);

        const input = await bodyBlob.text();

        var server = createServer((req, res) => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          req.on("data", chunk => {
            res.write(chunk);
          });

          req.on("end", () => {
            res.end();
          });
        });
        const url = await listen(server);
        const res = await fetch(url, {
          method: "POST",
          body: bodyBlob,
        });

        const out = await res.text();
        expect(out).toBe(input);
      } finally {
        server.close();
      }
    });

    it("listen should return server", async () => {
      const server = createServer();
      const listenResponse = server.listen(0);
      expect(listenResponse instanceof Server).toBe(true);
      expect(listenResponse).toBe(server);
      listenResponse.close();
    });

    it("option method should be uppercase (#7250)", async () => {
      try {
        var server = createServer((req, res) => {
          expect(req.method).toBe("OPTIONS");
          res.writeHead(204, {});
          res.end();
        });
        const url = await listen(server);
        const res = await fetch(url, {
          method: "OPTIONS",
        });
        expect(res.status).toBe(204);
      } finally {
        server.close();
      }
    });
  });

  describe("response", () => {
    test("set-cookie works with getHeader", () => {
      const res = new ServerResponse({});
      res.setHeader("Set-Cookie", ["swag=true", "yolo=true"]);
      expect(res.getHeader("Set-Cookie")).toEqual(["swag=true", "yolo=true"]);
    });
    test("set-cookie works with getHeaders", () => {
      const res = new ServerResponse({});
      res.setHeader("Set-Cookie", ["swag=true", "yolo=true"]);
      res.setHeader("test", "test");
      expect(res.getHeaders()).toEqual({
        "set-cookie": ["swag=true", "yolo=true"],
        "test": "test",
      });
    });
  });

  describe("request", () => {
    function runTest(done: Function, callback: (server: Server, port: number, done: (err?: Error) => void) => void) {
      let timer;
      const server = createServer((req, res) => {
        if (req.headers.__proto__ !== {}.__proto__) {
          throw new Error("Headers should inherit from Object.prototype");
        }
        const reqUrl = new URL(req.url!, `http://${req.headers.host}`);
        if (reqUrl.pathname) {
          if (reqUrl.pathname === "/redirect") {
            // Temporary redirect
            res.writeHead(301, {
              Location: `http://localhost:${server.port}/redirected`,
            });
            res.end("Got redirect!\n");
            return;
          }
          if (reqUrl.pathname === "/multi-chunk-response") {
            res.writeHead(200, { "Content-Type": "text/plain" });
            const toWrite = "a".repeat(512);
            for (let i = 0; i < 4; i++) {
              res.write(toWrite);
            }
            res.end();
            return;
          }
          if (reqUrl.pathname === "/multiple-set-cookie") {
            expect(req.headers.cookie).toBe("foo=bar; bar=baz");
            res.setHeader("Set-Cookie", ["foo=bar", "bar=baz"]);
            res.end("OK");
            return;
          }
          if (reqUrl.pathname === "/redirected") {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
            return;
          }
          if (reqUrl.pathname === "/lowerCaseHeaders") {
            res.writeHead(200, { "content-type": "text/plain", "X-Custom-Header": "custom_value" });
            res.end("Hello World");
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
          if (reqUrl.pathname === "/customWriteHead") {
            function createWriteHead(prevWriteHead, listener) {
              let fired = false;
              return function writeHead() {
                if (!fired) {
                  fired = true;
                  listener.call(this);
                }
                return prevWriteHead.apply(this, arguments);
              };
            }

            function addPoweredBy() {
              if (!this.getHeader("X-Powered-By")) {
                this.setHeader("X-Powered-By", "Bun");
              }
            }

            res.writeHead = createWriteHead(res.writeHead, addPoweredBy);
            res.setHeader("Content-Type", "text/plain");
            res.end("Hello World");
            return;
          }
          if (reqUrl.pathname === "/uploadFile") {
            let requestData = Buffer.alloc(0);
            req.on("data", chunk => {
              requestData = Buffer.concat([requestData, chunk]);
            });
            req.on("end", () => {
              res.writeHead(200, { "Content-Type": "text/plain" });
              res.write(requestData);
              res.end();
            });
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
        var _done = (...args) => {
          server.close();
          done(...args);
        };
        callback(server, port, _done);
      });
    }

    // it.only("check for expected fields", done => {
    //   runTest((server, port) => {
    //     const req = request({ host: "localhost", port, method: "GET" }, res => {
    //       console.log("called");
    //       res.on("end", () => {
    //         console.log("here");
    //         server.close();
    //         done();
    //       });
    //       res.on("error", err => {
    //         server.close();
    //         done(err);
    //       });
    //     });
    //     expect(req.path).toEqual("/");
    //     expect(req.method).toEqual("GET");
    //     expect(req.host).toEqual("localhost");
    //     expect(req.protocol).toEqual("http:");
    //     req.end();
    //   });
    // });

    it("should not insert extraneous accept-encoding header", async done => {
      try {
        let headers;
        var server = createServer((req, res) => {
          headers = req.headers;
          req.on("data", () => {});
          req.on("end", () => {
            res.end();
          });
        });
        const url = await listen(server);
        await fetch(url, { decompress: false });
        expect(headers["accept-encoding"]).toBeFalsy();
        done();
      } catch (e) {
        done(e);
      } finally {
        server.close();
      }
    });

    it("multiple Set-Cookie headers works #6810", done => {
      runTest(done, (server, port, done) => {
        const req = request(`http://localhost:${port}/multiple-set-cookie`, res => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", chunk => {
            data += chunk;
          });
          res.on("end", () => {
            expect(res.headers["set-cookie"]).toEqual(["foo=bar", "bar=baz"]);
            done();
          });
          res.on("error", err => done(err));
        });
        req.setHeader("Cookie", ["foo=bar; bar=baz"]);
        req.end();
      });
    });

    it("should make a standard GET request when passed string as first arg", done => {
      runTest(done, (server, port, done) => {
        const req = request(`http://localhost:${port}`, res => {
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
    });

    it("should make a https:// GET request when passed string as first arg", done => {
      const req = request("https://example.com", { headers: { "accept-encoding": "identity" } }, res => {
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
      runTest(done, (server, serverPort, done) => {
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
    });

    it("should correctly handle a POST request with a body", done => {
      runTest(done, (server, port, done) => {
        const req = request({ host: "localhost", port, method: "POST" }, res => {
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
    });

    it("should noop request.setSocketKeepAlive without error", done => {
      runTest(done, (server, port, done) => {
        const req = request(`http://localhost:${port}`);
        req.setSocketKeepAlive(true, 1000);
        req.end();
        expect(true).toBe(true);
        done();
      });
    });

    it("should allow us to set timeout with request.setTimeout or `timeout` in options", done => {
      runTest(done, (server, serverPort, done) => {
        const createDone = createDoneDotAll(done);
        const req1Done = createDone();
        const req2Done = createDone();

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
    });

    it("should correctly set path when path provided", done => {
      runTest(done, (server, serverPort, done) => {
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
    });

    it("should emit response when response received", done => {
      runTest(done, (server, serverPort, done) => {
        const req = request(`http://localhost:${serverPort}`);

        req.on("response", res => {
          expect(res.statusCode).toBe(200);
          done();
        });
        req.end();
      });
    });

    // NOTE: Node http.request doesn't follow redirects by default
    it("should handle redirects properly", done => {
      runTest(done, (server, serverPort, done) => {
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
    });

    it("should correctly attach headers to request", done => {
      runTest(done, (server, serverPort, done) => {
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
        expect(req.getHeader("X-Test")).toBe("test");
        // node returns undefined
        // Headers returns null
        expect(req.getHeader("X-Not-Exists")).toBe(undefined);
        req.end();
      });
    });

    it("should correct casing of method param", done => {
      runTest(done, (server, serverPort, done) => {
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
    });

    it("should allow for port as a string", done => {
      runTest(done, (server, serverPort, done) => {
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
    });

    it("should allow us to pass a URL object", done => {
      runTest(done, (server, serverPort, done) => {
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
    });

    it("should ignore body when method is GET/HEAD/OPTIONS", done => {
      runTest(done, (server, serverPort, done) => {
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

    it("should return response with lowercase headers", done => {
      runTest(done, (server, serverPort, done) => {
        const req = request(`http://localhost:${serverPort}/lowerCaseHeaders`, res => {
          expect(res.headers["content-type"]).toBe("text/plain");
          expect(res.headers["x-custom-header"]).toBe("custom_value");
          done();
        });
        req.end();
      });
    });

    it("reassign writeHead method, issue#3585", done => {
      runTest(done, (server, serverPort, done) => {
        const req = request(`http://localhost:${serverPort}/customWriteHead`, res => {
          expect(res.headers["content-type"]).toBe("text/plain");
          expect(res.headers["x-powered-by"]).toBe("Bun");
          done();
        });
        req.end();
      });
    });

    it("uploading file by 'formdata/multipart', issue#3116", done => {
      runTest(done, (server, serverPort, done) => {
        const boundary = "----FormBoundary" + Date.now();

        const formDataBegin = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="myfile.txt"\r\nContent-Type: application/octet-stream\r\n\r\n`;
        const fileData = Buffer.from("80818283", "hex");
        const formDataEnd = `\r\n--${boundary}--`;

        const requestOptions = {
          hostname: "localhost",
          port: serverPort,
          path: "/uploadFile",
          method: "POST",
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
          },
        };

        const req = request(requestOptions, res => {
          let responseData = Buffer.alloc(0);
          res.on("data", chunk => {
            responseData = Buffer.concat([responseData, chunk]);
          });
          res.on("end", () => {
            try {
              expect(responseData).toEqual(
                Buffer.concat([Buffer.from(formDataBegin), fileData, Buffer.from(formDataEnd)]),
              );
            } catch (e) {
              return done(e);
            }
            done();
          });
        });
        req.on("error", err => {
          done(err);
        });
        req.write(formDataBegin); // string
        req.write(fileData); // Buffer
        req.write(formDataEnd); // string
        req.end();
      });
    });

    it("request via http proxy, issue#4295", done => {
      const proxyServer = createServer(function (req, res) {
        let option = url.parse(req.url);
        option.host = req.headers.host;
        option.headers = req.headers;

        const proxyRequest = request(option, function (proxyResponse) {
          res.writeHead(proxyResponse.statusCode, proxyResponse.headers);
          proxyResponse.on("data", function (chunk) {
            res.write(chunk, "binary");
          });
          proxyResponse.on("end", function () {
            res.end();
          });
        });
        req.on("data", function (chunk) {
          proxyRequest.write(chunk, "binary");
        });
        req.on("end", function () {
          proxyRequest.end();
        });
      });

      proxyServer.listen({ port: 0 }, async (_err, hostname, port) => {
        const options = {
          protocol: "http:",
          hostname: hostname,
          port: port,
          path: "http://example.com",
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
              expect(res.statusCode).toBe(200);
              expect(data.length).toBeGreaterThan(0);
              expect(data).toContain("This domain is for use in illustrative examples in documents");
              done();
            } catch (err) {
              done(err);
            }
          });
        });
        req.on("error", err => {
          done(err);
        });
        req.end();
      });
    });

    it("should correctly stream a multi-chunk response #5320", async done => {
      runTest(done, (server, serverPort, done) => {
        const req = request({ host: "localhost", port: `${serverPort}`, path: "/multi-chunk-response", method: "GET" });

        req.on("error", err => done(err));

        req.on("response", async res => {
          const body = res.pipe(new PassThrough({ highWaterMark: 512 }));
          const response = new Response(body);
          const text = await response.text();

          expect(text.length).toBe(2048);
          done();
        });

        req.end();
      });
    });

    it("should emit a socket event when connecting", async done => {
      runTest(done, async (server, serverPort, done) => {
        const req = request(`http://localhost:${serverPort}`, {});
        await new Promise((resolve, reject) => {
          req.on("error", reject);
          req.on("socket", function onRequestSocket(socket) {
            req.destroy();
            done();
            resolve();
          });
        });
      });
    });
  });

  describe("signal", () => {
    it("should abort and close the server", done => {
      const server = createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Hello World");
      });

      const interval = setTimeout(() => {
        server.close();
        done();
      }, 100);

      const signal = AbortSignal.timeout(30);
      signal.addEventListener("abort", () => {
        clearTimeout(interval);
        expect(true).toBe(true);
        done();
      });

      server.listen({ signal, port: 0 });
    });
  });

  describe("get", () => {
    it("should make a standard GET request, like request", async done => {
      const server = createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Hello World");
      });
      const url = await listen(server);
      get(url, res => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", chunk => {
          data += chunk;
        });
        res.on("end", () => {
          expect(data).toBe("Hello World");
          server.close();
          done();
        });
        res.on("error", err => {
          server.close();
          done(err);
        });
      });
    });
  });

  describe("Agent", () => {
    let dummyAgent;
    beforeAll(() => {
      dummyAgent = new Agent();
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

      const server = createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Hello World");

        agent.keepSocketAlive(request({ host: "localhost", port: server.address().port, method: "GET" }));
        server.end();
      });
    });

    it("should provide globalAgent", () => {
      expect(globalAgent instanceof Agent).toBe(true);
    });
  });

  describe("ClientRequest.signal", () => {
    it("should attempt to make a standard GET request and abort", done => {
      let server_port;
      let server_host;

      const server = createServer((req, res) => {
        Bun.sleep(10).then(() => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("Hello World");
          server.close();
        });
      });
      server.listen({ port: 0 }, (_err, host, port) => {
        server_port = port;
        server_host = host;

        get(`http://${server_host}:${server_port}`, { signal: AbortSignal.timeout(5) }, res => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", chunk => {
            data += chunk;
          });
          res.on("end", () => {
            server.close();
            done();
          });
          res.on("error", _ => {
            server.close();
            done();
          });
        }).on("error", err => {
          expect(err?.name).toBe("AbortError");
          server.close();
          done();
        });
      });
    });
  });

  test("validateHeaderName", () => {
    validateHeaderName("Foo");
    expect(() => validateHeaderName("foo:")).toThrow();
    expect(() => validateHeaderName("foo:bar")).toThrow();
  });

  test("validateHeaderValue", () => {
    validateHeaderValue("Foo", "Bar");
    expect(() => validateHeaderValue("Foo", undefined as any)).toThrow();
    expect(() => validateHeaderValue("Foo", "Bar\r")).toThrow();
  });

  test("req.req = req", done => {
    const server = createServer((req, res) => {
      req.req = req;
      res.write(req.req === req ? "ok" : "fail");
      res.end();
    });
    server.listen({ port: 0 }, async (_err, host, port) => {
      try {
        const x = await fetch(`http://${host}:${port}`).then(res => res.text());
        expect(x).toBe("ok");
        done();
      } catch (error) {
        done(error);
      } finally {
        server.close();
      }
    });
  });

  test("test server internal error, issue#4298", done => {
    const server = createServer((req, res) => {
      throw Error("throw an error here.");
    });
    server.listen({ port: 0 }, async (_err, host, port) => {
      try {
        await fetch(`http://${host}:${port}`).then(res => {
          expect(res.status).toBe(500);
          done();
        });
      } catch (err) {
        done(err);
      } finally {
        server.close();
      }
    });
  });

  test("test unix socket server", done => {
    const socketPath = `${tmpdir()}/bun-server-${Math.random().toString(32)}.sock`;
    const server = createServer((req, res) => {
      expect(req.method).toStrictEqual("GET");
      expect(req.url).toStrictEqual("/bun?a=1");
      res.writeHead(200, {
        "Content-Type": "text/plain",
        "Connection": "close",
      });
      res.write("Bun\n");
      res.end();
    });

    test("should not decompress gzip, issue#4397", async () => {
      const { promise, resolve } = Promise.withResolvers();
      request("https://bun.sh/", { headers: { "accept-encoding": "gzip" } }, res => {
        res.on("data", function cb(chunk) {
          resolve(chunk);
          res.off("data", cb);
        });
      }).end();
      const chunk = await promise;
      expect(chunk.toString()).not.toContain("<html");
    });

    server.listen(socketPath, () => {
      // TODO: unix socket is not implemented in fetch.
      const output = spawnSync("curl", ["--unix-socket", socketPath, "http://localhost/bun?a=1"]);
      try {
        expect(output.stdout.toString()).toStrictEqual("Bun\n");
        done();
      } catch (err) {
        done(err);
      } finally {
        server.close();
      }
    });
  });

  test("should listen on port if string, issue#4582", done => {
    const server = createServer((req, res) => {
      res.end();
    });
    server.listen({ port: "0" }, async (_err, host, port) => {
      try {
        await fetch(`http://${host}:${port}`).then(res => {
          expect(res.status).toBe(200);
          done();
        });
      } catch (err) {
        done(err);
      } finally {
        server.close();
      }
    });
  });

  test("error event not fired, issue#4651", done => {
    const server = createServer((req, res) => {
      res.end();
    });
    server.listen({ port: 42069 }, () => {
      const server2 = createServer((_, res) => {
        res.end();
      });
      server2.on("error", err => {
        expect(err.code).toBe("EADDRINUSE");
        done();
      });
      server2.listen({ port: 42069 }, () => {});
    });
  });
});
describe("node https server", async () => {
  const httpsOptions = {
    key: nodefs.readFileSync(joinPath(import.meta.dir, "fixtures", "cert.key")),
    cert: nodefs.readFileSync(joinPath(import.meta.dir, "fixtures", "cert.pem")),
  };
  const createServer = onRequest => {
    return new Promise(resolve => {
      const server = createHttpsServer(httpsOptions, (req, res) => {
        onRequest(req, res);
      });
      listen(server, "https").then(url => {
        resolve({
          server,
          done: () => server.close(),
          url,
        });
      });
    });
  };
  it("is marked encrypted (#5867)", async () => {
    const { server, url, done } = await createServer(async (req, res) => {
      expect(req.connection.encrypted).toBe(true);
      res.end();
    });
    try {
      await fetch(url, { tls: { rejectUnauthorized: false } });
    } catch (e) {
      throw e;
    } finally {
      done();
    }
  });
});

describe("server.address should be valid IP", () => {
  it("should return null before listening", done => {
    const server = createServer((req, res) => {});
    try {
      expect(server.address()).toBeNull();
      done();
    } catch (err) {
      done(err);
    }
  });
  it("should return null after close", done => {
    const server = createServer((req, res) => {});
    server.listen(0, async (_err, host, port) => {
      try {
        expect(server.address()).not.toBeNull();
        server.close();
        expect(server.address()).toBeNull();
        done();
      } catch (err) {
        done(err);
      }
    });
  });
  it("test default hostname, issue#5850", done => {
    const server = createServer((req, res) => {});
    server.listen(0, async (_err, host, port) => {
      try {
        const { address, family, port } = server.address();
        expect(port).toBeInteger();
        expect(port).toBeGreaterThan(0);
        expect(port).toBeLessThan(65536);
        expect(["::", "0.0.0.0"]).toContain(address);
        if (address === "0.0.0.0") {
          expect(family).toStrictEqual("IPv4");
        } else {
          expect(family).toStrictEqual("IPv6");
        }
        done();
      } catch (err) {
        done(err);
      } finally {
        server.close();
      }
    });
  });
  it.each([["localhost"], ["127.0.0.1"]])("test %s", (hostname, done) => {
    const server = createServer((req, res) => {});
    server.listen(0, hostname, async (_err, host, port) => {
      try {
        const { address, family } = server.address();
        expect(port).toBeInteger();
        expect(port).toBeGreaterThan(0);
        expect(port).toBeLessThan(65536);
        expect(["IPv4", "IPv6"]).toContain(family);
        if (family === "IPv4") {
          expect(address).toStrictEqual("127.0.0.1");
        } else {
          expect(address).toStrictEqual("::1");
        }
        done();
      } catch (err) {
        done(err);
      } finally {
        server.close();
      }
    });
  });
  it("test unix socket, issue#6413", done => {
    const socketPath = `${tmpdir()}/bun-server-${Math.random().toString(32)}.sock`;
    const server = createServer((req, res) => {});
    server.listen(socketPath, async (_err, host, port) => {
      try {
        expect(server.address()).toStrictEqual(socketPath);
        done();
      } catch (err) {
        done(err);
      } finally {
        server.close();
        unlinkSync(socketPath);
      }
    });
  });
  test("ServerResponse init", done => {
    try {
      const req = {};
      const res = new ServerResponse(req);
      expect(res.req).toBe(req);
      done();
    } catch (err) {
      done(err);
    }
  });
  test("ServerResponse reply", done => {
    const createDone = createDoneDotAll(done);
    const doneRequest = createDone();
    try {
      const req = {};
      const sendedText = "Bun\n";
      const res = new ServerResponse(req, async (res: Response) => {
        expect(await res.text()).toBe(sendedText);
        doneRequest();
      });
      res.write(sendedText);
      res.end();
    } catch (err) {
      doneRequest(err);
    }
  });
  test("ServerResponse instanceof OutgoingMessage", () => {
    expect(new ServerResponse({}) instanceof OutgoingMessage).toBe(true);
  });
  test("ServerResponse assign assignSocket", done => {
    const createDone = createDoneDotAll(done);
    const doneRequest = createDone();
    const waitSocket = createDone();
    const doneSocket = createDone();
    try {
      const socket = new EventEmitter();
      const res = new ServerResponse({});
      res.once("socket", socket => {
        expect(socket).toBe(socket);
        waitSocket();
      });
      res.once("close", () => {
        doneRequest();
      });
      res.assignSocket(socket);
      setImmediate(() => {
        expect(res.socket).toBe(socket);
        expect(socket._httpMessage).toBe(res);
        expect(() => res.assignSocket(socket)).toThrow("ServerResponse has an already assigned socket");
        socket.emit("close");
        doneSocket();
      });
    } catch (err) {
      doneRequest(err);
    }
  });
});

it("should not accept untrusted certificates", async () => {
  const server = https.createServer(
    {
      key: nodefs.readFileSync(joinPath(import.meta.dir, "fixtures", "openssl.key")),
      cert: nodefs.readFileSync(joinPath(import.meta.dir, "fixtures", "openssl.crt")),
      passphrase: "123123123",
    },
    (req, res) => {
      res.write("Hello from https server");
      res.end();
    },
  );
  server.listen(0, "127.0.0.1");
  const address = server.address();

  try {
    let url_address = address.address;
    if (address.family === "IPv6") {
      url_address = `[${url_address}]`;
    }
    const res = await fetch(`https://${url_address}:${address.port}`, {
      tls: {
        rejectUnauthorized: true,
      },
    });
    await res.text();
    expect(true).toBe("unreacheable");
  } catch (err) {
    expect(err.code).toBe("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    expect(err.message).toBe("unable to verify the first certificate");
  }

  server.close();
});

it("IncomingMessage with a RequestLike object", () => {
  const rawHeadersMap = {
    "x-test": "test",
    "Real-Header": "test",
    "content-type": "text/plain",
    "User-Agent": "Bun",
  };

  // To excercise the case where inline capacity cannot be used
  for (let i = 0; i < 64; i++) {
    rawHeadersMap[`header-${i}`] = `value-${i}`;
  }

  const headers = new Headers(rawHeadersMap);
  headers.append("set-cookie", "foo=bar");
  headers.append("set-cookie", "bar=baz");

  const request = new Request("https://example.com/hello/hi", {
    headers,
  });

  const incomingMessageFromRequest = new IncomingMessage(request);
  const incomingMessageFromRequestLike1 = new IncomingMessage({
    url: "/hello/hi",
    headers: headers,
    method: request.method,
  });
  const incomingMessageFromRequestLike2 = new IncomingMessage({
    url: "/hello/hi",
    headers: headers.toJSON(),
    method: request.method,
  });
  for (let incomingMessageFromRequestLike of [
    incomingMessageFromRequestLike1,
    incomingMessageFromRequestLike2,
    incomingMessageFromRequest,
  ]) {
    expect(incomingMessageFromRequestLike.headers).toEqual(incomingMessageFromRequest.headers);
    expect(incomingMessageFromRequestLike.method).toEqual(incomingMessageFromRequest.method);
    expect(incomingMessageFromRequestLike.url).toEqual(incomingMessageFromRequest.url);
    expect(incomingMessageFromRequestLike.headers).toEqual({
      "x-test": "test",
      "real-header": "test",
      "content-type": "text/plain",
      "user-agent": "Bun",
      "set-cookie": ["foo=bar", "bar=baz"],
      "header-0": "value-0",
      "header-1": "value-1",
      "header-10": "value-10",
      "header-11": "value-11",
      "header-12": "value-12",
      "header-13": "value-13",
      "header-14": "value-14",
      "header-15": "value-15",
      "header-16": "value-16",
      "header-17": "value-17",
      "header-18": "value-18",
      "header-19": "value-19",
      "header-2": "value-2",
      "header-20": "value-20",
      "header-21": "value-21",
      "header-22": "value-22",
      "header-23": "value-23",
      "header-24": "value-24",
      "header-25": "value-25",
      "header-26": "value-26",
      "header-27": "value-27",
      "header-28": "value-28",
      "header-29": "value-29",
      "header-3": "value-3",
      "header-30": "value-30",
      "header-31": "value-31",
      "header-32": "value-32",
      "header-33": "value-33",
      "header-34": "value-34",
      "header-35": "value-35",
      "header-36": "value-36",
      "header-37": "value-37",
      "header-38": "value-38",
      "header-39": "value-39",
      "header-4": "value-4",
      "header-40": "value-40",
      "header-41": "value-41",
      "header-42": "value-42",
      "header-43": "value-43",
      "header-44": "value-44",
      "header-45": "value-45",
      "header-46": "value-46",
      "header-47": "value-47",
      "header-48": "value-48",
      "header-49": "value-49",
      "header-5": "value-5",
      "header-50": "value-50",
      "header-51": "value-51",
      "header-52": "value-52",
      "header-53": "value-53",
      "header-54": "value-54",
      "header-55": "value-55",
      "header-56": "value-56",
      "header-57": "value-57",
      "header-58": "value-58",
      "header-59": "value-59",
      "header-6": "value-6",
      "header-60": "value-60",
      "header-61": "value-61",
      "header-62": "value-62",
      "header-63": "value-63",
      "header-7": "value-7",
      "header-8": "value-8",
      "header-9": "value-9",
    });
  }

  // this one preserves the original case
  expect(incomingMessageFromRequestLike1.rawHeaders).toEqual([
    "content-type",
    "text/plain",
    "user-agent",
    "Bun",
    "set-cookie",
    "foo=bar",
    "set-cookie",
    "bar=baz",
    "x-test",
    "test",
    "Real-Header",
    "test",
    "header-0",
    "value-0",
    "header-1",
    "value-1",
    "header-2",
    "value-2",
    "header-3",
    "value-3",
    "header-4",
    "value-4",
    "header-5",
    "value-5",
    "header-6",
    "value-6",
    "header-7",
    "value-7",
    "header-8",
    "value-8",
    "header-9",
    "value-9",
    "header-10",
    "value-10",
    "header-11",
    "value-11",
    "header-12",
    "value-12",
    "header-13",
    "value-13",
    "header-14",
    "value-14",
    "header-15",
    "value-15",
    "header-16",
    "value-16",
    "header-17",
    "value-17",
    "header-18",
    "value-18",
    "header-19",
    "value-19",
    "header-20",
    "value-20",
    "header-21",
    "value-21",
    "header-22",
    "value-22",
    "header-23",
    "value-23",
    "header-24",
    "value-24",
    "header-25",
    "value-25",
    "header-26",
    "value-26",
    "header-27",
    "value-27",
    "header-28",
    "value-28",
    "header-29",
    "value-29",
    "header-30",
    "value-30",
    "header-31",
    "value-31",
    "header-32",
    "value-32",
    "header-33",
    "value-33",
    "header-34",
    "value-34",
    "header-35",
    "value-35",
    "header-36",
    "value-36",
    "header-37",
    "value-37",
    "header-38",
    "value-38",
    "header-39",
    "value-39",
    "header-40",
    "value-40",
    "header-41",
    "value-41",
    "header-42",
    "value-42",
    "header-43",
    "value-43",
    "header-44",
    "value-44",
    "header-45",
    "value-45",
    "header-46",
    "value-46",
    "header-47",
    "value-47",
    "header-48",
    "value-48",
    "header-49",
    "value-49",
    "header-50",
    "value-50",
    "header-51",
    "value-51",
    "header-52",
    "value-52",
    "header-53",
    "value-53",
    "header-54",
    "value-54",
    "header-55",
    "value-55",
    "header-56",
    "value-56",
    "header-57",
    "value-57",
    "header-58",
    "value-58",
    "header-59",
    "value-59",
    "header-60",
    "value-60",
    "header-61",
    "value-61",
    "header-62",
    "value-62",
    "header-63",
    "value-63",
  ]);

  // this one does not preserve the original case
  expect(incomingMessageFromRequestLike2.rawHeaders).toEqual([
    "content-type",
    "text/plain",
    "user-agent",
    "Bun",
    "set-cookie",
    "foo=bar",
    "set-cookie",
    "bar=baz",
    "x-test",
    "test",
    "real-header",
    "test",
    "header-0",
    "value-0",
    "header-1",
    "value-1",
    "header-2",
    "value-2",
    "header-3",
    "value-3",
    "header-4",
    "value-4",
    "header-5",
    "value-5",
    "header-6",
    "value-6",
    "header-7",
    "value-7",
    "header-8",
    "value-8",
    "header-9",
    "value-9",
    "header-10",
    "value-10",
    "header-11",
    "value-11",
    "header-12",
    "value-12",
    "header-13",
    "value-13",
    "header-14",
    "value-14",
    "header-15",
    "value-15",
    "header-16",
    "value-16",
    "header-17",
    "value-17",
    "header-18",
    "value-18",
    "header-19",
    "value-19",
    "header-20",
    "value-20",
    "header-21",
    "value-21",
    "header-22",
    "value-22",
    "header-23",
    "value-23",
    "header-24",
    "value-24",
    "header-25",
    "value-25",
    "header-26",
    "value-26",
    "header-27",
    "value-27",
    "header-28",
    "value-28",
    "header-29",
    "value-29",
    "header-30",
    "value-30",
    "header-31",
    "value-31",
    "header-32",
    "value-32",
    "header-33",
    "value-33",
    "header-34",
    "value-34",
    "header-35",
    "value-35",
    "header-36",
    "value-36",
    "header-37",
    "value-37",
    "header-38",
    "value-38",
    "header-39",
    "value-39",
    "header-40",
    "value-40",
    "header-41",
    "value-41",
    "header-42",
    "value-42",
    "header-43",
    "value-43",
    "header-44",
    "value-44",
    "header-45",
    "value-45",
    "header-46",
    "value-46",
    "header-47",
    "value-47",
    "header-48",
    "value-48",
    "header-49",
    "value-49",
    "header-50",
    "value-50",
    "header-51",
    "value-51",
    "header-52",
    "value-52",
    "header-53",
    "value-53",
    "header-54",
    "value-54",
    "header-55",
    "value-55",
    "header-56",
    "value-56",
    "header-57",
    "value-57",
    "header-58",
    "value-58",
    "header-59",
    "value-59",
    "header-60",
    "value-60",
    "header-61",
    "value-61",
    "header-62",
    "value-62",
    "header-63",
    "value-63",
  ]);
});

it("#6892", () => {
  const totallyValid = ["*", "/", "/foo", "/foo/bar"];
  for (const url of totallyValid) {
    const req = new IncomingMessage({ url });
    expect(req.url).toBe(url);
    expect(req.method).toBeNull();
  }
});

it("#4415.1 ServerResponse es6", () => {
  class Response extends ServerResponse {
    constructor(req) {
      super(req);
    }
  }
  const req = {};
  const res = new Response(req);
  expect(res.req).toBe(req);
});

it("#4415.2 ServerResponse es5", () => {
  function Response(req) {
    ServerResponse.call(this, req);
  }
  Response.prototype = Object.create(ServerResponse.prototype);
  const req = {};
  const res = new Response(req);
  expect(res.req).toBe(req);
});

it("#4415.3 Server es5", done => {
  const server = Server((req, res) => {
    res.end();
  });
  server.listen(0, async (_err, host, port) => {
    try {
      const res = await fetch(`http://localhost:${port}`);
      expect(res.status).toBe(200);
      done();
    } catch (err) {
      done(err);
    } finally {
      server.close();
    }
  });
});

it("#4415.4 IncomingMessage es5", () => {
  const im = Object.create(IncomingMessage.prototype);
  IncomingMessage.call(im, { url: "/foo" });
  expect(im.url).toBe("/foo");
});

it("#9242.1 Server has constructor", () => {
  const s = new Server();
  expect(s.constructor).toBe(Server);
});
it("#9242.2 IncomingMessage has constructor", () => {
  const im = new IncomingMessage("http://localhost");
  expect(im.constructor).toBe(IncomingMessage);
});
it("#9242.3 OutgoingMessage has constructor", () => {
  const om = new OutgoingMessage();
  expect(om.constructor).toBe(OutgoingMessage);
});
it("#9242.4 ServerResponse has constructor", () => {
  const sr = new ServerResponse({});
  expect(sr.constructor).toBe(ServerResponse);
});

// Windows doesnt support SIGUSR1
if (process.platform !== "win32") {
  // By not timing out, this test passes.
  test(".unref() works", async () => {
    expect([joinPath(import.meta.dir, "node-http-ref-fixture.js")]).toRun();
  });
}
