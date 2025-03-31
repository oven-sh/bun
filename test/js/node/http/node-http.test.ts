/**
 * All new tests in this file should also run in Node.js.
 *
 * Do not add any tests that only run in Bun.
 *
 * A handful of older tests do not run in Node in this file. These tests should be updated to run in Node, or deleted.
 */
import { bunEnv, randomPort, bunExe } from "harness";
import { createTest } from "node-harness";
import { spawnSync } from "node:child_process";
import { EventEmitter, once } from "node:events";
import nodefs, { unlinkSync } from "node:fs";
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
import type { AddressInfo } from "node:net";
import https, { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import * as path from "node:path";
import * as stream from "node:stream";
import { PassThrough } from "node:stream";
import * as zlib from "node:zlib";
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
      const req = https.request("https://example.com", { headers: { "accept-encoding": "identity" } }, res => {
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
        req.on("socket", function onRequestSocket(socket) {
          req.destroy();
          done();
        });
        req.end();
      });
    });
  });

  describe("https.request with custom tls options", () => {
    const createServer = () =>
      new Promise(resolve => {
        const server = createHttpsServer(
          {
            key: nodefs.readFileSync(path.join(import.meta.dir, "fixtures", "openssl_localhost.key")),
            cert: nodefs.readFileSync(path.join(import.meta.dir, "fixtures", "openssl_localhost.crt")),
            rejectUnauthorized: true,
          },
          (req, res) => {
            res.writeHead(200);
            res.end("hello world");
          },
        );

        listen(server, "https").then(url => {
          resolve({
            server,
            close: () => server.close(),
            url,
          });
        });
      });

    it("supports custom tls args", async done => {
      const { url, close } = await createServer();
      try {
        const options: https.RequestOptions = {
          method: "GET",
          url,
          port: url.port,
          ca: nodefs.readFileSync(path.join(import.meta.dir, "fixtures", "openssl_localhost_ca.pem")),
        };
        const req = https.request(options, res => {
          res.on("data", () => null);
          res.on("end", () => {
            close();
            done();
          });
        });

        req.on("error", error => {
          close();
          done(error);
        });

        req.end();
      } catch (e) {
        close();
        throw e;
      }
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

it("should not accept untrusted certificates", async () => {
  const server = https.createServer(
    {
      key: nodefs.readFileSync(path.join(import.meta.dir, "fixtures", "openssl.key")),
      cert: nodefs.readFileSync(path.join(import.meta.dir, "fixtures", "openssl.crt")),
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

it("#4415.4 IncomingMessage es5", done => {
  // This matches Node.js:
  const im = Object.create(IncomingMessage.prototype);
  IncomingMessage.call(im, { url: "/foo" });
  expect(im.url).toBe("");

  let didCall = false;
  function Subclass(...args) {
    IncomingMessage.apply(this, args);
    didCall = true;
  }
  Object.setPrototypeOf(Subclass.prototype, IncomingMessage.prototype);
  Object.setPrototypeOf(Subclass, IncomingMessage);

  const server = new Server(
    {
      IncomingMessage: Subclass,
    },
    (req, res) => {
      if (req instanceof Subclass && didCall) {
        expect(req.url).toBe("/foo");
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("hello");
      } else {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("bye");
      }
    },
  );
  server.listen(0, () => {
    fetch(`http://localhost:${server.address().port}/foo`, {
      method: "GET",
    }).then(response => {
      expect(response.status).toBe(200);
      server.close(done);
    });
  });
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
    expect([path.join(import.meta.dir, "node-http-ref-fixture.js")]).toRun();
  });
}

it("#10177 response.write with non-ascii latin1 should not cause duplicated character or segfault", () => {
  // this can cause a segfault so we run it in a separate process
  const { exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", path.join(import.meta.dir, "node-http-response-write-encode-fixture.js")],
    env: bunEnv,
    stdout: "inherit",
    stderr: "inherit",
  });
  expect(exitCode).toBe(0);
}, 60_000);

it("#11425 http no payload limit", done => {
  const server = Server((req, res) => {
    res.end();
  });
  server.listen(0, async (_err, host, port) => {
    try {
      const res = await fetch(`http://localhost:${port}`, {
        method: "POST",
        body: new Uint8Array(1024 * 1024 * 200),
      });
      expect(res.status).toBe(200);
      done();
    } catch (err) {
      done(err);
    } finally {
      server.close();
    }
  });
});

it("should emit events in the right order", async () => {
  const { stdout, exited } = Bun.spawn({
    cmd: [bunExe(), "run", path.join(import.meta.dir, "fixtures/log-events.mjs")],
    stdout: "pipe",
    stdin: "ignore",
    stderr: "inherit",
    env: bunEnv,
  });
  const out = await new Response(stdout).text();
  // TODO prefinish and socket are not emitted in the right order
  expect(
    out
      .split("\n")
      .filter(Boolean)
      .map(x => JSON.parse(x)),
  ).toStrictEqual([
    ["req", "socket"],
    ["req", "prefinish"],
    ["req", "finish"],
    ["req", "response"],
    "STATUS: 200",
    // TODO: not totally right:
    ["req", "close"],
    ["res", "resume"],
    ["res", "readable"],
    ["res", "end"],
    ["res", "close"],
  ]);
  expect(await exited).toBe(0);
});

it("destroy should end download", async () => {
  // just simulate some file that will take forever to download
  const payload = Buffer.alloc(128 * 1024, "X");
  for (let i = 0; i < 5; i++) {
    let sendedByteLength = 0;
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        let running = true;
        req.signal.onabort = () => (running = false);
        return new Response(async function* () {
          while (running) {
            sendedByteLength += payload.byteLength;
            yield payload;
            await Bun.sleep(10);
          }
        });
      },
    });

    async function run() {
      let receivedByteLength = 0;
      let { promise, resolve } = Promise.withResolvers();
      const req = request(server.url, res => {
        res.on("data", data => {
          receivedByteLength += data.length;
          if (resolve) {
            resolve();
            resolve = null;
          }
        });
      });
      req.end();
      await promise;
      req.destroy();
      await Bun.sleep(10);
      const initialByteLength = receivedByteLength;
      // we should receive the same amount of data we sent
      expect(initialByteLength).toBeLessThanOrEqual(sendedByteLength);
      await Bun.sleep(10);
      // we should not receive more data after destroy
      expect(initialByteLength).toBe(receivedByteLength);
      await Bun.sleep(10);
    }

    const runCount = 50;
    const runs = Array.from({ length: runCount }, run);
    await Promise.all(runs);
    Bun.gc(true);
    await Bun.sleep(10);
  }
});

it("can send brotli from Server and receive with fetch", async () => {
  try {
    var server = createServer((req, res) => {
      expect(req.url).toBe("/hello");
      res.writeHead(200);
      res.setHeader("content-encoding", "br");

      const inputStream = new stream.Readable();
      inputStream.push("Hello World");
      inputStream.push(null);

      inputStream.pipe(zlib.createBrotliCompress()).pipe(res);
    });
    const url = await listen(server);
    const res = await fetch(new URL("/hello", url));
    expect(await res.text()).toBe("Hello World");
  } catch (e) {
    throw e;
  } finally {
    server.close();
  }
});

it("can send gzip from Server and receive with fetch", async () => {
  try {
    var server = createServer((req, res) => {
      expect(req.url).toBe("/hello");
      res.writeHead(200);
      res.setHeader("content-encoding", "gzip");

      const inputStream = new stream.Readable();
      inputStream.push("Hello World");
      inputStream.push(null);

      inputStream.pipe(zlib.createGzip()).pipe(res);
    });
    const url = await listen(server);
    const res = await fetch(new URL("/hello", url));
    expect(await res.text()).toBe("Hello World");
  } catch (e) {
    throw e;
  } finally {
    server.close();
  }
});

it("can send deflate from Server and receive with fetch", async () => {
  try {
    var server = createServer((req, res) => {
      expect(req.url).toBe("/hello");
      res.writeHead(200);
      res.setHeader("content-encoding", "deflate");

      const inputStream = new stream.Readable();
      inputStream.push("Hello World");
      inputStream.push(null);

      inputStream.pipe(zlib.createDeflate()).pipe(res);
    });
    const url = await listen(server);
    const res = await fetch(new URL("/hello", url));
    expect(await res.text()).toBe("Hello World");
  } catch (e) {
    throw e;
  } finally {
    server.close();
  }
});

it("can send brotli from Server and receive with Client", async () => {
  try {
    var server = createServer((req, res) => {
      expect(req.url).toBe("/hello");
      res.writeHead(200);
      res.setHeader("content-encoding", "br");

      const inputStream = new stream.Readable();
      inputStream.push("Hello World");
      inputStream.push(null);

      const passthrough = new stream.PassThrough();
      passthrough.on("data", data => res.write(data));
      passthrough.on("end", () => res.end());

      inputStream.pipe(zlib.createBrotliCompress()).pipe(passthrough);
    });

    const url = await listen(server);
    const { resolve, reject, promise } = Promise.withResolvers();
    http.get(new URL("/hello", url), res => {
      let rawData = "";
      const passthrough = stream.PassThrough();
      passthrough.on("data", chunk => {
        rawData += chunk;
      });
      passthrough.on("end", () => {
        try {
          expect(Buffer.from(rawData)).toEqual(Buffer.from("Hello World"));
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      res.pipe(zlib.createBrotliDecompress()).pipe(passthrough);
    });
    await promise;
  } catch (e) {
    throw e;
  } finally {
    server.close();
  }
});

it("ServerResponse ClientRequest field exposes agent getter", async () => {
  try {
    var server = createServer((req, res) => {
      expect(req.url).toBe("/hello");
      res.writeHead(200);
      res.end("world");
    });
    const url = await listen(server);
    const { resolve, reject, promise } = Promise.withResolvers();
    http.get(new URL("/hello", url), res => {
      try {
        expect(res.req.agent.protocol).toBe("http:");
        resolve();
      } catch (e) {
        reject(e);
      }
    });
    await promise;
  } catch (e) {
    throw e;
  } finally {
    server.close();
  }
});

it("should accept custom certs when provided", async () => {
  const server = https.createServer(
    {
      key: nodefs.readFileSync(path.join(import.meta.dir, "fixtures", "openssl_localhost.key")),
      cert: nodefs.readFileSync(path.join(import.meta.dir, "fixtures", "openssl_localhost.crt")),
      passphrase: "123123123",
    },
    (req, res) => {
      res.write("Hello from https server");
      res.end();
    },
  );
  server.listen(0, "localhost");
  const address = server.address();

  let url_address = address.address;
  const res = await fetch(`https://localhost:${address.port}`, {
    tls: {
      rejectUnauthorized: true,
      ca: nodefs.readFileSync(path.join(import.meta.dir, "fixtures", "openssl_localhost_ca.pem")),
    },
  });
  const t = await res.text();
  expect(t).toEqual("Hello from https server");

  server.close();
});
it("should error with faulty args", async () => {
  const server = https.createServer(
    {
      key: nodefs.readFileSync(path.join(import.meta.dir, "fixtures", "openssl_localhost.key")),
      cert: nodefs.readFileSync(path.join(import.meta.dir, "fixtures", "openssl_localhost.crt")),
      passphrase: "123123123",
    },
    (req, res) => {
      res.write("Hello from https server");
      res.end();
    },
  );
  server.listen(0, "localhost");
  const address = server.address();

  try {
    let url_address = address.address;
    const res = await fetch(`https://localhost:${address.port}`, {
      tls: {
        rejectUnauthorized: true,
        ca: "some invalid value for a ca",
      },
    });
    await res.text();
    expect(true).toBe("unreacheable");
  } catch (err) {
    expect(err.code).toBe("FailedToOpenSocket");
    expect(err.message).toBe("Was there a typo in the url or port?");
  }
  server.close();
});

it("should propagate exception in sync data handler", async () => {
  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), "run", path.join(import.meta.dir, "node-http-error-in-data-handler-fixture.1.js")],
    stdout: "pipe",
    stderr: "inherit",
    env: bunEnv,
  });

  expect(stdout.toString()).toContain("Test passed");
  expect(exitCode).toBe(0);
});

it("should propagate exception in async data handler", async () => {
  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), "run", path.join(import.meta.dir, "node-http-error-in-data-handler-fixture.2.js")],
    stdout: "pipe",
    stderr: "inherit",
    env: bunEnv,
  });

  expect(stdout.toString()).toContain("Test passed");
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

