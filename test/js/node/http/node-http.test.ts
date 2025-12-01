/**
 * All new tests in this file should also run in Node.js.
 *
 * Do not add any tests that only run in Bun.
 *
 * A handful of older tests do not run in Node in this file. These tests should be updated to run in Node, or deleted.
 */
import { bunEnv, bunExe, exampleSite, randomPort } from "harness";
import { createTest } from "node-harness";
import { EventEmitter, once } from "node:events";
import nodefs, { unlinkSync } from "node:fs";
import http, {
  Agent,
  createServer,
  get,
  globalAgent,
  OutgoingMessage,
  request,
  Server,
  ServerResponse,
  validateHeaderName,
  validateHeaderValue,
} from "node:http";
import https, { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
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

        get(`http://${server_host}:${server_port}`, { signal }, res => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", chunk => {
            data += chunk;
          });
          res.on("end", () => {
            server.close();
          });
        }).once("abort", () => {
          resolveClientAbort();
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
    const { promise, resolve } = Promise.withResolvers();
    https
      .request("https://bun.sh/", { headers: { "accept-encoding": "gzip" } }, res => {
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

  // Test Suites

  describe("Header Injection Protection", () => {
    test("rejects requests with CR in header field name", async () => {
      const mockHandler = createMockHandler();
      server.on("request", mockHandler);
      const { promise, resolve, reject } = Promise.withResolvers();
      server.on("clientError", (err: any) => {
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
      server.on("clientError", (err: any) => {
        try {
          expect(err.code).toBe("HPE_INTERNAL");
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
      server.on("clientError", (err: any) => {
        try {
          expect(err.code).toBe("HPE_INTERNAL");
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
      server.on("clientError", (err: any) => {
        try {
          expect(err.code).toBe("HPE_INTERNAL");
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
      server.on("clientError", (err: any) => {
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
      server.on("clientError", (err: any) => {
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
  });

  describe("HTTP Protocol Violations", () => {
    test("rejects requests with invalid HTTP version", async () => {
      const mockHandler = createMockHandler();
      server.on("request", mockHandler);
      const { promise, resolve, reject } = Promise.withResolvers();
      server.on("clientError", (err: any) => {
        try {
          expect(err.code).toBe("HPE_INTERNAL");
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
      expect(response).toInclude("505 HTTP Version Not Supported");
      await promise;
      expect(mockHandler).not.toHaveBeenCalled();
    });

    test("rejects requests with missing Host header in HTTP/1.1", async () => {
      const mockHandler = createMockHandler();
      server.on("request", mockHandler);
      const { promise, resolve, reject } = Promise.withResolvers();
      server.on("clientError", (err: any) => {
        try {
          expect(err.code).toBe("HPE_INTERNAL");
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      const msg = [
        "GET / HTTP/1.1",
        // Missing Host header
        "",
        "",
      ].join("\r\n");

      const response = await sendRequest(msg);
      expect(response).toInclude("400 Bad Request");
      await promise;
      expect(mockHandler).not.toHaveBeenCalled();
    });
  });

  test("Server should not crash in clientError is emitted when calling destroy", async () => {
    await using server = http.createServer(async (req, res) => {
      res.end("Hello World");
    });

    const clientErrors: Promise<void>[] = [];
    server.on("clientError", (err, socket) => {
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
        client.write("GET / HTTP/1.1\r\nContent-Length: 0\r\n\r\n");
        client.on("error", reject);
        client.on("end", resolve);
        await promise;
      }
    }

    async function doInvalidRequests(address: AddressInfo) {
      const client = connect(address.port, address.address, () => {
        client.write("GET / HTTP/1.1\r\nContent-Length: 0\r\n\r\n");
      });
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      client.on("error", reject);
      client.on("close", resolve);
      await promise;
    }

    await doRequests(address);
    await Promise.all(clientErrors);
    clientErrors.length = 0;
    await doInvalidRequests(address);
    await Promise.all(clientErrors);
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
