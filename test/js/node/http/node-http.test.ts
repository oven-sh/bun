// @ts-nocheck
import http, {
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
import https, { createServer as createHttpsServer } from "node:https";
import { EventEmitter } from "node:events";
import { createServer as createHttpsServer } from "node:https";
import { createTest } from "node-harness";
import url from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import nodefs from "node:fs";
import * as path from "node:path";
import { unlinkSync } from "node:fs";
import { PassThrough } from "node:stream";
const { describe, expect, it, beforeAll, afterAll, createDoneDotAll, mock } = createTest(import.meta.path);
import { bunExe } from "bun:harness";
import { bunEnv, disableAggressiveGCScope, tmpdirSync } from "harness";
import * as stream from "node:stream";
import * as zlib from "node:zlib";

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
        req.on("socket", function onRequestSocket(socket) {
          req.destroy();
          done();
        });
        req.end();
      });
    });
    it("support custom tls args", done => {
      const requestData = { endUserIp: "123.123.123.123" };

      const cert = `Bag Attributes
    localKeyID: A9 F3 0C D7 04 B6 7D 23 86 84 71 C3 E9 42 62 8B 1B D7 75 C3
subject=C = SE, O = Testbank A AB (publ), serialNumber = 5566304928, name = Test av BankID, CN = FP Testcert 4
issuer=C = SE, O = Testbank A AB (publ), serialNumber = 111111111111, CN = Testbank A RP CA v1 for BankID Test
-----BEGIN CERTIFICATE-----
MIIEyjCCArKgAwIBAgIIMLbIMaRHjMMwDQYJKoZIhvcNAQELBQAwcTELMAkGA1UE
BhMCU0UxHTAbBgNVBAoMFFRlc3RiYW5rIEEgQUIgKHB1YmwpMRUwEwYDVQQFEwwx
MTExMTExMTExMTExLDAqBgNVBAMMI1Rlc3RiYW5rIEEgUlAgQ0EgdjEgZm9yIEJh
bmtJRCBUZXN0MB4XDTIyMDgxNzIyMDAwMFoXDTI0MDgxODIxNTk1OVowcjELMAkG
A1UEBhMCU0UxHTAbBgNVBAoMFFRlc3RiYW5rIEEgQUIgKHB1YmwpMRMwEQYDVQQF
Ewo1NTY2MzA0OTI4MRcwFQYDVQQpDA5UZXN0IGF2IEJhbmtJRDEWMBQGA1UEAwwN
RlAgVGVzdGNlcnQgNDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAL4L
8ERHNSi7Jph9gj4ah7Ieok5lZHZbNyW1AiJJ1OfeD1lbAzxSidtTu6NfC83zxCjL
q091lHY5G7dpNDt1rN5Y+jQvrtcLc8nUpgqLfEUnbGKzZaHlO97jh6pqO8nj/mal
TrWI70Fr6SO3SxbsgxuwJXlRUAQxI0mPvD1gOd+uymA+EqdYS39ijC2eICHSf7bU
wvmscy8TAyEcT4GYmcjai1vbIjlhemmAv+NKJiSpD+zqvuHGIzBm71/Fd6cTAXqk
HkqTlJsxF2m6eojKCfcm5uAvSTXhVbGM155wmpzLskzkQ0dx6LbRNtA+BDe1MsAA
v8aE2FQ0j31ALgZePY0CAwEAAaNlMGMwEQYDVR0gBAowCDAGBgQqAwQFMA4GA1Ud
DwEB/wQEAwIHgDAfBgNVHSMEGDAWgBTiuVUIvGKgRjldgAxQSpIBy0zvizAdBgNV
HQ4EFgQUoiM2SwR2MdMVjaZz04J9LbOEau8wDQYJKoZIhvcNAQELBQADggIBAGBA
X1IC7mg1blaeqrTW+TtPkF7GvsbsWIh0RgG9DYRtXXofad3bn6kbDrfFXKZzv4JH
ERmJSyLXzMLoiwJB16V8Vz/kHT7AK94ZpLPjedPr2O4U2DGQXu1TwP5nkfgQxTeP
K/XnDVHNsMKqTnc+YNX6mj/UyLnbs8eq/a9uHOBJR30e0OPAdlc2fTbBT2Cui29E
ctcNH4LrcH4au9vO+RpEUm1hqZy3mHrx1p8Six6+qJSERNYIWTID8gklyp8MSyG5
q7dk0WcyvytM1dmVf/q+KriljaZ8x2zLhQRz9vpgnfwJ6Qh3cLVoPItVdQ03WpKW
WAB1NCMMyNcszkLZ9OO3IRz8iyWV/KWGI07ngVuGa7dHuTje6ZjcObBCr2e4uuU+
CLENcretUAv0BtCsOBhQLXZ0qzqrgsVebTRQzm2zTM0yfBpcTtPd3MOMFeMQTHJJ
8QH6twAKeJfY1lUCTXJYy1ZcrKnrNehksST8tk98Km9t5M2X59QZk7mJzzsUbnWr
t+izid7xF7FAgDYj9XJgQHz04a4RjRSw5/6dgexAgvGoeOkG7uUhYd5DEYQCyQyR
Zy69pJN32L0nM2dC2e3NFU5BOBwocoKza3hdtSqqvIkj2kzyeU38uaJUco/Vk3OU
s+sQNZbk5C1pxkLLwzu815tKg77Om4Nwbi+bgDvI
-----END CERTIFICATE-----
`;
      const key = `Bag Attributes
    localKeyID: A9 F3 0C D7 04 B6 7D 23 86 84 71 C3 E9 42 62 8B 1B D7 75 C3
Key Attributes: <No Attributes>
-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC+C/BERzUouyaY
fYI+GoeyHqJOZWR2WzcltQIiSdTn3g9ZWwM8UonbU7ujXwvN88Qoy6tPdZR2ORu3
aTQ7dazeWPo0L67XC3PJ1KYKi3xFJ2xis2Wh5Tve44eqajvJ4/5mpU61iO9Ba+kj
t0sW7IMbsCV5UVAEMSNJj7w9YDnfrspgPhKnWEt/YowtniAh0n+21ML5rHMvEwMh
HE+BmJnI2otb2yI5YXppgL/jSiYkqQ/s6r7hxiMwZu9fxXenEwF6pB5Kk5SbMRdp
unqIygn3JubgL0k14VWxjNeecJqcy7JM5ENHcei20TbQPgQ3tTLAAL/GhNhUNI99
QC4GXj2NAgMBAAECggEBAKiJH9b9Kxhm9/BNhZ4bmvEMF7XcVv5bIAnRfwX3YdcK
Z6Q/gRwSumyF0iYsmORY5EGldNOvmyxIstqxcn+0eMxqLeDv1Gaioll/uowpbNhL
AOR64Yt0Jecg8mPfeAwvo6FVwfpdaIgk8YkZ+H5o2lBIosL2qDY/eWK4FCB94HUL
Hq7za/7J7t5WOYjiOLmb48Fpe7cA1C6ezU/MEwVmDBwZARccCyeQFp96tdzUxb7N
ifSaDpUFyxHbb/GNy+hF2ApqFrJ69OBUsHqtYdd36lD/tPF0Lexsvtj/l21D/Nh6
80mEnpegpJBzO9z7wJkhz/5etO3bnaVSUyGGgJl8KkUCgYEA5SnGKyWg3dDtNeEi
5qilYsTOERvulUJ49zzzva0ioD8sJHNlG1q7Dp9sb9rZW6VOL1W8FUZH63/2sgte
NE9njByK2fz9PXXUODu6yREAfDxcv9qkGTLWwZ0LFEQg68G+J1hIz6PQEuhAJqk8
rYHXnTQ0qUw7R6gez2KoXp8wnFMCgYEA1E13E5NKs/VKctUQqXcKpy7VL017yBH8
J2RTjDLVGh6BFcR9wGm5ipE659TpNKdqPN17bGPGj5MOdZL1+sGVTRkg4vSZeZuE
kpw192KgwNoDznjeVH5qY7VM8Zy2DI91mg2NQTQiMF0mRLaenMOfzFBjHwQZ2J/J
ecT3Vwepgp8CgYAsocIyzRVTnklU4RBHFDmBzwrDUklZUKT2oixmmL3Rr/wM7VyX
w0gDRRF9h4Ylz0A2/9+t1Q5U04tcidJDJePo6fYxFpDL05MNkLSETIdnqun1g8PK
FJi3BLsPq2UuBYHfb9Zeem0gAZPc88EZmdxAhdZr0qkI/7lgcrqQEzkIeQKBgGri
kVfOqSaPEStdL+VR5JAlGPmWtgIVY/DlJtcH5Jgg0XaHFZSg5ePomFKNs9dpjigU
jgYU+avhKr9w/NyBR8yoIRGCeh5qeMVjVhw1kJ9nY9E4sx6xApkudw2Ri2opc9ja
h8pTF/9ndlPT6WkdaD9yHWVJKEYStFnVG326gtIbAoGAetLNOSZBSW03SJlI7dhY
4hycNElfSd0t89Bf4YcYbWrpySeKCG0oTO7Y56ZS9RmgNEyz4HNXZcQ56inMNY6Z
M+o1wGEKJKLBtCJHZp7Sh8zy/RMI3naF4vc4r4BpK9k5ZAEL8gHVm9M5C2ZG8whc
r+Uu/g0P3m8w7INgsjxQy/U=
-----END PRIVATE KEY-----
`;

      // Read the CA certificate file
      const ca = `-----BEGIN CERTIFICATE-----
MIIF0DCCA7igAwIBAgIIIhYaxu4khgAwDQYJKoZIhvcNAQENBQAwbDEkMCIGA1UE CgwbRmluYW5zaWVsbCBJRC1UZWtuaWsgQklEIEFCMRowGAYDVQQLDBFJbmZyYXN0 cnVjdHVyZSBDQTEoMCYGA1UEAwwfVGVzdCBCYW5rSUQgU1NMIFJvb3QgQ0EgdjEg VGVzdDAeFw0xNDExMjExMjM5MzFaFw0zNDEyMzExMjM5MzFaMGwxJDAiBgNVBAoM G0ZpbmFuc2llbGwgSUQtVGVrbmlrIEJJRCBBQjEaMBgGA1UECwwRSW5mcmFzdHJ1 Y3R1cmUgQ0ExKDAmBgNVBAMMH1Rlc3QgQmFua0lEIFNTTCBSb290IENBIHYxIFRl c3QwggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAwggIKAoICAQCAKWsJc/kV/0434d+S qn19mIr85RZ/PgRFaUplSrnhuzAmaXihPLCEsd3Mh/YErygcxhQ/MAzi5OZ/anfu WSCwceRlQINtvlRPdMoeZtu29FsntK1Z5r2SYNdFwbRFb8WN9FsU0KvC5zVnuDMg s5dUZwTmdzX5ZdLP7pdgB3zhTnra5ORtkiWiUxJVev9keRgAo00ZHIRJ+xTfiSPd Jc314maigVRQZdGKSyQcQMTWi1YLwd2zwOacNxleYf8xqKgkZsmkrc4Dp2mR5Pkr nnKB6A7sAOSNatua7M86EgcGi9AaEyaRMkYJImbBfzaNlaBPyMSvwmBZzp2xKc9O D3U06ogV6CJjJL7hSuVc5x/2H04d+2I+DKwep6YBoVL9L81gRYRycqg+w+cTZ1TF /s6NC5YRKSeOCrLw3ombhjyyuPl8T/h9cpXt6m3y2xIVLYVzeDhaql3hdi6IpRh6 rwkMhJ/XmOpbDinXb1fWdFOyQwqsXQWOEwKBYIkM6cPnuid7qwaxfP22hDgAolGM LY7TPKUPRwV+a5Y3VPl7h0YSK7lDyckTJdtBqI6d4PWQLnHakUgRQy69nZhGRtUt PMSJ7I4Qtt3B6AwDq+SJTggwtJQHeid0jPki6pouenhPQ6dZT532x16XD+WIcD2f //XzzOueS29KB7lt/wH5K6EuxwIDAQABo3YwdDAdBgNVHQ4EFgQUDY6XJ/FIRFX3 dB4Wep3RVM84RXowDwYDVR0TAQH/BAUwAwEB/zAfBgNVHSMEGDAWgBQNjpcn8UhE Vfd0HhZ6ndFUzzhFejARBgNVHSAECjAIMAYGBCoDBAUwDgYDVR0PAQH/BAQDAgEG MA0GCSqGSIb3DQEBDQUAA4ICAQA5s59/Olio4svHXiKu7sPQRvrf4GfGB7hUjBGk YW2YOHTYnHavSqlBASHc8gGGwuc7v7+H+vmOfSLZfGDqxnBqeJx1H5E0YqEXtNqW G1JusIFa9xWypcONjg9v7IMnxxQzLYws4YwgPychpMzWY6B5hZsjUyKgB+1igxnf uaBueLPw3ZaJhcCL8gz6SdCKmQpX4VaAadS0vdMrBOmd826H+aDGZek1vMjuH11F fJoXY2jyDnlol7Z4BfHc011toWNMxojI7w+U4KKCbSxpWFVYITZ8WlYHcj+b2A1+ dFQZFzQN+Y1Wx3VIUqSks6P7F5aF/l4RBngy08zkP7iLA/C7rm61xWxTmpj3p6SG fUBsrsBvBgfJQHD/Mx8U3iQCa0Vj1XPogE/PXQQq2vyWiAP662hD6og1/om3l1PJ TBUyYXxqJO75ux8IWblUwAjsmTlF/Pcj8QbcMPXLMTgNQAgarV6guchjivYqb6Zr hq+Nh3JrF0HYQuMgExQ6VX8T56saOEtmlp6LSQi4HvKatCNfWUJGoYeT5SrcJ6sn By7XLMhQUCOXcBwKbNvX6aP79VA3yeJHZO7XParX7V9BB+jtf4tz/usmAT/+qXtH CCv9Xf4lv8jgdOnFfXbXuT8I4gz8uq8ElBlpbJntO6p/NY5a08E6C7FWVR+WJ5vZOP2HsA==
-----END CERTIFICATE-----`;

      const options = {
        method: "POST",
        port: 443,
        hostname: "appapi2.test.bankid.com",
        path: "/rp/v6.0/auth",
        cert,
        key,
        ca,
        headers: {
          "Content-Type": "application/json",
        },
      };
      const req = https.request(options, res => {
        let data = "";

        res.on("data", chunk => {
          data += chunk;
        });

        res.on("end", () => {
          expect(res.statusCode).toBe(200);
          done();
        });
      });

      req.on("error", error => {
        done(error);
      });

      req.write(JSON.stringify(requestData));

      req.end();
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

  test("error event not fired, issue#4651", async () => {
    const { promise, resolve } = Promise.withResolvers();
    const server = createServer((req, res) => {
      res.end();
    });
    server.listen({ port: 42069 }, () => {
      const server2 = createServer((_, res) => {
        res.end();
      });
      server2.on("error", err => {
        resolve(err);
      });
      server2.listen({ port: 42069 }, () => {});
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
      expect(() => res.assignSocket(socket)).toThrow("ServerResponse has an already assigned socket");
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
    expect([path.join(import.meta.dir, "node-http-ref-fixture.js")]).toRun();
  });
}

it("#10177 response.write with non-ascii latin1 should not cause duplicated character or segfault", done => {
  // x = ascii
  // á = latin1 supplementary character
  // 📙 = emoji
  // 👍🏽 = its a grapheme of 👍 🟤
  // "\u{1F600}" = utf16
  const chars = ["x", "á", "📙", "👍🏽", "\u{1F600}"];

  // 128 = small than waterMark, 256 = waterMark, 1024 = large than waterMark
  // 8Kb = small than cork buffer
  // 16Kb = cork buffer
  // 32Kb = large than cork buffer
  const start_size = 128;
  const increment_step = 1024;
  const end_size = 32 * 1024;
  let expected = "";

  function finish(err) {
    server.closeAllConnections();
    Bun.gc(true);
    done(err);
  }
  const server = require("http")
    .createServer((_, response) => {
      response.write(expected);
      response.write("");
      response.end();
    })
    .listen(0, "localhost", async (err, hostname, port) => {
      expect(err).toBeFalsy();
      expect(port).toBeGreaterThan(0);

      for (const char of chars) {
        for (let size = start_size; size <= end_size; size += increment_step) {
          expected = char + Buffer.alloc(size, "-").toString("utf8") + "x";

          try {
            const url = `http://${hostname}:${port}`;
            const count = 20;
            const all = [];
            const batchSize = 20;
            while (all.length < count) {
              const batch = Array.from({ length: batchSize }, () => fetch(url).then(a => a.text()));

              all.push(...(await Promise.all(batch)));
            }

            using _ = disableAggressiveGCScope();
            for (const result of all) {
              expect(result).toBe(expected);
            }
          } catch (err) {
            return finish(err);
          }
        }

        // still always run GC at the end here.
        Bun.gc(true);
      }
      finish();
    });
}, 20_000);

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
  const { stdout, stderr, exited } = Bun.spawn({
    cmd: [bunExe(), "run", path.join(import.meta.dir, "fixtures/log-events.mjs")],
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: bunEnv,
  });
  const err = await new Response(stderr).text();
  expect(err).toBeEmpty();
  const out = await new Response(stdout).text();
  // TODO prefinish and socket are not emitted in the right order
  expect(out.split("\n")).toEqual([
    `[ "req", "prefinish" ]`,
    `[ "req", "socket" ]`,
    `[ "req", "finish" ]`,
    `[ "req", "response" ]`,
    "STATUS: 200",
    // `[ "res", "resume" ]`,
    // `[ "res", "readable" ]`,
    // `[ "res", "end" ]`,
    `[ "req", "close" ]`,
    `[ "res", Symbol(kConstruct) ]`,
    // `[ "res", "close" ]`,
    "",
  ]);
});

it("destroy should end download", async () => {
  // just simulate some file that will take forever to download
  const payload = Buffer.from("X".repeat(16 * 1024));

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      let running = true;
      req.signal.onabort = () => (running = false);
      return new Response(async function* () {
        while (running) {
          yield payload;
          await Bun.sleep(10);
        }
      });
    },
  });
  {
    let chunks = 0;

    const { promise, resolve } = Promise.withResolvers();
    const req = request(server.url, res => {
      res.on("data", () => {
        process.nextTick(resolve);
        chunks++;
      });
    });
    req.end();
    // wait for the first chunk
    await promise;
    // should stop the download
    req.destroy();
    await Bun.sleep(200);
    expect(chunks).toBeLessThanOrEqual(3);
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

it("should accept custom certs when provided", async () => {
  const server = https.createServer(
    {
      key: nodefs.readFileSync(joinPath(import.meta.dir, "fixtures", "openssl_localhost.key")),
      cert: nodefs.readFileSync(joinPath(import.meta.dir, "fixtures", "openssl_localhost.crt")),
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
      ca: nodefs.readFileSync(joinPath(import.meta.dir, "fixtures", "openssl_localhost.crt")),
    },
  });
  const t = await res.text();
  expect(t).toEqual("Hello from https server");

  server.close();
});
it("should error with faulty args", async () => {
  const server = https.createServer(
    {
      key: nodefs.readFileSync(joinPath(import.meta.dir, "fixtures", "openssl_localhost.key")),
      cert: nodefs.readFileSync(joinPath(import.meta.dir, "fixtures", "openssl_localhost.crt")),
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