// TODO: today we use a workaround to continue event, we need to fix it in the future.
it("should emit continue event #7480", done => {
  let receivedContinue = false;
  const req = https.request(
    "https://example.com",
    { headers: { "accept-encoding": "identity", "expect": "100-continue" } },
    res => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", chunk => {
        data += chunk;
      });
      res.on("end", () => {
        expect(receivedContinue).toBe(true);
        expect(data).toContain("This domain is for use in illustrative examples in documents");
        done();
      });
      res.on("error", err => done(err));
    },
  );
  req.on("continue", () => {
    receivedContinue = true;
  });
  req.end();
});

it("should not emit continue event #7480", done => {
  let receivedContinue = false;
  const req = https.request("https://example.com", { headers: { "accept-encoding": "identity" } }, res => {
    let data = "";
    res.setEncoding("utf8");
    res.on("data", chunk => {
      data += chunk;
    });
    res.on("end", () => {
      expect(receivedContinue).toBe(false);
      expect(data).toContain("This domain is for use in illustrative examples in documents");
      done();
    });
    res.on("error", err => done(err));
  });
  req.on("continue", () => {
    receivedContinue = true;
  });
  req.end();
});

it("http.Agent is configured correctly", () => {
  const agent = new http.Agent();
  expect(agent.defaultPort).toBe(80);
  expect(agent.protocol).toBe("http:");
});

