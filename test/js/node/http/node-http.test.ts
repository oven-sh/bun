/**
 * All new tests in this file should also run in Node.js.
 *
 * Do not add any tests that only run in Bun.
 *
 * A handful of older tests do not run in Node in this file. These tests should be updated to run in Node, or deleted.
 */
import { bunEnv, bunExe, exampleSite, randomPort, tls as tlsCert } from "harness";
import { createTest } from "node-harness";
import { EventEmitter, once } from "node:events";
import nodefs from "node:fs";
import http, {
  Agent,
  createServer,
  get,
  globalAgent,
  IncomingMessage,
  OutgoingMessage,
  request,
  Server,
  ServerResponse,
  validateHeaderName,
  validateHeaderValue,
} from "node:http";
import https, { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { connect, createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { connect as tlsConnect } from "node:tls";
import tunnel from "tunnel";
import { run as runHTTPProxyTest } from "./node-http-proxy.js";
const { describe, expect, it, beforeAll, afterAll, createDoneDotAll, mock, test } = createTest(import.meta.path);

function listen(server: Server, protocol: string = "http"): Promise<URL> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject("Timed out"), 5000).unref();
    server.listen({ port: 0 }, (err, hostname, port) => {
      clearTimeout(timeout);

      if (err) {
        reject(err);
      } else {
        resolve(new URL(`${protocol}://${hostname}:${port}`));
      }
    });
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
          expect(req.connection.encrypted).toBe(false);
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
      const input = Buffer.alloc("hello world, hello world".length * 9000, "hello world, hello world");
      try {
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
          body: input,
        });

        const out = await res.text();
        expect(out).toBe(input.toString());
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

    it("listen callback should be bound to server", async () => {
      const server = createServer();
      const { resolve, reject, promise } = Promise.withResolvers();
      server.listen(0, function () {
        try {
          expect(this === server).toBeTrue();
          resolve();
        } catch (e) {
          reject();
        }
      });
      await promise;
      server.close();
    });

    it("should use the provided port", async () => {
      while (true) {
        try {
          const server = http.createServer(() => {});
          const random_port = randomPort();
          server.listen(random_port);
          await once(server, "listening");
          const { port } = server.address();
          expect(port).toEqual(random_port);
          server.close();
          break;
        } catch (err) {
          // Address in use try another port
          if (err.code === "EADDRINUSE") {
            continue;
          }
          throw err;
        }
      }
    });

    it("should assign a random port when undefined", async () => {
      const server1 = http.createServer(() => {});
      const server2 = http.createServer(() => {});
      server1.listen(undefined);
      server2.listen(undefined);
      const { port: port1 } = server1.address();
      const { port: port2 } = server2.address();
      expect(port1).not.toEqual(port2);
      expect(port1).toBeWithin(1024, 65535);
      server1.close();
      server2.close();
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
        if (Object.getPrototypeOf(req.headers) !== Object.prototype) {
          // Like Node.js, req.headers is a plain object.
          throw new Error("Headers should have the plain Object prototype");
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
            req.on("timeout", () => {
              console.log("req timeout");
            });
            res.on("timeout", () => {
              console.log("res timeout");
            });
            timer = setTimeout(() => {
              if (res.closed) {
                return;
              }

              res.end("Hello World");
              timer = null;
            }, 3000).unref();
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
        if (req.method === "OPTIONS") {
          req.on("data", chunk => {
            res.write(chunk);
          });

          req.on("end", () => {
            res.write("OPTIONS\n");
            res.end("Hello World");
          });
        } else if (req.method === "POST") {
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

    // test("check for expected fields", done => {
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

    it("should make a https:// GET request when passed string as first arg", _done => {
      const server = exampleSite();
      function done(err?: Error) {
        server.stop();
        _done(err);
      }

      const req = https.request(server.url, { ca: server.ca, headers: { "accept-encoding": "identity" } }, res => {
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
        // Neglecting to close this will cause a future test to fail.
        req.on("close", () => done());
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

    it("should ignore body when method is GET/HEAD", done => {
      runTest(done, (server, serverPort, done) => {
        const createDone = createDoneDotAll(done);
        const methods = ["GET", "HEAD"];
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

    it("should have a response body when method is OPTIONS", done => {
      runTest(done, (server, serverPort, done) => {
        const createDone = createDoneDotAll(done);
        const methods = ["OPTIONS"]; //keep this logic to add more methods in future
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
              expect(data).toBe(method + "\nHello World");
              dones[method]();
            });
            res.on("error", err => dones[method](err));
          });
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

    it("request via http proxy, issue#4295", async () => {
      await runHTTPProxyTest();
    });

    // https://github.com/oven-sh/bun/issues/31795
    // A custom agent (the `tunnel` package) establishes an HTTP CONNECT tunnel
    // by overriding addRequest/createSocket and calling req.onSocket(). Bun
    // must route through those hooks and emit a CONNECT, not bypass the proxy.
    it("uses a tunnel.httpsOverHttp() agent and sends CONNECT to the proxy", async () => {
      const { promise: connectLine, resolve: gotConnect } = Promise.withResolvers<string>();

      // Minimal proxy that records the CONNECT request it receives and replies
      // 502 so the tunnel fails the same way it does in Node.
      const proxy = createNetServer(socket => {
        let buf = "";
        socket.on("data", chunk => {
          buf += chunk.toString();
          // Buffer to the end of the request-header block — a single TCP
          // chunk is not guaranteed to carry the full CONNECT line + Host.
          if (buf.indexOf("\r\n\r\n") === -1) return;
          gotConnect(buf);
          socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
        });
      });
      try {
        await once(proxy.listen(0, "127.0.0.1"), "listening");
        const proxyPort = (proxy.address() as AddressInfo).port;

        const agent = tunnel.httpsOverHttp({ proxy: { host: "127.0.0.1", port: proxyPort } });

        const { promise: requestDone, resolve: requestResolve } = Promise.withResolvers<{
          status?: number;
          error?: string;
        }>();
        const req = https.request({ host: "example.com", port: 443, path: "/", method: "GET", agent }, res => {
          res.resume();
          requestResolve({ status: res.statusCode });
        });
        req.on("error", err => requestResolve({ error: (err as Error).message }));
        req.end();

        // The proxy must receive a CONNECT targeting the requested host:port.
        const received = await connectLine;
        expect(received).toContain("CONNECT example.com:443 HTTP/1.1");
        expect(received.toLowerCase()).toContain("host: example.com:443");

        // And the request must surface the proxy's failure, not a direct 200.
        const result = await requestDone;
        expect(result.status).toBeUndefined();
        expect(result.error).toContain("statusCode=502");
      } finally {
        await new Promise<void>(r => proxy.close(() => r()));
      }
    });

    // Full success path: the proxy accepts the CONNECT and pipes bytes through,
    // so the tunneled request receives the target server's response.
    it("tunnels a request through an HTTP CONNECT proxy (tunnel.httpOverHttp)", async () => {
      const target = createServer((req, res) => {
        res.writeHead(200, { "x-tunneled": "yes" });
        res.end("through-the-tunnel");
      });

      let connectTarget: string | undefined;
      const proxy = createServer();
      proxy.on("connect", (req, clientSocket, head) => {
        connectTarget = req.url as string;
        const [host, port] = (req.url as string).split(":");
        const serverSocket = connect(Number(port), host, () => {
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head?.length) serverSocket.write(head);
          serverSocket.pipe(clientSocket);
          clientSocket.pipe(serverSocket);
        });
        serverSocket.on("error", () => clientSocket.end());
      });

      try {
        await once(target.listen(0, "127.0.0.1"), "listening");
        const targetPort = (target.address() as AddressInfo).port;
        await once(proxy.listen(0, "127.0.0.1"), "listening");
        const proxyPort = (proxy.address() as AddressInfo).port;

        const agent = tunnel.httpOverHttp({ proxy: { host: "127.0.0.1", port: proxyPort } });

        const { promise, resolve, reject } = Promise.withResolvers<{
          status: number;
          header?: string | string[];
          body: string;
        }>();
        const req = http.request({ host: "127.0.0.1", port: targetPort, path: "/", method: "GET", agent }, res => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", c => (body += c));
          res.on("end", () => resolve({ status: res.statusCode as number, header: res.headers["x-tunneled"], body }));
        });
        req.on("error", reject);
        req.end();

        const result = await promise;
        expect(result).toEqual({ status: 200, header: "yes", body: "through-the-tunnel" });
        // The request must have gone through the proxy's CONNECT handler, not a
        // direct connection to the target (which would bypass the agent).
        expect(connectTarget).toBe(`127.0.0.1:${targetPort}`);
      } finally {
        await new Promise<void>(r => proxy.close(() => r()));
        await new Promise<void>(r => target.close(() => r()));
      }
    });

    it("should correctly stream a multi-chunk response #5320", async done => {
      runTest(done, (server, serverPort, done) => {
        const req = request({
          host: "localhost",
          port: `${serverPort}`,
          path: "/multi-chunk-response",
          method: "GET",
        });

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
        // Destroying an in-flight request surfaces a "socket hang up" error,
        // exactly like Node.js; swallow it so it does not leak into the next
        // test as an unhandled error.
        req.on("error", () => {});
        req.on("socket", function onRequestSocket(socket) {
          req.destroy();
          done();
        });
        req.end();
      });
    });
  });

  describe("https.request with custom tls options", () => {
    it("supports custom tls args", async () => {
      await using httpsServer = exampleSite();

      const { promise, resolve, reject } = Promise.withResolvers();
      const options: https.RequestOptions = {
        method: "GET",
        url: httpsServer.url.href as string,
        port: httpsServer.url.port,
        ca: httpsServer.ca,
      };
      const req = https.request(options, res => {
        res.on("data", () => null);
        res.on("end", resolve);
      });

      req.on("error", reject);

      req.end();

      await promise;
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
    it("treats host option containing URL delimiter characters as an unresolvable hostname", async () => {
      let requestCount = 0;
      const server = createServer((req, res) => {
        requestCount++;
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
      });
      try {
        const url = await listen(server);

        // The literal host option string is the DNS/connect target (Node.js semantics).
        // Characters like "/" and "?" must not allow the value to be re-interpreted as a
        // URL whose host points at a different server; the only acceptable outcome is a
        // lookup failure with no request ever being sent.
        const confusedHost = `127.0.0.1:${url.port}/?.invalid.example`;
        const { promise, resolve, reject } = Promise.withResolvers();
        const req = get({ host: confusedHost, path: "/info", auth: "svc:secret" }, res => {
          res.resume();
          reject(new Error(`request unexpectedly completed with status ${res.statusCode}`));
        });
        req.on("error", resolve);
        const err: any = await promise;
        expect(err.code).toBe("ENOTFOUND");
        expect(err.hostname).toBe(confusedHost);
        expect(requestCount).toBe(0);

        // A plain host + port still works.
        const { promise: okPromise, resolve: resolveOk, reject: rejectOk } = Promise.withResolvers();
        get({ host: "127.0.0.1", port: url.port, path: "/info" }, res => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", chunk => (data += chunk));
          res.on("end", () => resolveOk({ statusCode: res.statusCode, data }));
        }).on("error", rejectOk);
        expect(await okPromise).toEqual({ statusCode: 200, data: "ok" });
        expect(requestCount).toBe(1);
      } finally {
        server.close();
      }
    });

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

    it("can be constructed with new", () => {
      expect(new Agent().protocol).toBe("http:");
    });
    it("can be constructed with apply", () => {
      expect(Agent.apply({}).protocol).toBe("http:");
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
    it("should attempt to make a standard GET request and abort", async () => {
      let server_port;
      let server_host;
      const {
        resolve: resolveClientAbort,
        reject: rejectClientAbort,
        promise: promiseClientAbort,
      } = Promise.withResolvers();

      const server = createServer((req, res) => {});

      server.listen({ port: 0 }, (_err, host, port) => {
        server_port = port;
        server_host = host;

        const signal = AbortSignal.timeout(5);

        // Like Node.js, aborting via an AbortSignal surfaces an AbortError
        // "error" event on the request (the legacy "abort" event is only
        // emitted by req.abort()).
        get(`http://${server_host}:${server_port}`, { signal }, res => {
          rejectClientAbort(new Error("the server never responds; the request should have been aborted"));
        }).once("error", err => {
          try {
            expect(err.name).toBe("AbortError");
            resolveClientAbort();
          } catch (e) {
            rejectClientAbort(e);
          }
        });
      });

      await promiseClientAbort;
      server.close();
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

  test("test unix socket server", async () => {
    const { promise, resolve, reject } = Promise.withResolvers();
    const socketPath = `${tmpdir()}/bun-server-${Math.random().toString(32)}.sock`;
    await using server = createServer((req, res) => {
      expect(req.method).toStrictEqual("GET");
      expect(req.url).toStrictEqual("/bun?a=1");
      res.writeHead(200, {
        "Content-Type": "text/plain",
        "Connection": "close",
      });
      res.write("Bun\n");
      res.end();
    });

    server.listen(socketPath, async () => {
      try {
        const response = await fetch(`http://localhost/bun?a=1`, {
          unix: socketPath,
        });
        const text = await response.text();
        expect(text).toBe("Bun\n");
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    await promise;
  });

  test("should not decompress gzip, issue#4397", async () => {
    using server = Bun.serve({
      port: 0,
      tls: tlsCert,
      fetch() {
        const body = Bun.gzipSync(Buffer.from("<html>Hello</html>"));
        return new Response(body, {
          headers: { "content-encoding": "gzip" },
        });
      },
    });
    const { promise, resolve } = Promise.withResolvers();
    https
      .request(server.url, { ca: tlsCert.cert, headers: { "accept-encoding": "gzip" } }, res => {
        res.on("data", function cb(chunk) {
          resolve(chunk);
          res.off("data", cb);
        });
      })
      .end();
    const chunk = await promise;
    expect(chunk.toString()).not.toContain("<html");
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

  test("error event not fired, issue#4651", async () => {
    const { promise, resolve } = Promise.withResolvers();
    const server = createServer((req, res) => {
      res.end();
    });
    server.listen({ port: 0 }, () => {
      const server2 = createServer((_, res) => {
        res.end();
      });
      server2.on("error", err => {
        resolve(err);
      });
      server2.listen({ port: server.address().port }, () => {});
    });
    const err = await promise;
    expect(err.code).toBe("EADDRINUSE");
  });
});

describe("node https server", async () => {
  const httpsOptions = {
    key: nodefs.readFileSync(path.join(import.meta.dir, "fixtures", "cert.key")),
    cert: nodefs.readFileSync(path.join(import.meta.dir, "fixtures", "cert.pem")),
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

  test("ServerResponse instanceof OutgoingMessage", () => {
    expect(new ServerResponse({}) instanceof OutgoingMessage).toBe(true);
  });
  test("ServerResponse assign assignSocket", async done => {
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
      await Bun.sleep(10);

      expect(res.socket).toBe(socket);
      expect(socket._httpMessage).toBe(res);
      expect(() => res.assignSocket(socket)).toThrow("Socket already assigned");
      socket.emit("close");
      doneSocket();
    } catch (err) {
      doneRequest(err);
    }
  });
});

it("should propagate exception in sync data handler", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", path.join(import.meta.dir, "node-http-error-in-data-handler-fixture.1.js")],
    stdout: "pipe",
    stderr: "inherit",
    env: bunEnv,
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toContain("Test passed");
  expect(exitCode).toBe(0);
});

it("should propagate exception in async data handler", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", path.join(import.meta.dir, "node-http-error-in-data-handler-fixture.2.js")],
    stdout: "pipe",
    stderr: "inherit",
    env: bunEnv,
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toContain("Test passed");
  expect(exitCode).toBe(0);
});

// This test is disabled because it can OOM the CI
it.skip("should be able to stream huge amounts of data", async () => {
  const buf = Buffer.alloc(1024 * 1024 * 256);
  const CONTENT_LENGTH = 3 * 1024 * 1024 * 1024;
  let received = 0;
  let written = 0;
  const { promise: listen, resolve: resolveListen } = Promise.withResolvers();
  const server = http
    .createServer((req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/plain",
        "Content-Length": CONTENT_LENGTH,
      });
      function commit() {
        if (written < CONTENT_LENGTH) {
          written += buf.byteLength;
          res.write(buf, commit);
        } else {
          res.end();
        }
      }

      commit();
    })
    .listen(0, "localhost", resolveListen);
  await listen;

  try {
    const response = await fetch(`http://localhost:${server.address().port}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain");
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      received += value ? value.byteLength : 0;
      if (done) {
        break;
      }
    }
    expect(written).toBe(CONTENT_LENGTH);
    expect(received).toBe(CONTENT_LENGTH);
  } finally {
    server.close();
  }
}, 30_000);

describe("HTTP Server Security Tests - Advanced", () => {
  // Setup and teardown utilities
  let server;
  let port;

  beforeEach(async () => {
    server = new Server();

    server.listen(0, () => {
      port = server.address().port;
    });
    await once(server, "listening");
  });

  afterEach(async () => {
    // Close the server if it's still running
    if (server.listening) {
      server.closeAllConnections();
    }
  });

  // Helper that returns a promise with the server response
  const sendRequest = message => {
    return new Promise((resolve, reject) => {
      const client = connect(port, "localhost");
      let response = "";
      client.setEncoding("utf8");
      client.on("data", chunk => {
        response += chunk;
      });

      client.on("error", reject);

      client.on("end", () => {
        resolve(response.toString("utf8"));
      });

      client.write(message);
    });
  };

  // Mock request handler that simulates security-sensitive operations
  const createMockHandler = () => {
    const mockHandler = jest.fn().mockImplementation((req, res) => {
      // In a real app, this might be a security-sensitive operation
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Request processed successfully");
    });

    return mockHandler;
  };

  // Like Node, installing a 'clientError' listener makes the listener
  // responsible for the connection: reply with a raw 400 and close, mirroring
  // Node's documented handler, so the client still observes the rejection.
  const replyBadRequest = socket => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  };

  // Test Suites

  describe("Header Injection Protection", () => {
    test("rejects requests with CR in header field name", async () => {
      const mockHandler = createMockHandler();
      server.on("request", mockHandler);
      const { promise, resolve, reject } = Promise.withResolvers();
      server.on("clientError", (err: any, socket) => {
        replyBadRequest(socket);
        try {
          expect(err.code).toBe("HPE_INVALID_HEADER_TOKEN");
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      const msg = ["GET / HTTP/1.1", "Host: localhost", "Bad\rHeader: value", "", ""].join("\r\n");

      const response = await sendRequest(msg);
      expect(response).toInclude("400 Bad Request");
      await promise;
      expect(mockHandler).not.toHaveBeenCalled();
    });

    test("rejects requests with CR in header field value", async () => {
      const mockHandler = createMockHandler();
      server.on("request", mockHandler);
      const { promise, resolve, reject } = Promise.withResolvers();
      server.on("clientError", (err: any, socket) => {
        replyBadRequest(socket);
        try {
          // Node reports a bare CR not followed by LF as HPE_LF_EXPECTED.
          expect(err.code).toBe("HPE_LF_EXPECTED");
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      const msg = ["GET / HTTP/1.1", "Host: localhost", "X-Custom: bad\rvalue", "", ""].join("\r\n");

      const response = await sendRequest(msg);
      expect(response).toInclude("400 Bad Request");
      await promise;
      expect(mockHandler).not.toHaveBeenCalled();
    });
  });

  describe("Transfer-Encoding Attacks", () => {
    test("rejects chunked requests with malformed chunk size", async () => {
      const { promise, resolve, reject } = Promise.withResolvers();
      server.on("clientError", (err: any, socket) => {
        replyBadRequest(socket);
        try {
          expect(err.code).toBe("HPE_INVALID_CHUNK_SIZE");
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      const msg = [
        "POST / HTTP/1.1",
        "Host: localhost",
        "Transfer-Encoding: chunked",
        "",
        "XYZ\r\n", // Not a valid hex number
        "data",
        "0",
        "",
        "",
      ].join("\r\n");

      const response = await sendRequest(msg);
      expect(response).toInclude("400 Bad Request");
      await promise;
    });

    test("rejects chunked requests with invalid chunk ending", async () => {
      const { promise, resolve, reject } = Promise.withResolvers();
      server.on("clientError", (err: any, socket) => {
        replyBadRequest(socket);
        try {
          expect(err.code).toBe("HPE_STRICT");
          expect(err.message).toBe("Parse Error: Expected LF after chunk data");
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      const msg = [
        "POST / HTTP/1.1",
        "Host: localhost",
        "Transfer-Encoding: chunked",
        "",
        "4",
        "dataXXXX", // Should be "data\r\n"
        "0",
        "",
        "",
      ].join("\r\n");

      const response = await sendRequest(msg);
      expect(response).toInclude("400 Bad Request");
      await promise;
    });
  });

  describe("HTTP Request Smuggling", () => {
    test("rejects requests with both Content-Length and Transfer-Encoding", async () => {
      const mockHandler = createMockHandler();
      server.on("request", mockHandler);
      const { promise, resolve, reject } = Promise.withResolvers();
      server.on("clientError", (err: any, socket) => {
        replyBadRequest(socket);
        try {
          expect(err.code).toBe("HPE_INVALID_TRANSFER_ENCODING");
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      const msg = [
        "POST / HTTP/1.1",
        "Host: localhost",
        "Content-Length: 10",
        "Transfer-Encoding: chunked",
        "",
        "5",
        "hello",
        "0",
        "",
        "",
      ].join("\r\n");

      const response = await sendRequest(msg);
      expect(response).toInclude("400 Bad Request");
      await promise;
      expect(mockHandler).not.toHaveBeenCalled();
    });

    test("rejects requests with obfuscated Transfer-Encoding header", async () => {
      const mockHandler = createMockHandler();
      server.on("request", mockHandler);
      const { promise, resolve, reject } = Promise.withResolvers();
      server.on("clientError", (err: any, socket) => {
        replyBadRequest(socket);
        try {
          expect(err.code).toBe("HPE_INVALID_HEADER_TOKEN");
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      const msg = [
        "POST / HTTP/1.1",
        "Host: localhost",
        "Content-Length: 11",
        "Transfer-Encoding : chunked", // Note the space before colon
        "",
        "5",
        "hello",
        "0",
        "",
        "",
      ].join("\r\n");

      const response = await sendRequest(msg);
      expect(response).toInclude("400 Bad Request");
      await promise;
      expect(mockHandler).not.toHaveBeenCalled();
    });

    test("duplicate request headers follow Node.js precedence rules", async () => {
      // Expected values verified against Node.js v24: singleton headers keep
      // the first value, joinable headers are comma-joined, Cookie joins with
      // "; ", and Set-Cookie becomes an array.
      const { promise, resolve, reject } = Promise.withResolvers();
      server.on("request", (req, res) => {
        try {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("ok");
          resolve({
            host: req.headers.host,
            contentType: req.headers["content-type"],
            authorization: req.headers.authorization,
            accept: req.headers.accept,
            xCustom: req.headers["x-custom"],
            cookie: req.headers.cookie,
            setCookie: req.headers["set-cookie"],
            rawHostCount: req.rawHeaders.filter(h => h.toLowerCase() === "host").length,
          });
        } catch (err) {
          reject(err);
        }
      });

      const msg = [
        "GET / HTTP/1.1",
        "Host: first.example.com",
        "Host: second.example.com",
        "Content-Type: text/plain",
        "Content-Type: text/html",
        "Authorization: token1",
        "Authorization: token2",
        "Accept: application/json",
        "Accept: text/html",
        "X-Custom: one",
        "X-Custom: two",
        "Cookie: a=1",
        "Cookie: b=2",
        "Set-Cookie: x=1",
        "Set-Cookie: y=2",
        "Connection: close",
        "",
        "",
      ].join("\r\n");

      const response = await sendRequest(msg);
      expect(response).toInclude("200");
      const headers: any = await promise;
      // Singleton headers keep the first value.
      expect(headers.host).toBe("first.example.com");
      expect(headers.contentType).toBe("text/plain");
      expect(headers.authorization).toBe("token1");
      // Other headers are joined with ", ".
      expect(headers.accept).toBe("application/json, text/html");
      expect(headers.xCustom).toBe("one, two");
      // Cookie is joined with "; ".
      expect(headers.cookie).toBe("a=1; b=2");
      // Set-Cookie is collected into an array.
      expect(headers.setCookie).toEqual(["x=1", "y=2"]);
      // rawHeaders still reports every received header.
      expect(headers.rawHostCount).toBe(2);
    });

    test("duplicate request header edge cases follow Node.js precedence rules", async () => {
      // Expected values verified against Node.js v24.
      const { promise, resolve, reject } = Promise.withResolvers();
      server.on("request", (req, res) => {
        try {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("ok");
          resolve({
            xTriple: req.headers["x-triple"],
            xMixed: req.headers["x-mixed"],
            xEmpty: req.headers["x-empty"],
            server: req.headers.server,
            retryAfter: req.headers["retry-after"],
            numeric: req.headers["123"],
            rawHeaderCount: req.rawHeaders.length,
          });
        } catch (err) {
          reject(err);
        }
      });

      const msg = [
        "GET / HTTP/1.1",
        "Host: localhost",
        "X-Triple: one",
        "X-Triple: two",
        "X-Triple: three",
        "x-MIXED: a",
        "X-Mixed: b",
        "X-Empty:",
        "X-Empty: b",
        "Server: apache",
        "Server: nginx",
        "Retry-After: 10",
        "Retry-After: 20",
        "123: a",
        "123: b",
        "Connection: close",
        "",
        "",
      ].join("\r\n");

      const response = await sendRequest(msg);
      expect(response).toInclude("200");
      const headers: any = await promise;
      expect(headers).toEqual({
        // Three or more occurrences are all joined, in order.
        xTriple: "one, two, three",
        // Names that differ only by case are the same header.
        xMixed: "a, b",
        // An empty first value still participates in the join.
        xEmpty: ", b",
        // Singleton headers keep the first value, including the ones WebCore
        // has no HTTPHeaderName for (server, retry-after).
        server: "apache",
        retryAfter: "10",
        // A header whose name parses as an array index joins like any other.
        numeric: "a, b",
        // rawHeaders still reports every received header (15 names + values).
        rawHeaderCount: 30,
      });
    });
  });

  describe("HTTP Protocol Violations", () => {
    test("rejects requests with invalid HTTP version", async () => {
      const mockHandler = createMockHandler();
      server.on("request", mockHandler);
      const { promise, resolve, reject } = Promise.withResolvers();
      server.on("clientError", (err: any, socket) => {
        replyBadRequest(socket);
        try {
          // Node reports an unsupported version as HPE_INVALID_VERSION.
          expect(err.code).toBe("HPE_INVALID_VERSION");
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      const msg = [
        "GET / HTTP/9.9", // Invalid HTTP version
        "Host: localhost",
        "",
        "",
      ].join("\r\n");

      const response = await sendRequest(msg);
      // Like Node, the parse error is answered with 400 Bad Request (the
      // 'clientError' handler above owns the reply).
      expect(response).toInclude("400 Bad Request");
      await promise;
      expect(mockHandler).not.toHaveBeenCalled();
    });

    test("rejects requests with missing Host header in HTTP/1.1", async () => {
      const mockHandler = createMockHandler();
      server.on("request", mockHandler);
      // Node answers this from parserOnIncoming (res.writeHead(400, ['Connection',
      // 'close']); res.end()) - no parse error reaches socketOnError, so
      // 'clientError' never fires.
      const clientError = jest.fn();
      server.on("clientError", clientError);
      const msg = [
        "GET / HTTP/1.1",
        // Missing Host header
        "",
        "",
      ].join("\r\n");

      const response = await sendRequest(msg);
      expect(response.replace(/Date: [^\r]+/, "Date: <date>")).toBe(
        "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nDate: <date>\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n",
      );
      expect(clientError).not.toHaveBeenCalled();
      expect(mockHandler).not.toHaveBeenCalled();
    });

    test("https server fires clientError with HPE_INVALID_EOF_STATE when the client closes mid-request", async () => {
      // The TLS layer used to force-close on the peer's EOF without ever
      // dispatching it to the HTTP layer, so a premature EOF that fires
      // 'clientError' over plain http was silently swallowed over https.
      // Node reports HPE_INVALID_EOF_STATE on both transports.
      const httpsServer = createHttpsServer(tlsCert, () => {});
      const clientErr = Promise.withResolvers<NodeJS.ErrnoException>();
      httpsServer.on("clientError", (err, socket) => {
        socket.destroy();
        clientErr.resolve(err);
      });
      await new Promise<void>(resolve => httpsServer.listen(0, "127.0.0.1", resolve));
      try {
        const port = (httpsServer.address() as AddressInfo).port;
        const socket = tlsConnect({ port, host: "127.0.0.1", rejectUnauthorized: false }, () => {
          socket.write("POST / HTTP/1.1\r\nHost:");
          socket.end();
        });
        socket.on("error", () => {});
        const err = await clientErr.promise;
        expect(err.code).toBe("HPE_INVALID_EOF_STATE");
      } finally {
        httpsServer.close();
      }
    });
  });

  describe("Response Splitting Protection", () => {
    test("rejects CRLF in statusMessage set via property assignment followed by res.end()", async () => {
      const { promise: errorPromise, resolve: resolveError } = Promise.withResolvers<Error>();
      server.on("request", (req, res) => {
        res.statusCode = 200;
        res.statusMessage = "OK\r\nSet-Cookie: admin=true";
        try {
          res.end("body");
        } catch (e: any) {
          resolveError(e);
          res.statusMessage = "OK";
          res.end("safe");
        }
      });

      const response = (await sendRequest("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")) as string;
      const err = await errorPromise;
      expect((err as any).code).toBe("ERR_INVALID_CHAR");
      // The injected Set-Cookie header must NOT appear in the response
      expect(response).not.toInclude("Set-Cookie: admin=true");
    });

    test("rejects CRLF in statusMessage set via property assignment followed by res.write()", async () => {
      const { promise: errorPromise, resolve: resolveError } = Promise.withResolvers<Error>();
      server.on("request", (req, res) => {
        res.statusCode = 200;
        res.statusMessage = "OK\r\nX-Injected: evil";
        try {
          res.write("chunk");
        } catch (e: any) {
          resolveError(e);
          res.statusMessage = "OK";
          res.end("safe");
        }
      });

      const response = (await sendRequest("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")) as string;
      const err = await errorPromise;
      expect((err as any).code).toBe("ERR_INVALID_CHAR");
      expect(response).not.toInclude("X-Injected: evil");
    });

    test("rejects CRLF in statusMessage passed to writeHead()", async () => {
      server.on("request", (req, res) => {
        expect(() => {
          res.writeHead(200, "OK\r\nX-Injected: evil");
        }).toThrow(/Invalid character in statusMessage/);
        res.writeHead(200, "OK");
        res.end("safe");
      });

      const response = (await sendRequest("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")) as string;
      expect(response).not.toInclude("X-Injected");
      expect(response).toInclude("safe");
    });

    test("allows valid statusMessage without control characters", async () => {
      server.on("request", (req, res) => {
        res.statusCode = 200;
        res.statusMessage = "Everything Is Fine";
        res.end("ok");
      });

      const response = (await sendRequest("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")) as string;
      expect(response).toInclude("200 Everything Is Fine");
      expect(response).toInclude("ok");
    });
  });

  test("Server should not crash in clientError is emitted when calling destroy", async () => {
    // A Host-less request is NOT a client error in Node: parserOnIncoming answers
    // it with 400 itself. An invalid method is what reaches 'clientError'.
    const invalidRequest = "FOO_BAR / HTTP/1.1\r\nHost: localhost\r\n\r\n";
    await using server = http.createServer(async (req, res) => {
      res.end("Hello World");
    });

    const codes: string[] = [];
    const clientErrors: Promise<void>[] = [];
    server.on("clientError", (err: any, socket) => {
      codes.push(err.code);
      clientErrors.push(
        Bun.sleep(10).then(() => {
          socket.destroy();
        }),
      );
    });
    await once(server.listen(), "listening");
    const address = server.address() as AddressInfo;

    async function doRequests(address: AddressInfo) {
      const client = connect(address.port, address.address, () => {
        client.write("GET / HTTP/1.1\r\nHost: localhost:3000\r\nContent-Length: 0\r\n\r\n");
      });
      {
        const { promise, resolve, reject } = Promise.withResolvers<string>();
        client.on("data", resolve);
        client.on("error", reject);
        client.on("end", resolve);
        await promise;
      }
      {
        const { promise, resolve, reject } = Promise.withResolvers<string>();
        client.write(invalidRequest);
        client.on("error", reject);
        client.on("end", resolve);
        await promise;
      }
    }

    async function doInvalidRequests(address: AddressInfo) {
      const client = connect(address.port, address.address, () => {
        client.write(invalidRequest);
      });
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      client.on("error", reject);
      client.on("close", resolve);
      await promise;
    }

    await doRequests(address);
    await Promise.all(clientErrors);
    expect(codes).toEqual(["HPE_INVALID_METHOD"]);
    clientErrors.length = 0;
    await doInvalidRequests(address);
    await Promise.all(clientErrors);
    expect(codes).toEqual(["HPE_INVALID_METHOD", "HPE_INVALID_METHOD"]);
  });

  test("flushHeaders should send the headers immediately", async () => {
    let headers_sent_at: number = 0;

    let server_res: http.ServerResponse | undefined;
    await using server = http.createServer(async (req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      headers_sent_at = Date.now();
      server_res = res;
      res.flushHeaders();
    });

    await once(server.listen(0, "127.0.0.1"), "listening");
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}`);
    expect(Date.now() - headers_sent_at).toBeLessThan(100);
    expect(server_res).toBeDefined();
    server_res!.write("Hello", () => {
      server_res!.end(" World");
    });
    const text = await response.text();
    expect(text).toBe("Hello World");
  });
});

it("native server socket handle accessors return undefined for non-socket receivers", async () => {
  // The custom getters/setters on the native server-socket prototype must verify the
  // receiver type. Reflect.get(proto, name, {}) invokes the native accessor with an
  // arbitrary object as `this`; it must return undefined instead of reading native
  // fields out of the foreign object's storage.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const http = require("node:http");
        const server = http.createServer((req, res) => {
          let failure;
          try {
            const socket = req.socket;
            const handleSym = Object.getOwnPropertySymbols(socket).find(s => s.description === "handle");
            const handle = handleSym && socket[handleSym];
            if (!handle || typeof handle.write !== "function") {
              throw new Error("could not locate the native socket handle");
            }
            const proto = Object.getPrototypeOf(handle);
            const getters = [
              "closed",
              "bytesWritten",
              "secureEstablished",
              "response",
              "duplex",
              "remoteAddress",
              "localAddress",
              "onclose",
              "ondrain",
              "ondata",
            ];
            for (const name of getters) {
              // Plain object with populated inline properties as the receiver.
              const fake = { a: 1.1, b: 2.2, c: 3.3, d: 4.4, e: 5.5, f: 6.6 };
              const viaReflect = Reflect.get(proto, name, fake);
              if (viaReflect !== undefined) {
                throw new Error(name + " getter returned a value for a plain-object receiver: " + String(viaReflect));
              }
              // The prototype object itself is also not a socket handle.
              const viaProto = proto[name];
              if (viaProto !== undefined) {
                throw new Error(name + " getter returned a value for the prototype receiver: " + String(viaProto));
              }
            }
            for (const name of ["duplex", "onclose", "ondrain", "ondata"]) {
              // Setters must not write through a non-socket receiver.
              Reflect.set(proto, name, function () {}, { a: 1.1, b: 2.2, c: 3.3 });
            }
            // The real handle still works through the same accessors.
            if (typeof handle.closed !== "boolean") throw new Error("handle.closed is not a boolean");
            if (typeof handle.bytesWritten !== "number") throw new Error("handle.bytesWritten is not a number");
          } catch (err) {
            failure = err;
          }
          if (failure) {
            console.error(failure && (failure.stack || failure.message || failure));
            res.end("FAIL");
          } else {
            console.log("OK");
            res.end("PASS");
          }
          server.close();
        });
        server.listen(0, "127.0.0.1", () => {
          fetch("http://127.0.0.1:" + server.address().port + "/").then(r => r.text());
        });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toContain("OK");
  expect(exitCode).toBe(0);
}, 15_000);

it("socket handle write keeps buffered data intact when encoding coercion re-enters write", async () => {
  // Argument conversion for the native socket write can run arbitrary JS (an encoding
  // object's toString). If that JS calls write() again on the same socket, both the
  // re-entrant write's data and the outer write's data must survive; nothing may be
  // dropped or written through a stale buffer.
  //
  // Driven from a "connect" handler so the raw socket write path is exercised with no
  // chunked framing or response head in the way.
  const MB = 1024 * 1024;
  const expectedTotal = 8 * MB + 4 * MB + 4 * MB;
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const http = require("node:http");
        const net = require("node:net");
        const MB = 1024 * 1024;
        const A = Buffer.alloc(8 * MB, 0x61);
        const B = Buffer.alloc(4 * MB, 0x62);
        const C = Buffer.alloc(4 * MB, 0x63);
        const server = http.createServer();
        server.on("connect", (req, socket) => {
          const handleSym = Object.getOwnPropertySymbols(socket).find(s => s.description === "handle");
          const handle = handleSym && socket[handleSym];
          if (!handle || typeof handle.write !== "function") {
            console.error("could not locate the native socket handle");
            process.exit(1);
          }
          // The CONNECT path already wired handle.ondrain (kEnableStreaming), so the native
          // writable handler will flush the stream buffer as the client reads.
          // The client cannot read while this handler runs synchronously on the same thread,
          // so most of this 8 MB lands in the native stream buffer.
          handle.write(A);
          // The encoding object's toString() re-enters write() on the same socket while the
          // outer call is still converting its arguments.
          handle.write(B, {
            toString() {
              handle.write(C);
              return "utf8";
            },
          });
          handle.end();
        });
        server.listen(0, "127.0.0.1", () => {
          let received = 0;
          let aCount = 0, bCount = 0, cCount = 0;
          const client = net.connect(server.address().port, "127.0.0.1", () => {
            client.write("CONNECT example.com:443 HTTP/1.1\\r\\nHost: example.com:443\\r\\n\\r\\n");
          });
          client.on("data", chunk => {
            received += chunk.length;
            for (let i = 0; i < chunk.length; i++) {
              const b = chunk[i];
              if (b === 0x61) aCount++;
              else if (b === 0x62) bCount++;
              else if (b === 0x63) cCount++;
            }
          });
          client.on("end", () => {
            console.log("received=" + received + " a=" + aCount + " b=" + bCount + " c=" + cCount);
            process.exit(0);
          });
          client.on("error", err => {
            console.error(err);
            process.exit(1);
          });
        });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toContain("received=" + expectedTotal + " a=" + 8 * MB + " b=" + 4 * MB + " c=" + 4 * MB);
  expect(exitCode).toBe(0);
}, 30_000);

it("client request path that does not begin with a slash stays on the configured host", async () => {
  // `options.path` must only ever influence the request target that is written
  // on the wire; it must never change which server the client connects to,
  // even when it looks like an absolute URL pointing somewhere else.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const http = require("node:http");

        // The server the request is configured to reach.
        const intended = http.createServer((req, res) => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("intended " + req.url);
        });

        // A second server that must never receive the request.
        let decoyRequests = 0;
        const decoy = http.createServer((req, res) => {
          decoyRequests++;
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("decoy");
        });

        function get(options) {
          return new Promise((resolve, reject) => {
            const req = http.request(options, res => {
              let data = "";
              res.setEncoding("utf8");
              res.on("data", chunk => (data += chunk));
              res.on("end", () => resolve(data));
            });
            req.on("error", reject);
            req.end();
          });
        }

        intended.listen(0, "127.0.0.1", () => {
          decoy.listen(0, "127.0.0.1", async () => {
            const intendedPort = intended.address().port;
            const decoyPort = decoy.address().port;
            try {
              // An absolute-form request target pointing at another server must
              // stay on the configured host and be sent verbatim as the
              // request target (like Node.js).
              const decoyUrl = "http://127.0.0.1:" + decoyPort + "/";
              const answered = await get({
                host: "127.0.0.1",
                port: intendedPort,
                path: decoyUrl,
              });
              if (!answered.startsWith("intended ")) {
                throw new Error("request was answered by the wrong server: " + answered);
              }
              if (!answered.includes(decoyUrl)) {
                throw new Error("request path was not preserved: " + answered);
              }
              // An ordinary path still reaches the configured host unchanged.
              const ok = await get({ host: "127.0.0.1", port: intendedPort, path: "/hello?world" });
              if (ok !== "intended /hello?world") {
                throw new Error("ordinary path broke: " + ok);
              }
              if (decoyRequests !== 0) {
                throw new Error("the other server received " + decoyRequests + " request(s)");
              }
              console.log("OK");
            } catch (err) {
              console.error(err && (err.stack || err.message || err));
              process.exitCode = 1;
            } finally {
              intended.close();
              decoy.close();
            }
          });
        });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toContain("OK");
  expect(exitCode).toBe(0);
}, 15_000);

it("http.request rejects an options.port that is not a valid port number", async () => {
  // options.port must be an integer in the range 0-65535 (Node.js throws
  // ERR_SOCKET_BAD_PORT for anything else). Bun builds the request target as
  // `${protocol}//${host}:${port}${path}`, so an arbitrary string port such as
  // "80@other-host/" must be rejected up front instead of being parsed as part
  // of the URL authority, which would change the host the request is sent to.
  const getError = (fn: () => unknown) => {
    try {
      fn();
    } catch (err) {
      return err as NodeJS.ErrnoException;
    }
    return undefined;
  };

  for (const badPort of ["80@169.254.169.254/latest/meta-data/?", "1234abc", -1, 65536]) {
    const err = getError(() => http.request({ host: "127.0.0.1", port: badPort, path: "/" }));
    expect(err?.code).toBe("ERR_SOCKET_BAD_PORT");
  }

  const typeErr = getError(() => http.request({ host: "127.0.0.1", port: {} as any, path: "/" }));
  expect(typeErr?.code).toBe("ERR_INVALID_ARG_TYPE");

  // A valid port keeps working, including when passed as a numeric string.
  const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok " + req.url);
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const body = await new Promise<string>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: String(port), path: "/hello" }, res => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", chunk => (data += chunk));
        res.on("end", () => resolve(data));
      });
      req.on("error", reject);
      req.end();
    });
    expect(body).toBe("ok /hello");
  } finally {
    server.close();
  }
});

it("ClientRequest.destroy(err) emits 'error' before the terminal 'close'", async () => {
  // Node: socketErrorListener forwards the error to the request before
  // socketCloseListener emits 'close'. Code treating 'close' as terminal
  // (e.g. removing listeners there) must still observe the error.
  const server = http.createServer((req, res) => {
    res.write("x"); // keep the response incomplete
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  try {
    const events = await new Promise<string[]>(resolve => {
      const req = http.get({ host: "127.0.0.1", port }, () => {
        const seen: string[] = [];
        req.on("error", () => seen.push("error"));
        req.on("close", () => {
          seen.push("close");
          resolve(seen);
        });
        req.destroy(new Error("boom"));
      });
      req.on("error", () => {}); // swallow pre-response errors
    });
    expect(events).toEqual(["error", "close"]);
  } finally {
    server.close();
  }
});

it("ClientRequest.destroy(err) with no error listener does not throw and still tears down", async () => {
  // destroy() must never throw synchronously (node routes the error through
  // the socket's listener and surfaces it async). A listener attached after
  // destroy() returns, same tick, still catches it.
  const server = http.createServer((req, res) => {
    res.write("x");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  try {
    const { err, closedAtError } = await new Promise<{ err: Error; closedAtError: boolean }>(resolve => {
      const req = http.get({ host: "127.0.0.1", port }, () => {
        let sawClose = false;
        req.on("close", () => (sawClose = true));
        req.destroy(new Error("boom")); // must not throw
        req.on("error", e => resolve({ err: e, closedAtError: sawClose }));
      });
    });
    expect(err.message).toBe("boom");
    // 'error' fires before the terminal 'close' (node v26.3.0 verified).
    expect(closedAtError).toBe(false);
  } finally {
    server.close();
  }
});

it("ClientRequest.destroy(err) with a throwing error listener still tears down; the throw surfaces async", async () => {
  // node: a throwing 'error' handler becomes an async uncaught exception
  // after socket.destroy(err) already ran; destroy() itself never throws.
  const script = `
    const http = require("node:http");
    const server = http.createServer((req, res) => res.write("x"));
    server.listen(0, "127.0.0.1", () => {
      const req = http.get({ host: "127.0.0.1", port: server.address().port }, () => {
        req.on("error", () => {
          throw new Error("handler bug");
        });
        let sawClose = false;
        req.on("close", () => (sawClose = true));
        try {
          req.destroy(new Error("boom"));
          console.log("destroy-returned");
        } catch (e) {
          console.log("destroy-threw:" + e.message);
        }
        console.log("teardown-ran:" + sawClose);
        process.on("uncaughtException", e => {
          console.log("async-uncaught:" + e.message);
          process.exit(0);
        });
      });
    });
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // node v26.3.0 verified: 'close' is async (after destroy() returns).
  expect(stdout.trim().split("\n")).toEqual(["destroy-returned", "teardown-ran:false", "async-uncaught:handler bug"]);
  expect(exitCode).toBe(0);
});

it("keep-alive socket reused after a 304 response still frames the next response body", async () => {
  // The native per-request reset must clear the 204/304 no-body flag, or the
  // 200 that follows a 304 on the same connection is sent with no framing
  // and no body.
  const server = createServer((req, res) => {
    if (req.url === "/cached") {
      res.writeHead(304);
      res.end();
    } else {
      res.writeHead(200);
      res.end("hello");
    }
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const out = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let data = "";
      let sentSecond = false;
      socket.on("data", chunk => {
        data += chunk;
        if (!sentSecond && data.includes("\r\n\r\n")) {
          sentSecond = true;
          socket.write("GET /fresh HTTP/1.1\r\nHost: localhost\r\n\r\n");
        }
        if (sentSecond && data.endsWith("hello")) {
          socket.end();
          resolve(data);
        }
      });
      socket.on("error", reject);
      socket.write("GET /cached HTTP/1.1\r\nHost: localhost\r\n\r\n");
    });

    expect(out).toContain("HTTP/1.1 304");
    const second = out.slice(out.indexOf("HTTP/1.1 200"));
    expect(second).toContain("HTTP/1.1 200");
    expect(second).toContain("Content-Length: 5");
    expect(second).toEndWith("\r\n\r\nhello");
  } finally {
    server.close();
  }
});

it("removing only Content-Length falls back to chunked encoding and keeps the connection alive", async () => {
  // Node.js's _storeHeader only goes close-delimited when Transfer-Encoding
  // was removed; removing only Content-Length falls through to chunked.
  const server = createServer((req, res) => {
    res.removeHeader("content-length");
    res.end("hello");
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const out = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let data = "";
      let sentSecond = false;
      socket.on("data", chunk => {
        data += chunk;
        if (!sentSecond && data.includes("0\r\n\r\n")) {
          // First response completed (terminating chunk seen); the connection
          // must still be usable for a second request.
          sentSecond = true;
          socket.write("GET /second HTTP/1.1\r\nHost: localhost\r\n\r\n");
        } else if (sentSecond && data.match(/0\r\n\r\n[\s\S]*0\r\n\r\n/)) {
          socket.end();
          resolve(data);
        }
      });
      socket.on("error", reject);
      socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
    });

    expect(out).toContain("Transfer-Encoding: chunked");
    expect(out).toContain("Connection: keep-alive");
    expect(out).toContain("5\r\nhello\r\n0\r\n\r\n");
    // Both requests were answered on the same connection.
    expect(out.split("HTTP/1.1 200").length).toBe(3);
  } finally {
    server.close();
  }
});

it("an explicit Connection: close response header closes the server-side socket after finish", async () => {
  // Node.js's matchHeader sets _last for a user-set Connection: close, and
  // resOnFinish then ends the socket; the transport must match the header.
  const server = createServer((req, res) => {
    res.setHeader("Connection", "close");
    res.end("ok");
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const out = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let data = "";
      socket.on("data", chunk => (data += chunk));
      // The server must send FIN on its own; the client never half-closes.
      socket.on("end", () => resolve(data));
      socket.on("error", reject);
      socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
    });

    expect(out).toContain("HTTP/1.1 200");
    expect(out).toContain("Connection: close");
    expect(out).toEndWith("ok");
  } finally {
    server.close();
  }
});

it("a pipelined request behind Connection: close is never dispatched (clientError HPE_CLOSED_CONNECTION)", async () => {
  // Node's parser accepts nothing after a message that forbade keep-alive: the
  // pipelined request must not reach 'request' (request smuggling) and the extra
  // bytes surface as a clientError. The async handler is the load-bearing case:
  // the second head is parsed while the first response is still pending.
  const requests: string[] = [];
  const { promise: clientErrorPromise, resolve: resolveClientError } = Promise.withResolvers<any>();
  const server = createServer((req, res) => {
    requests.push(req.url!);
    setTimeout(() => res.end("ok"), 10);
  });
  server.on("clientError", (err, socket) => {
    resolveClientError(err);
    socket.destroy();
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const socket = connect(port, "127.0.0.1");
    socket.on("error", () => {});
    socket.write("GET /a HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\nGET /b HTTP/1.1\r\nHost: x\r\n\r\n");

    const err = await clientErrorPromise;
    expect(err.code).toBe("HPE_CLOSED_CONNECTION");
    expect(requests).toEqual(["/a"]);
    socket.destroy();
  } finally {
    server.close();
  }
});

it("pipelined responses buffered past the high water mark pause reads on the connection", async () => {
  // Node's parserOnIncoming stops reading a connection once the bytes queued on
  // responses that do not own the socket yet (state.outgoingData) reach
  // socket.writableHighWaterMark, and resumes once the queue drains.
  const BODY = Buffer.alloc(256 * 1024, "a");
  const COUNT = 8;
  const pausedFlags: boolean[] = [];
  const { promise: allDispatched, resolve: resolveDispatched } = Promise.withResolvers<void>();
  let headRes: any;
  let serverSocket: any;
  const server = createServer((req, res) => {
    serverSocket = req.socket;
    pausedFlags.push((req.socket as any)._paused === true);
    if (req.url === "/0") {
      headRes = res; // held: every request behind it queues its response
    } else {
      res.writeHead(200, { "Content-Length": String(BODY.length) });
      res.end(BODY);
    }
    if (pausedFlags.length === COUNT) resolveDispatched();
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const socket = connect(port, "127.0.0.1");
    socket.on("error", () => {});
    let message = "";
    for (let i = 0; i < COUNT; i++) message += `GET /${i} HTTP/1.1\r\nHost: x\r\n\r\n`;
    socket.write(message);

    await allDispatched;
    // Requests already in the read buffer still dispatch (the gate only stops
    // further reads), so the flags flip once the queue crosses the mark.
    expect(pausedFlags).toEqual([false, false, true, true, true, true, true, true]);

    const { promise: allReceived, resolve: resolveReceived, reject: rejectReceived } = Promise.withResolvers<void>();
    let received = "";
    let bytes = 0;
    socket.on("data", chunk => {
      bytes += chunk.length;
      received += chunk.toString("latin1");
      if (received.split("HTTP/1.1 200 OK").length - 1 === COUNT && bytes >= (COUNT - 1) * BODY.length) {
        resolveReceived();
      }
    });
    socket.on("close", () => rejectReceived(new Error("connection closed before every response arrived")));
    headRes.end("head");
    await allReceived;

    // The queue drained, so reads resumed (Node's socketOnDrain).
    expect(serverSocket._paused).toBe(false);
    socket.destroy();
  } finally {
    server.close();
  }
});

it("requireHostHeader still rejects Upgrade-carrying requests that dispatch as normal requests", async () => {
  // The native parser exempts Upgrade requests from the Host check so genuine
  // upgrades can reach the 'upgrade' event, but a request that falls through
  // to 'request' dispatch (no Connection: upgrade, or no 'upgrade' listener)
  // must still be rejected with 400 like Node.js.
  const server = createServer((req, res) => {
    res.end("handled");
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const out = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let data = "";
      socket.on("data", chunk => (data += chunk));
      socket.on("end", () => resolve(data));
      socket.on("error", reject);
      // Upgrade header present, no Connection: upgrade, no Host.
      socket.write("GET / HTTP/1.1\r\nUpgrade: websocket\r\n\r\n");
    });

    expect(out).toContain("400");
    expect(out).not.toContain("handled");
  } finally {
    server.close();
  }
});

it("close-delimited streaming writes carry raw bytes with no chunk framing artifacts", async () => {
  // Removing both framing headers makes the response close-delimited; a
  // streamed write must not inject the chunk-terminating CRLF into the body.
  const server = createServer((req, res) => {
    res.removeHeader("transfer-encoding");
    res.removeHeader("content-length");
    res.write("hello");
    res.end(" world");
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const out = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let data = "";
      socket.on("data", chunk => (data += chunk));
      // Close-delimited: the server closes the connection to end the body.
      socket.on("end", () => resolve(data));
      socket.on("error", reject);
      socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
    });

    const body = out.slice(out.indexOf("\r\n\r\n") + 4);
    expect(body).toBe("hello world");
    expect(out).not.toContain("Transfer-Encoding");
    expect(out).not.toContain("Content-Length");
  } finally {
    server.close();
  }
});

// A bare `new IncomingMessage(null)` has httpVersionMajor/Minor === null;
// `null < 1` is true, so the ServerResponse constructor's HTTP/1.0 branch
// (matching node v26.3.0 lib/_http_server.js L214) sets shouldKeepAlive=false
// and chunked off. The standalone-path tests below that exercise chunked
// output construct an HTTP/1.1 req like the vendored
// test-http-server-response-standalone.js does.
function http11Req() {
  const req = new IncomingMessage(null as any);
  req.httpVersionMajor = 1;
  req.httpVersionMinor = 1;
  return req;
}

it("standalone ServerResponse flushes the header block before a non-chunked Buffer body", async () => {
  // assignSocket() + explicit Content-Length + Buffer body: _send buffers the
  // rendered header in outputData; _writeRaw must flush it ahead of the body.
  const chunks: Buffer[] = [];
  const ws = new Writable({
    write(c, e, cb) {
      chunks.push(Buffer.from(c));
      cb();
    },
  });
  const res = new ServerResponse(new IncomingMessage(null as any));
  let sawPrefinish = false;
  res.on("prefinish", () => (sawPrefinish = true));
  res.assignSocket(ws);
  res.setHeader("Content-Length", "5");
  res.write(Buffer.from("hello"));
  res.end();
  await once(res, "finish");

  const out = Buffer.concat(chunks).toString();
  expect(out).toStartWith("HTTP/1.1 200 OK\r\n");
  expect(out).toContain("Content-Length: 5");
  expect(out).toEndWith("\r\n\r\nhello");
  // Node emits 'prefinish' when the assigned socket's _httpMessage is the
  // response (OutgoingMessage.end -> _finish()).
  expect(sawPrefinish).toBe(true);
});

it("standalone ServerResponse buffers writes made before assignSocket and flushes them on assignment", async () => {
  // Node.js buffers pre-assignSocket output in outputData (OutgoingMessage
  // _writeRaw with a null socket) and assignSocket() ends with _flush().
  const chunks: Buffer[] = [];
  const ws = new Writable({
    write(c, e, cb) {
      chunks.push(Buffer.from(c));
      cb();
    },
  });
  const res = new ServerResponse(http11Req());
  res.write("hello");
  res.assignSocket(ws);
  res.end();
  await once(res, "finish");

  const out = Buffer.concat(chunks).toString();
  expect(out).toStartWith("HTTP/1.1 200 OK\r\n");
  // No Content-Length was known at write() time, so the body is chunked.
  expect(out).toContain("Transfer-Encoding: chunked");
  expect(out).toContain("5\r\nhello\r\n");
  expect(out).toEndWith("0\r\n\r\n");
});

it("standalone ServerResponse discards body writes to a no-body response without throwing", async () => {
  // After writeHead(204) (_hasBody = false), Node.js silently ignores
  // write('body') and returns true; the no-handle delegation must pass the
  // original chunk through so write_()'s own discard handles it instead of
  // its chunk-type validation throwing on a cleared undefined chunk.
  const chunks: Buffer[] = [];
  const ws = new Writable({
    write(c, e, cb) {
      chunks.push(Buffer.from(c));
      cb();
    },
  });
  const res = new ServerResponse(new IncomingMessage(null as any));
  res.assignSocket(ws);
  res.writeHead(204);
  expect(res.write("body")).toBe(true);
  res.end();
  await once(res, "finish");

  const out = Buffer.concat(chunks).toString();
  expect(out).toStartWith("HTTP/1.1 204 No Content\r\n");
  expect(out).not.toContain("body");
});

it("flushHeaders on a 204 response carries no chunked framing", async () => {
  // noBodyStatus must suppress the Transfer-Encoding header in flushHeaders()
  // and the terminating chunk in internalEnd(), like the one-shot end() path.
  const server = createServer((req, res) => {
    if (req.url === "/nobody") {
      res.writeHead(204);
      res.flushHeaders();
      res.end();
    } else {
      res.writeHead(200);
      res.end("hello");
    }
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const out = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let data = "";
      let sentSecond = false;
      socket.on("data", chunk => {
        data += chunk;
        if (!sentSecond && data.includes("\r\n\r\n")) {
          sentSecond = true;
          socket.write("GET /second HTTP/1.1\r\nHost: localhost\r\n\r\n");
        }
        if (sentSecond && data.endsWith("hello")) {
          socket.end();
          resolve(data);
        }
      });
      socket.on("error", reject);
      socket.write("GET /nobody HTTP/1.1\r\nHost: localhost\r\n\r\n");
    });

    const first = out.slice(0, out.indexOf("HTTP/1.1 200"));
    expect(first).toContain("HTTP/1.1 204");
    expect(first).not.toContain("Transfer-Encoding");
    expect(first).not.toContain("0\r\n\r\n");
    // The keep-alive connection still serves the next request correctly.
    const second = out.slice(out.indexOf("HTTP/1.1 200"));
    expect(second).toContain("Content-Length: 5");
    expect(second).toEndWith("\r\n\r\nhello");
  } finally {
    server.close();
  }
});

it("standalone ServerResponse flushHeaders pushes the header block immediately", async () => {
  const chunks: Buffer[] = [];
  const ws = new Writable({
    write(c, e, cb) {
      chunks.push(Buffer.from(c));
      cb();
    },
  });
  const res = new ServerResponse(http11Req());
  res.assignSocket(ws);
  res.flushHeaders();

  // The header block reaches the socket before any body is written.
  const afterFlush = Buffer.concat(chunks).toString();
  expect(afterFlush).toStartWith("HTTP/1.1 200 OK\r\n");
  expect(afterFlush).toEndWith("\r\n\r\n");

  res.end("hi");
  await once(res, "finish");
  const out = Buffer.concat(chunks).toString();
  // The body follows without re-sending the header.
  expect(out.indexOf("HTTP/1.1 200 OK")).toBe(out.lastIndexOf("HTTP/1.1 200 OK"));
  expect(out).toContain("2\r\nhi\r\n0\r\n\r\n");
});

it("caches the target's TLS session for proxy-tunneled https requests", async () => {
  // The 'session' listener must be on the tunneled target socket, not the
  // proxy connection: a plain HTTP proxy socket never emits 'session', so
  // pre-fix the cache stayed empty (and an HTTPS proxy cached its own
  // session under the target's key).
  const target = createHttpsServer({ key: tlsCert.key, cert: tlsCert.cert }, (req, res) => {
    res.end("ok");
  });
  let connectSeen = false;
  const proxy = createServer();
  proxy.on("connect", (req, clientSocket, head) => {
    connectSeen = true;
    const [host, port] = (req.url as string).split(":");
    const serverSocket = connect(Number(port), host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });
    serverSocket.on("error", () => clientSocket.end());
  });
  try {
    target.listen(0, "127.0.0.1");
    await once(target, "listening");
    const targetPort = (target.address() as AddressInfo).port;
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    const proxyPort = (proxy.address() as AddressInfo).port;

    const agent = new https.Agent({
      proxyEnv: { HTTPS_PROXY: `http://127.0.0.1:${proxyPort}` },
      maxCachedSessions: 10,
    });

    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const req = https.request(
      { host: "127.0.0.1", port: targetPort, path: "/", agent, rejectUnauthorized: false },
      res => {
        res.resume();
        res.on("end", resolve);
      },
    );
    req.on("error", reject);
    req.end();
    await promise;
    // The caching listener must sit on the tunneled target socket (pre-fix
    // it sat on the proxy connection, which never emits 'session' for an
    // HTTP proxy, so the cache stayed empty forever). The target's TLS 1.3
    // ticket arrives asynchronously with the first data flight - await the
    // cache filling with the real session.
    while ((agent as any)._sessionCache.list.length === 0) {
      await Bun.sleep(10);
    }

    expect(connectSeen).toBe(true);
    agent.destroy();
  } finally {
    proxy.close();
    target.close();
  }
});

it("standalone ServerResponse answers 204 + explicit chunked TE with Connection: close", async () => {
  // _storeHeader's 204/304 handling clears chunkedEncoding and sets
  // shouldKeepAlive = false; the latter needs real storage on ServerResponse
  // so the rendered header is Connection: close like Node.js.
  const chunks: Buffer[] = [];
  const ws = new Writable({
    write(c, e, cb) {
      chunks.push(Buffer.from(c));
      cb();
    },
  });
  const res = new ServerResponse(new IncomingMessage(null as any));
  res.assignSocket(ws);
  res.setHeader("Transfer-Encoding", "chunked");
  res.writeHead(204);
  res.end();
  await once(res, "finish");

  const out = Buffer.concat(chunks).toString();
  expect(out).toStartWith("HTTP/1.1 204 No Content\r\n");
  expect(out).toContain("Connection: close");
  expect(out).not.toContain("keep-alive");
  // chunkedEncoding was cleared, so no terminating chunk is emitted.
  expect(out).toEndWith("\r\n\r\n");
});

it("removing transfer-encoding on a HEAD response keeps the connection alive", async () => {
  // _hasBody === false means there is no body to close-delimit; Node leaves
  // the connection open (its _storeHeader checks !_hasBody first).
  const server = createServer((req, res) => {
    res.removeHeader("transfer-encoding");
    res.end("hello");
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const out = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let data = "";
      let sentSecond = false;
      socket.on("data", chunk => {
        data += chunk;
        if (!sentSecond && data.includes("\r\n\r\n")) {
          sentSecond = true;
          // The connection must still be usable for a normal GET.
          socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
        }
        if (sentSecond && data.endsWith("hello")) {
          socket.end();
          resolve(data);
        }
      });
      socket.on("error", reject);
      socket.write("HEAD / HTTP/1.1\r\nHost: localhost\r\n\r\n");
    });

    const first = out.slice(0, out.indexOf("HTTP/1.1 200", 10));
    expect(first).toContain("Connection: keep-alive");
    expect(first).not.toContain("Connection: close");
    expect(out).toEndWith("\r\n\r\nhello");
  } finally {
    server.close();
  }
});

it("clientError after a kept-alive request reuses the connection's socket and untracks it on close", async () => {
  // The native side returns the existing handle for parser errors on a
  // connection that already served a request; wrapping it again stranded the
  // first Duplex in the tracked-connections set and re-emitted 'connection'.
  let connectionEvents = 0;
  let connectionSocket: any;
  let clientErrorSocket: any;
  const { promise: errored, resolve: onErrored } = Promise.withResolvers<void>();
  const server = createServer((req, res) => {
    res.end("ok");
  });
  server.on("connection", s => {
    connectionEvents++;
    connectionSocket = s;
  });
  server.on("clientError", (err, s) => {
    clientErrorSocket = s;
    s.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    onErrored();
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const socket = connect(port, "127.0.0.1");
    const closed = new Promise<void>(r => socket.on("close", () => r()));
    let sentGarbage = false;
    socket.on("data", chunk => {
      if (!sentGarbage && chunk.toString().includes("ok")) {
        sentGarbage = true;
        socket.write("!!!\r\n\r\n");
      }
    });
    socket.on("error", () => {});
    socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
    await errored;

    expect(connectionEvents).toBe(1);
    expect(clientErrorSocket).toBe(connectionSocket);

    await closed;
    // The lone Duplex untracks itself; getConnections drains to zero.
    while ((await new Promise<number>(r => server.getConnections((e, c) => r(c)))) !== 0) {
      await Bun.sleep(10);
    }
  } finally {
    server.close();
  }
});

describe("malformed request line reaches 'connection' and 'clientError' with a writable socket", () => {
  it.each([
    ["method token followed by CRLF", "BOGUS\r\n\r\n"],
    ["known method followed by CRLF", "GET\r\n\r\n"],
    ["CONNECT followed by CRLF", "CONNECT\r\n\r\n"],
    ["CONNECT-prefixed token followed by CRLF", "CONNECTX\r\n\r\n"],
    ["single method char followed by CRLF", "G\r\n\r\n"],
    ["single method char with full line", "G / HTTP/1.1\r\nHost: localhost\r\n\r\n"],
  ])("%s", async (_name, payload) => {
    const events: string[] = [];
    const { promise: errored, resolve: onErrored, reject: onErroredFail } = Promise.withResolvers<void>();
    const server = createServer((req, res) => {
      events.push("request");
      res.end("should not reach here");
      onErroredFail(new Error("unexpected request"));
    });
    server.on("connection", () => events.push("connection"));
    server.on("clientError", (err: any, s) => {
      events.push("clientError " + err.code);
      try {
        expect(s.writable).toBe(true);
        expect(s.destroyed).toBe(false);
        expect(err.rawPacket).toEqual(Buffer.from(payload));
      } catch (e) {
        onErroredFail(e);
        return;
      }
      s.end("HTTP/1.1 418 I'm a teapot\r\nConnection: close\r\n\r\n");
      onErrored();
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { port } = server.address() as AddressInfo;

      const socket = connect(port, "127.0.0.1");
      let wire = "";
      socket.on("data", d => (wire += d));
      socket.on("error", () => {});
      const closed = new Promise<void>(r => socket.on("close", () => r()));
      await once(socket, "connect");
      socket.write(payload);

      await errored;
      await closed;

      expect(events).toEqual(["connection", "clientError HPE_INVALID_METHOD"]);
      expect(wire).toContain("HTTP/1.1 418");
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });

  it("a method fragmented across writes still parses", async () => {
    const events: string[] = [];
    const { promise: gotRequest, resolve: onRequest, reject: onRequestFail } = Promise.withResolvers<void>();
    const server = createServer((req, res) => {
      events.push("request " + req.method + " " + req.url);
      res.end("ok");
      onRequest();
    });
    server.on("connection", () => events.push("connection"));
    server.on("clientError", (err: any, s) => {
      s.destroy();
      onRequestFail(new Error("unexpected clientError " + err.code));
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { port } = server.address() as AddressInfo;

      const socket = connect(port, "127.0.0.1");
      socket.setNoDelay(true);
      socket.on("error", () => {});
      await once(socket, "connect");
      socket.write("GE");
      await new Promise(r => setImmediate(r));
      socket.write("T /path HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");

      await gotRequest;
      socket.end();
      expect(events).toEqual(["connection", "request GET /path"]);
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });

  // Node accepts some of these (asterisk-form, HTTP/0.9) and fires 'request';
  // Bun rejects them and fires 'clientError'. Either is observable. The bug
  // was that the parser returned short-read on complete input and nothing
  // surfaced at all while the connection sat idle.
  it.each([
    ["target followed by CRLF with no HTTP version", "GET /\r\nHost: localhost\r\n\r\n"],
    ["asterisk target followed by CRLF", "GET *\r\n\r\n"],
    ["asterisk target after a 7-char method", "OPTIONS *\r\n\r\n"],
    ["short non-origin target followed by CRLF", "POST x\r\n\r\n"],
  ])("%s surfaces to JS", async (_name, payload) => {
    const events: string[] = [];
    const { promise: surfaced, resolve: onSurfaced } = Promise.withResolvers<void>();
    const server = createServer((req, res) => {
      events.push("request");
      res.end("ok");
      onSurfaced();
    });
    server.on("connection", () => events.push("connection"));
    server.on("clientError", (err: any, s) => {
      events.push("clientError");
      s.destroy();
      onSurfaced();
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { port } = server.address() as AddressInfo;

      const socket = connect(port, "127.0.0.1");
      socket.on("error", () => {});
      await once(socket, "connect");
      socket.write(payload);

      await surfaced;
      expect(events[0]).toBe("connection");
      expect(["request", "clientError"]).toContain(events[1]);
      socket.destroy();
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });
});

it("req.upgrade reflects the upgrade dispatch decision like Node.js", async () => {
  // true inside the 'upgrade' listener; false for an Upgrade-carrying request
  // that falls through to 'request' (no Connection: upgrade token here).
  let upgradeValue: unknown = "unset";
  let requestValue: unknown = "unset";
  const { promise: sawUpgrade, resolve: onUpgrade } = Promise.withResolvers<void>();
  const { promise: sawRequest, resolve: onRequest } = Promise.withResolvers<void>();
  const server = createServer((req, res) => {
    requestValue = req.upgrade;
    res.end("ok");
    onRequest();
  });
  server.on("upgrade", (req, socket) => {
    upgradeValue = req.upgrade;
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    onUpgrade();
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const s1 = connect(port, "127.0.0.1");
    s1.on("error", () => {});
    s1.write("GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: upgrade\r\n\r\n");
    await sawUpgrade;
    s1.destroy();
    expect(upgradeValue).toBe(true);

    const s2 = connect(port, "127.0.0.1");
    s2.on("error", () => {});
    // Upgrade header without the Connection: upgrade token: normal dispatch.
    s2.write("GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\n\r\n");
    await sawRequest;
    s2.destroy();
    expect(requestValue).toBe(false);
  } finally {
    server.close();
  }
});

it("standalone ServerResponse end() honors rejectNonStandardBodyWrites for no-body responses", async () => {
  // Mirrors the write() fix: the original chunk must reach write_()'s
  // !_hasBody handling so the reject option throws like Node.js.
  const ws = new Writable({
    write(c, e, cb) {
      cb();
    },
  });
  const res = new ServerResponse({ method: "HEAD" } as any, { rejectNonStandardBodyWrites: true } as any);
  res.assignSocket(ws);
  expect(() => res.end("body")).toThrow(
    expect.objectContaining({
      code: "ERR_HTTP_BODY_NOT_ALLOWED",
    }),
  );
  ws.destroy();
});

it("HEAD response with explicit writeHead(200) carries no body bytes", async () => {
  // writeHead() must not reset _hasBody for a HEAD request (Node only ever
  // clears it); pre-fix the body bytes leaked onto the wire.
  const server = createServer((req, res) => {
    res.writeHead(200);
    res.end("hello");
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const out = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let data = "";
      let sentSecond = false;
      socket.on("data", chunk => {
        data += chunk;
        if (!sentSecond && data.includes("\r\n\r\n")) {
          sentSecond = true;
          socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
        }
        if (sentSecond && data.endsWith("hello")) {
          socket.end();
          resolve(data);
        }
      });
      socket.on("error", reject);
      socket.write("HEAD / HTTP/1.1\r\nHost: x\r\n\r\n");
    });

    const first = out.slice(0, out.indexOf("HTTP/1.1 200", 10));
    expect(first).toStartWith("HTTP/1.1 200");
    // No body on the HEAD response; the GET on the same connection has one.
    expect(first).toEndWith("\r\n\r\n");
    expect(out).toEndWith("\r\n\r\nhello");
  } finally {
    server.close();
  }
});

it("standalone ServerResponse writeContinue reaches the assigned socket", async () => {
  // writeContinue must route through _writeRaw on the no-handle path like
  // its writeProcessing/writeEarlyHints siblings (pre-fix it was a no-op).
  const chunks: Buffer[] = [];
  const ws = new Writable({
    write(c, e, cb) {
      chunks.push(Buffer.from(c));
      cb();
    },
  });
  const res = new ServerResponse(new IncomingMessage(null as any));
  res.assignSocket(ws);
  res.writeContinue();
  expect(Buffer.concat(chunks).toString()).toBe("HTTP/1.1 100 Continue\r\n\r\n");
  expect(res._sent100).toBe(true);

  res.end("hello");
  await once(res, "finish");
  const out = Buffer.concat(chunks).toString();
  expect(out).toStartWith("HTTP/1.1 100 Continue\r\n\r\n");
  expect(out).toContain("HTTP/1.1 200 OK\r\n");
  expect(out.indexOf("HTTP/1.1 200 OK")).toBeGreaterThan(out.indexOf("100 Continue"));
});

it("HEAD response with explicit chunked TE carries no terminating chunk", async () => {
  // RFC 9112 6.3: a HEAD response terminates at the first empty line
  // whatever framing headers it advertises; a 0\r\n\r\n terminator would be
  // parsed as the start of the next response on the keep-alive connection.
  const server = createServer((req, res) => {
    if (req.method === "HEAD") {
      res.setHeader("Transfer-Encoding", "chunked");
      res.end("hello");
    } else {
      res.end("world");
    }
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const out = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let data = "";
      let sentSecond = false;
      socket.on("data", chunk => {
        data += chunk;
        if (!sentSecond && data.includes("\r\n\r\n")) {
          sentSecond = true;
          socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
        }
        if (sentSecond && data.endsWith("world")) {
          socket.end();
          resolve(data);
        }
      });
      socket.on("error", reject);
      socket.write("HEAD / HTTP/1.1\r\nHost: x\r\n\r\n");
    });

    const first = out.slice(0, out.indexOf("HTTP/1.1 200", 10));
    expect(first).toContain("Transfer-Encoding: chunked");
    // Headers only - no terminating chunk after the empty line.
    expect(first).toEndWith("\r\n\r\n");
    expect(first).not.toContain("0\r\n\r\n");
    // The keep-alive connection still parses the next response.
    expect(out).toEndWith("\r\n\r\nworld");
  } finally {
    server.close();
  }
});

// https://github.com/oven-sh/bun/issues/34158
it("server.close(cb) completes after a raw upgrade once both sockets are destroyed", async () => {
  // Node v26.3.0 contract (verified): after the 'upgrade' handoff, destroying
  // both ends of the tunneled connection lets server.close(cb) fire promptly.
  const server = createServer();
  let serverSocket: import("node:net").Socket;
  server.on("upgrade", (req, socket) => {
    serverSocket = socket;
    socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: WebSocket\r\n\r\n");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const request = http.get({
    host: "127.0.0.1",
    port,
    headers: { Connection: "Upgrade", Upgrade: "WebSocket" },
  });
  request.on("error", () => {});
  const [, clientSocket] = (await once(request, "upgrade")) as [unknown, import("node:net").Socket];

  clientSocket.destroy();
  serverSocket!.destroy();
  const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
  server.close(() => onClosed());
  await closed;
});

it("req.upgrade is true inside the 'connect' listener", async () => {
  let upgradeValue: unknown = "unset";
  const { promise: sawConnect, resolve: onConnect } = Promise.withResolvers<void>();
  const server = createServer((req, res) => res.end("ok"));
  server.on("connect", (req, socket) => {
    upgradeValue = req.upgrade;
    socket.end("HTTP/1.1 200 Connection Established\r\n\r\n");
    onConnect();
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const socket = connect(port, "127.0.0.1");
    socket.on("error", () => {});
    socket.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n");
    await sawConnect;
    socket.destroy();
    expect(upgradeValue).toBe(true);
  } finally {
    server.close();
  }
});

it("plain HEAD with flushHeaders carries no auto-chunked framing", async () => {
  // No explicit framing headers: the native flushHeaders must not enter
  // chunked mode for a HEAD response, and end() must not write a terminator.
  const server = createServer((req, res) => {
    if (req.method === "HEAD") {
      res.flushHeaders();
      res.end();
    } else {
      res.end("world");
    }
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const out = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let data = "";
      let sentSecond = false;
      socket.on("data", chunk => {
        data += chunk;
        if (!sentSecond && data.includes("\r\n\r\n")) {
          sentSecond = true;
          socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
        }
        if (sentSecond && data.endsWith("world")) {
          socket.end();
          resolve(data);
        }
      });
      socket.on("error", reject);
      socket.write("HEAD / HTTP/1.1\r\nHost: x\r\n\r\n");
    });

    const first = out.slice(0, out.indexOf("HTTP/1.1 200", 10));
    expect(first).not.toContain("Transfer-Encoding");
    expect(first).toEndWith("\r\n\r\n");
    expect(first).not.toContain("0\r\n\r\n");
    // The keep-alive connection still parses the next response.
    expect(out).toEndWith("\r\n\r\nworld");
  } finally {
    server.close();
  }
});

it("statusCode = 204 with a streamed write carries no body framing", async () => {
  // Without writeHead(), the implicit-header path must still derive _hasBody
  // from the status code before the body-discard check, like Node's
  // _implicitHeader ordering - otherwise the chunk reaches the wire
  // chunk-framed with no terminator.
  const server = createServer((req, res) => {
    if (req.url === "/nobody") {
      res.statusCode = 204;
      res.write("hello");
      res.end();
    } else {
      res.end("world");
    }
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const out = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let data = "";
      let sentSecond = false;
      socket.on("data", chunk => {
        data += chunk;
        if (!sentSecond && data.includes("\r\n\r\n")) {
          sentSecond = true;
          socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
        }
        if (sentSecond && data.endsWith("world")) {
          socket.end();
          resolve(data);
        }
      });
      socket.on("error", reject);
      socket.write("GET /nobody HTTP/1.1\r\nHost: x\r\n\r\n");
    });

    const first = out.slice(0, out.indexOf("HTTP/1.1 200", 10));
    expect(first).toContain("HTTP/1.1 204");
    expect(first).not.toContain("Transfer-Encoding");
    expect(first).not.toContain("hello");
    expect(first).toEndWith("\r\n\r\n");
    expect(out).toEndWith("\r\n\r\nworld");
  } finally {
    server.close();
  }
});

it("no 'drain' is emitted for accounting flushed after the response finished", async () => {
  let drains = 0;
  const { promise: handled, resolve: onHandled } = Promise.withResolvers<boolean>();
  const server = createServer((req, res) => {
    res.on("drain", () => drains++);
    const ret = res.write(Buffer.alloc(res.writableHighWaterMark + 100));
    res.end();
    onHandled(ret);
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/`);
    await res.arrayBuffer();
    const ret = await handled;
    // The write crossed the high-water mark...
    expect(ret).toBe(false);
    // ...but the pending accounting flush must not emit 'drain' on a
    // response that already finished (matching writableNeedDrain and
    // Node's socketOnDrain gating).
    await new Promise<void>(r => process.nextTick(r));
    expect(drains).toBe(0);
  } finally {
    server.close();
  }
});

it("registering 'keylog' on an agent with live sockets does not throw", async () => {
  const server = createServer((req, res) => res.end("ok"));
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const agent = new Agent({ keepAlive: true });
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const req = http.request({ host: "127.0.0.1", port, path: "/", agent }, res => {
      // agent.sockets is populated while the request is in flight; the
      // newListener hook must flatten the socket arrays instead of calling
      // .on() on them.
      expect(() => agent.on("keylog", () => {})).not.toThrow();
      res.resume();
      res.on("end", resolve);
    });
    req.on("error", reject);
    req.end();
    await promise;
    agent.destroy();
  } finally {
    server.close();
  }
});

it("statusCode = 204 with an empty first write still discards the body", async () => {
  // write("") flips the header state without a chunk; the _hasBody
  // derivation must run unconditionally (like Node's _implicitHeader) so
  // the later body write is still discarded.
  const server = createServer((req, res) => {
    if (req.url === "/nobody") {
      res.statusCode = 204;
      res.write("");
      res.write("hello");
      res.end();
    } else {
      res.end("world");
    }
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const out = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let data = "";
      let sentSecond = false;
      socket.on("data", chunk => {
        data += chunk;
        if (!sentSecond && data.includes("\r\n\r\n")) {
          sentSecond = true;
          socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
        }
        if (sentSecond && data.endsWith("world")) {
          socket.end();
          resolve(data);
        }
      });
      socket.on("error", reject);
      socket.write("GET /nobody HTTP/1.1\r\nHost: x\r\n\r\n");
    });

    const first = out.slice(0, out.indexOf("HTTP/1.1 200", 10));
    expect(first).toContain("HTTP/1.1 204");
    expect(first).not.toContain("Transfer-Encoding");
    expect(first).not.toContain("hello");
    expect(first).toEndWith("\r\n\r\n");
    expect(out).toEndWith("\r\n\r\nworld");
  } finally {
    server.close();
  }
});

it("res.shouldKeepAlive = false renders Connection: close and ends the socket", async () => {
  // Graceful-shutdown helpers (stoppable, http-terminator) clear
  // shouldKeepAlive on in-flight responses; the rendered header and the
  // transport must follow it like Node's shouldSendKeepAlive/_last.
  const server = createServer((req, res) => {
    res.shouldKeepAlive = false;
    res.end("ok");
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const out = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let data = "";
      socket.on("data", chunk => (data += chunk));
      // The server must send FIN on its own; the client never half-closes.
      socket.on("end", () => resolve(data));
      socket.on("error", reject);
      socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
    });

    expect(out).toContain("Connection: close");
    expect(out).not.toContain("keep-alive");
    expect(out).toEndWith("ok");
  } finally {
    server.close();
  }
});

it("removeHeader('connection') with shouldKeepAlive = false still closes the socket on finish", async () => {
  // Node's _storeHeader handles _removedConnection before the auto-header
  // branch: no Connection header is written, but _last = !shouldKeepAlive
  // still ends the socket.
  const server = createServer((req, res) => {
    res.removeHeader("connection");
    res.shouldKeepAlive = false;
    res.end("ok");
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const out = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let data = "";
      socket.on("data", chunk => (data += chunk));
      // The server must send FIN on its own; the client never half-closes.
      socket.on("end", () => resolve(data));
      socket.on("error", reject);
      socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
    });

    expect(out).not.toContain("Connection:");
    expect(out).toEndWith("ok");
  } finally {
    server.close();
  }
});

it("Expect: 100-Continue matches case-insensitively like Node.js", async () => {
  // RFC 7231 5.1.1: expectation values compare case-insensitively; Node
  // uses /(?:^|\W)100-continue(?:$|\W)/i, not strict equality.
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => res.end("done"));
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const out = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let data = "";
      let sentBody = false;
      socket.on("data", chunk => {
        data += chunk;
        if (!sentBody && data.includes("100 Continue")) {
          sentBody = true;
          socket.write("hello");
        }
        if (data.endsWith("done")) {
          socket.end();
          resolve(data);
        }
      });
      socket.on("error", reject);
      socket.write("POST / HTTP/1.1\r\nHost: x\r\nExpect: 100-Continue\r\nContent-Length: 5\r\n\r\n");
    });

    expect(out).toContain("HTTP/1.1 100 Continue");
    expect(out).not.toContain("417");
    expect(out).toEndWith("done");
  } finally {
    server.close();
  }
});

it("the over-limit 503 advertises Connection: close, not keep-alive", async () => {
  // Node sets maxRequestsOnConnectionReached unconditionally
  // (maxRequestsPerSocket <= count), so the dropRequest 503 carries
  // Connection: close instead of advertising keep-alive right before the
  // socket is destroyed.
  const server = createServer((req, res) => res.end("ok"));
  server.maxRequestsPerSocket = 1;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const out = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let data = "";
      socket.on("data", chunk => (data += chunk));
      socket.on("close", () => resolve(data));
      socket.on("error", reject);
      // Two pipelined requests: the second exceeds maxRequestsPerSocket.
      socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n" + "GET / HTTP/1.1\r\nHost: x\r\n\r\n");
    });

    const second = out.slice(out.indexOf("HTTP/1.1 503"));
    expect(second).toContain("HTTP/1.1 503");
    expect(second).toContain("Connection: close");
    expect(second).not.toContain("keep-alive");
  } finally {
    server.close();
  }
});

it("a non-200 CONNECT through a proxy that holds the connection open is destroyed client-side", async () => {
  // cleanupAndPropagate deliberately defers destroy to req.onSocket for
  // status-code tunnel failures; oncreate must forward the socket so
  // onSocketNT actually destroys it - otherwise the proxy connection leaks
  // until the proxy closes its side.
  const proxySockets: import("node:net").Socket[] = [];
  const proxy = createNetServer(socket => {
    proxySockets.push(socket);
    socket.on("error", () => {});
    // Reply 407 and HOLD the connection open (no end()).
    socket.once("data", () => {
      socket.write("HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n");
    });
  });
  try {
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    const proxyPort = (proxy.address() as AddressInfo).port;

    const agent = new https.Agent({ proxyEnv: { HTTPS_PROXY: `http://127.0.0.1:${proxyPort}` } });
    const { promise: errored, resolve: onError } = Promise.withResolvers<any>();
    const req = https.request({ host: "example.com", port: 443, path: "/", agent }, () => {});
    req.on("error", onError);
    req.end();

    const err = await errored;
    expect(err.code).toBe("ERR_PROXY_TUNNEL");
    expect(err.statusCode).toBe(407);
    // The client must close its end despite the proxy holding the socket.
    expect(proxySockets.length).toBe(1);
    await once(proxySockets[0], "close");
    agent.destroy();
  } finally {
    for (const s of proxySockets) s.destroy();
    proxy.close();
  }
});

// Node.js v26 removed res.writeHeader (DEP0063 end-of-life, nodejs/node#60635).
it("ServerResponse.prototype.writeHeader was removed (DEP0063 EOL)", () => {
  expect("writeHeader" in ServerResponse.prototype).toBe(false);
});

it("setHeaders stores an empty set-cookie array (nodejs/node#59734)", () => {
  const msg = new OutgoingMessage();
  msg.setHeaders(new Map([["set-cookie", []]]));
  expect(msg.getHeader("set-cookie")).toEqual([]);
  expect(msg.hasHeader("set-cookie")).toBe(true);
  expect(msg.getHeaders()["set-cookie"]).toEqual([]);
  expect(msg.getHeaderNames()).toContain("set-cookie");
  expect(msg.getRawHeaderNames()).toContain("set-cookie");
  msg.removeHeader("set-cookie");
  expect(msg.getHeader("set-cookie")).toBeUndefined();
  expect(msg.hasHeader("set-cookie")).toBe(false);

  // Headers without a set-cookie entry never call setHeader("set-cookie", ...)
  const msg2 = new OutgoingMessage();
  msg2.setHeaders(new Map([["x-test", "1"]]));
  expect(msg2.getHeader("set-cookie")).toBeUndefined();
  expect(msg2.getHeader("x-test")).toBe("1");

  // getRawHeaderNames preserves the original casing, like Node.
  const msg3 = new OutgoingMessage();
  msg3.setHeader("Set-Cookie", []);
  expect(msg3.getRawHeaderNames()).toEqual(["Set-Cookie"]);
  expect(msg3.getHeaderNames()).toEqual(["set-cookie"]);

  // Appending a cookie supersedes the present-but-empty array (no duplicate
  // name in getRawHeaderNames, value visible everywhere).
  msg3.appendHeader("Set-Cookie", "a=1");
  expect(msg3.getHeader("set-cookie")).toEqual(["a=1"]);
  expect(msg3.getRawHeaderNames().filter(n => n.toLowerCase() === "set-cookie")).toHaveLength(1);
  expect(msg3.getHeaders()["set-cookie"]).toEqual(["a=1"]);
});

it("https.Agent applies defaultPort/protocol through options (nodejs/node#58980)", () => {
  const a = new https.Agent();
  try {
    expect(a.defaultPort).toBe(443);
    expect(a.protocol).toBe("https:");
    // v26 sets the defaults on the (null-prototype) options object before
    // calling the base constructor.
    expect(a.options.defaultPort).toBe(443);
    expect(a.options.protocol).toBe("https:");
    expect(Object.getPrototypeOf(a.options)).toBe(null);
  } finally {
    a.destroy();
  }

  const b = new https.Agent({ defaultPort: 8443 });
  try {
    expect(b.defaultPort).toBe(8443);
    expect(b.protocol).toBe("https:");
  } finally {
    b.destroy();
  }
});

it("upgrade request with no 'upgrade' listener falls through to 'request'", async () => {
  // Mirrors Node.js behavior (see Node's _http_server.js shouldUpgradeCallback
  // default): when the server has no 'upgrade' listener, an Upgrade request is
  // handled as a regular request instead of disappearing.
  const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("regular response");
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const result = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1", () => {
        socket.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
      });
      let data = "";
      socket.setEncoding("utf8");
      socket.on("data", chunk => {
        data += chunk;
        if (data.includes("regular response")) {
          socket.destroy();
          resolve(data);
        }
      });
      socket.on("error", reject);
      socket.on("close", () => resolve(data));
    });

    expect(result).toContain("HTTP/1.1 200");
    expect(result).toContain("regular response");
  } finally {
    server.close();
  }
});

it("ServerResponse does not emit 'drain' after a successful (non-backpressured) write", async () => {
  // Node.js only emits 'drain' after a write() that returned false.
  let drains = 0;
  let writeReturned: boolean | undefined;
  const server = createServer((req, res) => {
    res.on("drain", () => drains++);
    writeReturned = res.write("hello");
    // Give a synchronously-emitted 'drain' a chance to fire before ending.
    process.nextTick(() => {
      res.end(" world");
    });
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const body = await new Promise<string>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port }, res => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", chunk => (data += chunk));
        res.on("end", () => resolve(data));
      });
      req.on("error", reject);
      req.end();
    });

    expect(body).toBe("hello world");
    expect(writeReturned).toBe(true);
    expect(drains).toBe(0);
  } finally {
    server.close();
  }
});

it("https.Agent.prototype.createConnection creates a TLS connection", async () => {
  expect(typeof https.Agent.prototype.createConnection).toBe("function");

  const server = createHttpsServer({ key: tlsCert.key, cert: tlsCert.cert }, (req, res) => {
    res.end("secure");
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const socket: any = https.globalAgent.createConnection({
      host: "127.0.0.1",
      port,
      rejectUnauthorized: false,
    });
    try {
      await once(socket, "secureConnect");
      // It's a TLS socket, not a plain net.Socket.
      expect(socket.encrypted).toBe(true);
    } finally {
      socket.destroy();
    }
  } finally {
    server.close();
  }
});

it("http.Agent with proxyEnv does not write to a literal 'undefined' property", () => {
  // Regression: the kProxyConfig symbol destructured from internal/http was
  // undefined, so the proxy config was stored as agent["undefined"].
  const agent = new Agent({ proxyEnv: { http_proxy: "http://localhost:4873" } } as any);
  try {
    expect(Object.hasOwn(agent, "undefined")).toBe(false);
  } finally {
    agent.destroy();
  }
});

it("OutgoingMessage outputData is per-instance and _flushOutput is defined", () => {
  expect(typeof OutgoingMessage.prototype._flushOutput).toBe("function");

  const a = new OutgoingMessage();
  const b = new OutgoingMessage();
  expect(a.outputData).not.toBe(b.outputData);

  // Buffered writes on one message must not leak into other instances
  // (outputData used to be a shared array on the prototype).
  a.outputData.push({ data: "x", encoding: "utf8", callback: null });
  expect(a.outputData.length).toBe(1);
  expect(b.outputData.length).toBe(0);
  expect(new OutgoingMessage().outputData.length).toBe(0);

  // Like Node, the prototype has no outputData property at all; reading it off
  // the prototype must not materialize shared state on the prototype.
  expect(Object.getOwnPropertyDescriptor(OutgoingMessage.prototype, "outputData")).toBeUndefined();
  void (OutgoingMessage.prototype as any).outputData;
  const c = new OutgoingMessage();
  const d = new OutgoingMessage();
  c.outputData.push({ data: "y", encoding: "utf8", callback: null });
  expect(d.outputData.length).toBe(0);
});

// In Node.js res.write() and req.socket.write() land on the same net.Socket
// Writable, so raw bytes written between framework writes appear on the wire in
// call order. Bun routed req.socket.write() straight to the fd while the
// response head sat in a cork buffer, so the raw bytes would overtake the
// status line and the client parsed a garbage "RAWHTTP/1.1 200 OK".
describe("req.socket.write() interleaved with res.write()", () => {
  async function readWire(handler: http.RequestListener) {
    const server = createServer(handler);
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      const { port } = server.address() as AddressInfo;
      const c = connect(port, "127.0.0.1");
      await once(c, "connect");
      const chunks: Buffer[] = [];
      c.on("data", d => chunks.push(d));
      c.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
      await once(c, "close");
      const all = Buffer.concat(chunks);
      const headEnd = all.indexOf("\r\n\r\n");
      return { status: all.subarray(0, all.indexOf("\r\n")).toString(), body: all.subarray(headEnd + 4) };
    } finally {
      server.close();
    }
  }

  it.each([true, false])("reaches the wire after the response head and in call order (flushHeaders=%p)", async flush => {
    const { status, body } = await readWire((req, res) => {
      res.setHeader("Content-Length", "9");
      if (flush) res.flushHeaders();
      res.write("AAA");
      req.socket.write("RAW");
      res.write("BBB");
      res.end();
    });
    expect(status).toBe("HTTP/1.1 200 OK");
    expect(body.toString()).toBe("AAARAWBBB");
  });

  // A >16KB res.write() takes the zero-copy path (the unwritten tail is held
  // in NodeHTTPResponse::pending_pinned_write, not the cork or AsyncSocket
  // buffers); the raw write must still land after that tail, not mid-body.
  it("is ordered after a >16KB res.write()'s zero-copy tail", async () => {
    const BIG = Buffer.alloc(16 * 1024 * 1024, 0x61);
    const { status, body } = await readWire((req, res) => {
      res.setHeader("Content-Length", String(BIG.length + 6));
      res.write(BIG);
      req.socket.write("RAW");
      res.end("BBB");
    });
    expect(status).toBe("HTTP/1.1 200 OK");
    expect(body.length).toBe(BIG.length + 6);
    // The first non-'a' byte is where RAW starts: must be at BIG.length,
    // not at the kernel send-buffer boundary.
    let i = 0;
    while (i < body.length && body[i] === 0x61) i++;
    expect({ firstNonA: i, tail: body.subarray(i).toString() }).toEqual({
      firstNonA: BIG.length,
      tail: "RAWBBB",
    });
  });

  it("socket.end() after a >16KB res.write() delivers the full body before FIN", async () => {
    const BIG = Buffer.alloc(8 * 1024 * 1024, 0x61);
    const { status, body } = await readWire((req, res) => {
      res.writeHead(200, { "Content-Length": String(BIG.length) });
      res.write(BIG);
      req.socket.end();
    });
    expect(status).toBe("HTTP/1.1 200 OK");
    expect(body.length).toBe(BIG.length);
  });
});
