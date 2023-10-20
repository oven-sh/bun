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
} from "node:http";
import https, { createServer as createHttpsServer } from "node:https";
import { createTest } from "node-harness";
import url from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import nodefs from "node:fs";
import { join as joinPath } from "node:path";
import { unlinkSync } from "node:fs";
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
        "Set-Cookie": ["swag=true", "yolo=true"],
        "test": "test",
      });
    });
  });

  describe("request", () => {
    function runTest(done: Function, callback: (server: Server, port: number, done: (err?: Error) => void) => void) {
      var timer;
      var server = createServer((req, res) => {
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
        done(err);
      });

      req.write(JSON.stringify(requestData));

      req.end();
    });
  });

  describe("signal", () => {
    it.skip("should abort and close the server", done => {
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
      await fetch(url);
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
});