it("https.Agent is configured correctly", () => {
  const agent = new https.Agent();
  expect(agent.defaultPort).toBe(443);
  expect(agent.protocol).toBe("https:");
});

it("http.get can use http.Agent", async () => {
  const agent = new http.Agent();
  const { promise, resolve } = Promise.withResolvers();
  http.get({ agent, hostname: "google.com" }, resolve);
  const response = await promise;
  expect(response.req.port).toBe(80);
  expect(response.req.protocol).toBe("http:");
});

it("https.get can use https.Agent", async () => {
  const agent = new https.Agent();
  const { promise, resolve } = Promise.withResolvers();
  https.get({ agent, hostname: "google.com" }, resolve);
  const response = await promise;
  expect(response.req.port).toBe(443);
  expect(response.req.protocol).toBe("https:");
});

it("http.request has the correct options", async () => {
  const { promise, resolve } = Promise.withResolvers();
  http.request("http://google.com/", resolve).end();
  const response = await promise;
  expect(response.req.port).toBe(80);
  expect(response.req.protocol).toBe("http:");
});

it("https.request has the correct options", async () => {
  const { promise, resolve } = Promise.withResolvers();
  https.request("https://google.com/", resolve).end();
  const response = await promise;
  expect(response.req.port).toBe(443);
  expect(response.req.protocol).toBe("https:");
});

it("using node:http to do https: request fails", () => {
  expect(() => http.request("https://example.com")).toThrow(TypeError);
  expect(() => http.request("https://example.com")).toThrow({
    code: "ERR_INVALID_PROTOCOL",
    message: `Protocol "https:" not supported. Expected "http:"`,
  });
});

it("should emit close, and complete should be true only after close #13373", async () => {
  const server = http.createServer().listen(0);
  try {
    await once(server, "listening");
    fetch(`http://localhost:${server.address().port}`)
      .then(res => res.text())
      .catch(() => {});

    const [req, res] = await once(server, "request");
    expect(req.complete).toBe(false);
    console.log("ok 1");
    const closeEvent = once(req, "close");
    res.end("hi");

    await closeEvent;
    expect(req.complete).toBe(true);
  } finally {
    server.closeAllConnections();
  }
});

it("should emit close when connection is aborted", async () => {
  const server = http.createServer().listen(0);
  server.unref();
  try {
    await once(server, "listening");
    const controller = new AbortController();
    fetch(`http://localhost:${server.address().port}`, { signal: controller.signal })
      .then(res => res.text())
      .catch(() => {});

    const [req, res] = await once(server, "request");
    const closeEvent = Promise.withResolvers();
    req.once("close", () => {
      closeEvent.resolve();
    });
    controller.abort();
    await closeEvent.promise;
    expect(req.aborted).toBe(true);
  } finally {
    server.close();
  }
});

it("should emit timeout event", async () => {
  const server = http.createServer().listen(0);
  try {
    await once(server, "listening");
    fetch(`http://localhost:${server.address().port}`)
      .then(res => res.text())
      .catch(() => {});

    const [req, res] = await once(server, "request");
    expect(req.complete).toBe(false);
    let callBackCalled = false;
    req.setTimeout(100, () => {
      callBackCalled = true;
    });
    await once(req, "timeout");
    expect(callBackCalled).toBe(true);
  } finally {
    server.closeAllConnections();
  }
}, 12_000);

it("should emit timeout event when using server.setTimeout", async () => {
  const server = http.createServer().listen(0);
  try {
    await once(server, "listening");
    let callBackCalled = false;
    server.setTimeout(100, () => {
      callBackCalled = true;
      console.log("Called timeout");
    });

    fetch(`http://localhost:${server.address().port}`, { verbose: true })
      .then(res => res.text())
      .catch(err => {
        console.log(err);
      });

    const [req, res] = await once(server, "request");
    expect(req.complete).toBe(false);
    await once(server, "timeout");
    expect(callBackCalled).toBe(true);
  } finally {
    server.closeAllConnections();
  }
}, 12_000);

it("must set headersSent to true after headers are sent #3458", async () => {
  const server = createServer().listen(0);
  try {
    await once(server, "listening");
    fetch(`http://localhost:${server.address().port}`).then(res => res.text());
    const [req, res] = await once(server, "request");
    expect(res.headersSent).toBe(false);
    const { promise, resolve } = Promise.withResolvers();
    res.end("OK", resolve);
    await promise;
    expect(res.headersSent).toBe(true);
  } finally {
    server.close();
  }
});

it("must set headersSent to true after headers are sent when using chunk encoded", async () => {
  const server = createServer().listen(0);
  try {
    await once(server, "listening");
    fetch(`http://localhost:${server.address().port}`).then(res => res.text());
    const [req, res] = await once(server, "request");
    expect(res.headersSent).toBe(false);
    const { promise, resolve } = Promise.withResolvers();
    res.write("first", () => {
      res.write("second", () => {
        res.end("OK", resolve);
      });
    });
    await promise;
    expect(res.headersSent).toBe(true);
  } finally {
    server.close();
  }
});

it("should work when sending https.request with agent:false", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  const client = https.request("https://example.com/", { agent: false });
  client.on("error", reject);
  client.on("close", resolve);
  client.end();
  await promise;
});

it("client should use chunked encoding if more than one write is called", async () => {
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  // Bun.serve is used here until #15576 or similar fix is merged
  using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      if (req.headers.get("transfer-encoding") !== "chunked") {
        return new Response("should be chunked encoding", { status: 500 });
      }
      return new Response(req.body);
    },
  });

  // Options for the HTTP request
  const options = {
    hostname: "127.0.0.1", // Replace with the target server
    port: server.port,
    path: "/api/data",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  };

  const { promise, resolve, reject } = Promise.withResolvers();

  // Create the request
  const req = http.request(options, res => {
    if (res.statusCode !== 200) {
      reject(new Error("Body should be chunked"));
    }
    const chunks = [];
    // Collect the response data
    res.on("data", chunk => {
      chunks.push(chunk);
    });

    res.on("end", () => {
      resolve(chunks);
    });
  });

  // Handle errors
  req.on("error", reject);

  // Write chunks to the request body

  for (let i = 0; i < 4; i++) {
    req.write("chunk");
    await sleep(50);
    req.write(" ");
    await sleep(50);
  }
  req.write("BUN!");
  // End the request and signal no more data will be sent
  req.end();

  const chunks = await promise;
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks[chunks.length - 1]?.toString()).toEndWith("BUN!");
  expect(Buffer.concat(chunks).toString()).toBe("chunk ".repeat(4) + "BUN!");
});

it("client should use content-length if only one write is called", async () => {
  await using server = http.createServer((req, res) => {
    if (req.headers["transfer-encoding"] === "chunked") {
      return res.writeHead(500).end();
    }
    res.writeHead(200);
    req.on("data", data => {
      res.write(data);
    });
    req.on("end", () => {
      res.end();
    });
  });

  await once(server.listen(0, "127.0.0.1"), "listening");

  // Options for the HTTP request
  const options = {
    hostname: "127.0.0.1", // Replace with the target server
    port: server.address().port,
    path: "/api/data",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  };

  const { promise, resolve, reject } = Promise.withResolvers();

  // Create the request
  const req = http.request(options, res => {
    if (res.statusCode !== 200) {
      reject(new Error("Body should not be chunked"));
    }
    const chunks = [];
    // Collect the response data
    res.on("data", chunk => {
      chunks.push(chunk);
    });

    res.on("end", () => {
      resolve(chunks);
    });
  });
  // Handle errors
  req.on("error", reject);
  // Write chunks to the request body
  req.write("Hello World BUN!");
  // End the request and signal no more data will be sent
  req.end();

  const chunks = await promise;
  expect(chunks.length).toBe(1);
  expect(chunks[0]?.toString()).toBe("Hello World BUN!");
  expect(Buffer.concat(chunks).toString()).toBe("Hello World BUN!");
});

it("should allow numbers headers to be set in node:http server and client", async () => {
  let server_headers;
  await using server = http.createServer((req, res) => {
    server_headers = req.headers;
    res.setHeader("x-number", 10);
    res.appendHeader("x-number-2", 20);
    res.end();
  });

  await once(server.listen(0, "localhost"), "listening");
  const { promise, resolve } = Promise.withResolvers();

  {
    const response = http.request(`http://localhost:${server.address().port}`, resolve);
    response.setHeader("x-number", 30);
    response.appendHeader("x-number-2", 40);
    response.end();
  }
  const response = (await promise) as Record<string, string>;
  expect(response.headers["x-number"]).toBe("10");
  expect(response.headers["x-number-2"]).toBe("20");
  expect(server_headers["x-number"]).toBe("30");
  expect(server_headers["x-number-2"]).toBe("40");
});

it("should allow Strict-Transport-Security when using node:http", async () => {
  await using server = http.createServer((req, res) => {
    res.writeHead(200, { "Strict-Transport-Security": "max-age=31536000" });
    res.end();
  });
  server.listen(0, "localhost");
  await once(server, "listening");
  const response = await fetch(`http://localhost:${server.address().port}`);
  expect(response.status).toBe(200);
  expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000");
});

it("should support localAddress", async () => {
  await new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const { localAddress, localFamily, localPort } = req.socket;
      res.end();
      server.close();
      expect(localAddress).toStartWith("127.");
      expect(localFamily).toBe("IPv4");
      expect(localPort).toBeGreaterThan(0);
      resolve();
    });
    server.listen(0, "127.0.0.1", () => {
      http.request(`http://localhost:${server.address().port}`).end();
    });
  });

  await new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const { localAddress, localFamily, localPort } = req.socket;
      res.end();
      server.close();
      expect(localAddress).toStartWith("::");
      expect(localFamily).toBe("IPv6");
      expect(localPort).toBeGreaterThan(0);
      resolve();
    });
    server.listen(0, "::1", () => {
      http.request(`http://[::1]:${server.address().port}`).end();
    });
  });
});

it("should not emit/throw error when writing after socket.end", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();

  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Connection": "close" });

    res.socket.end();
    res.on("error", reject);
    try {
      const result = res.write("Hello, world!");
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
  try {
    await once(server.listen(0), "listening");
    const url = `http://localhost:${server.address().port}`;

    await fetch(url, {
      method: "POST",
      body: Buffer.allocUnsafe(1024 * 1024 * 10),
    })
      .then(res => res.bytes())
      .catch(err => {});

    expect(await promise).toBeTrue();
  } finally {
    server.close();
  }
});

it("should handle data if not immediately handled", async () => {
  // Create a local server to receive data from
  const server = http.createServer();

  // Listen to the request event
  server.on("request", (request, res) => {
    setTimeout(() => {
      const body: Uint8Array[] = [];
      request.on("data", chunk => {
        body.push(chunk);
      });
      request.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(Buffer.concat(body));
      });
    }, 100);
  });
  try {
    await once(server.listen(0), "listening");
    const url = `http://localhost:${server.address().port}`;
    const payload = "Hello, world!".repeat(10).toString();
    const res = await fetch(url, {
      method: "POST",
      body: payload,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(payload);
  } finally {
    server.close();
  }
});

it("Empty requests should not be Transfer-Encoding: chunked", async () => {
  const server = http.createServer((req, res) => {
    res.end(JSON.stringify(req.headers));
  });
  await once(server.listen(0), "listening");
  const url = `http://localhost:${server.address().port}`;
  try {
    for (let method of ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"]) {
      const { promise, resolve, reject } = Promise.withResolvers();
      http
        .request(
          url,
          {
            method,
          },
          res => {
            const body: Uint8Array[] = [];
            res.on("data", chunk => {
              body.push(chunk);
            });
            res.on("end", () => {
              try {
                resolve(JSON.parse(Buffer.concat(body).toString()));
              } catch (e) {
                reject(e);
              }
            });
          },
        )
        .on("error", reject)
        .end();

      const headers = (await promise) as Record<string, string | undefined>;
      expect(headers).toBeDefined();
      expect(headers["transfer-encoding"]).toBeUndefined();
      switch (method) {
        case "GET":
        case "DELETE":
        case "OPTIONS":
          // Content-Length will not be present for GET, DELETE, and OPTIONS
          // aka DELETE in node.js will be undefined and in bun it will be 0
          // this is not outside the spec but is different between node.js and bun
          expect(headers["content-length"]).toBeOneOf(["0", undefined]);
          break;
        default:
          expect(headers["content-length"]).toBeDefined();
          break;
      }
    }
  } finally {
    server.close();
  }
});
