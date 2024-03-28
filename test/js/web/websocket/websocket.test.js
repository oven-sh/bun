import { describe, it, expect } from "bun:test";
import { bunExe, bunEnv, gc } from "harness";
import { readFileSync } from "fs";
import { join, resolve } from "path";
import process from "process";

const TEST_WEBSOCKET_HOST = process.env.TEST_WEBSOCKET_HOST || "wss://ws.postman-echo.com/raw";
const isWindows = process.platform === "win32";

describe("WebSocket", () => {
  it("should connect", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          server.stop();
          return;
        }

        return new Response();
      },
      websocket: {
        open(ws) {},
        message(ws) {
          ws.close();
        },
      },
    });
    const ws = new WebSocket(`ws://${server.hostname}:${server.port}`, {});
    await new Promise(resolve => {
      ws.onopen = resolve;
    });
    var closed = new Promise(resolve => {
      ws.onclose = resolve;
    });
    ws.close();
    await closed;
    server.stop(true);
  });

  it("should connect over https", async () => {
    const ws = new WebSocket(TEST_WEBSOCKET_HOST.replaceAll("wss:", "https:"));
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    var closed = new Promise((resolve, reject) => {
      ws.onclose = resolve;
    });
    ws.close();
    await closed;
  });

  it("rejectUnauthorized should reject self-sign certs when true/default", async () => {
    const COMMON_CERT = {
      cert: "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAKLdQVPy90jjMA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV\nBAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX\naWRnaXRzIFB0eSBMdGQwHhcNMTkwMjAzMTQ0OTM1WhcNMjAwMjAzMTQ0OTM1WjBF\nMQswCQYDVQQGEwJBVTETMBEGA1UECAwKU29tZS1TdGF0ZTEhMB8GA1UECgwYSW50\nZXJuZXQgV2lkZ2l0cyBQdHkgTHRkMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIB\nCgKCAQEA7i7IIEdICTiSTVx+ma6xHxOtcbd6wGW3nkxlCkJ1UuV8NmY5ovMsGnGD\nhJJtUQ2j5ig5BcJUf3tezqCNW4tKnSOgSISfEAKvpn2BPvaFq3yx2Yjz0ruvcGKp\nDMZBXmB/AAtGyN/UFXzkrcfppmLHJTaBYGG6KnmU43gPkSDy4iw46CJFUOupc51A\nFIz7RsE7mbT1plCM8e75gfqaZSn2k+Wmy+8n1HGyYHhVISRVvPqkS7gVLSVEdTea\nUtKP1Vx/818/HDWk3oIvDVWI9CFH73elNxBkMH5zArSNIBTehdnehyAevjY4RaC/\nkK8rslO3e4EtJ9SnA4swOjCiqAIQEwIDAQABo1AwTjAdBgNVHQ4EFgQUv5rc9Smm\n9c4YnNf3hR49t4rH4yswHwYDVR0jBBgwFoAUv5rc9Smm9c4YnNf3hR49t4rH4ysw\nDAYDVR0TBAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEATcL9CAAXg0u//eYUAlQa\nL+l8yKHS1rsq1sdmx7pvsmfZ2g8ONQGfSF3TkzkI2OOnCBokeqAYuyT8awfdNUtE\nEHOihv4ZzhK2YZVuy0fHX2d4cCFeQpdxno7aN6B37qtsLIRZxkD8PU60Dfu9ea5F\nDDynnD0TUabna6a0iGn77yD8GPhjaJMOz3gMYjQFqsKL252isDVHEDbpVxIzxPmN\nw1+WK8zRNdunAcHikeoKCuAPvlZ83gDQHp07dYdbuZvHwGj0nfxBLc9qt90XsBtC\n4IYR7c/bcLMmKXYf0qoQ4OzngsnPI5M+v9QEHvYWaKVwFY4CTcSNJEwfXw+BAeO5\nOA==\n-----END CERTIFICATE-----",
      key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDuLsggR0gJOJJN\nXH6ZrrEfE61xt3rAZbeeTGUKQnVS5Xw2Zjmi8ywacYOEkm1RDaPmKDkFwlR/e17O\noI1bi0qdI6BIhJ8QAq+mfYE+9oWrfLHZiPPSu69wYqkMxkFeYH8AC0bI39QVfOSt\nx+mmYsclNoFgYboqeZTjeA+RIPLiLDjoIkVQ66lznUAUjPtGwTuZtPWmUIzx7vmB\n+pplKfaT5abL7yfUcbJgeFUhJFW8+qRLuBUtJUR1N5pS0o/VXH/zXz8cNaTegi8N\nVYj0IUfvd6U3EGQwfnMCtI0gFN6F2d6HIB6+NjhFoL+QryuyU7d7gS0n1KcDizA6\nMKKoAhATAgMBAAECggEAd5g/3o1MK20fcP7PhsVDpHIR9faGCVNJto9vcI5cMMqP\n6xS7PgnSDFkRC6EmiLtLn8Z0k2K3YOeGfEP7lorDZVG9KoyE/doLbpK4MfBAwBG1\nj6AHpbmd5tVzQrnNmuDjBBelbDmPWVbD0EqAFI6mphXPMqD/hFJWIz1mu52Kt2s6\n++MkdqLO0ORDNhKmzu6SADQEcJ9Suhcmv8nccMmwCsIQAUrfg3qOyqU4//8QB8ZM\njosO3gMUesihVeuF5XpptFjrAliPgw9uIG0aQkhVbf/17qy0XRi8dkqXj3efxEDp\n1LSqZjBFiqJlFchbz19clwavMF/FhxHpKIhhmkkRSQKBgQD9blaWSg/2AGNhRfpX\nYq+6yKUkUD4jL7pmX1BVca6dXqILWtHl2afWeUorgv2QaK1/MJDH9Gz9Gu58hJb3\nymdeAISwPyHp8euyLIfiXSAi+ibKXkxkl1KQSweBM2oucnLsNne6Iv6QmXPpXtro\nnTMoGQDS7HVRy1on5NQLMPbUBQKBgQDwmN+um8F3CW6ZV1ZljJm7BFAgNyJ7m/5Q\nYUcOO5rFbNsHexStrx/h8jYnpdpIVlxACjh1xIyJ3lOCSAWfBWCS6KpgeO1Y484k\nEYhGjoUsKNQia8UWVt+uWnwjVSDhQjy5/pSH9xyFrUfDg8JnSlhsy0oC0C/PBjxn\nhxmADSLnNwKBgQD2A51USVMTKC9Q50BsgeU6+bmt9aNMPvHAnPf76d5q78l4IlKt\nwMs33QgOExuYirUZSgjRwknmrbUi9QckRbxwOSqVeMOwOWLm1GmYaXRf39u2CTI5\nV9gTMHJ5jnKd4gYDnaA99eiOcBhgS+9PbgKSAyuUlWwR2ciL/4uDzaVeDQKBgDym\nvRSeTRn99bSQMMZuuD5N6wkD/RxeCbEnpKrw2aZVN63eGCtkj0v9LCu4gptjseOu\n7+a4Qplqw3B/SXN5/otqPbEOKv8Shl/PT6RBv06PiFKZClkEU2T3iH27sws2EGru\nw3C3GaiVMxcVewdg1YOvh5vH8ZVlxApxIzuFlDvnAoGAN5w+gukxd5QnP/7hcLDZ\nF+vesAykJX71AuqFXB4Wh/qFY92CSm7ImexWA/L9z461+NKeJwb64Nc53z59oA10\n/3o2OcIe44kddZXQVP6KTZBd7ySVhbtOiK3/pCy+BQRsrC7d71W914DxNWadwZ+a\njtwwKjDzmPwdIXDSQarCx0U=\n-----END PRIVATE KEY-----",
      passphrase: "1234",
    };

    const server = Bun.serve({
      port: 0,
      tls: COMMON_CERT,
      fetch(req, server) {
        // upgrade the request to a WebSocket
        if (server.upgrade(req)) {
          return; // do not return a Response
        }
        return new Response("Upgrade failed :(", { status: 500 });
      },
      websocket: {
        message(ws, message) {
          ws.send(message);
          ws.close();
        }, // a message is received
        open(ws) {
          // a socket is opened
          ws.send("Hello from Bun!");
        },
      },
    });

    try {
      function testClient(client) {
        const { promise, resolve, reject } = Promise.withResolvers();
        let messages = [];
        client.onopen = () => {
          client.send("Hello from client!");
        };
        client.onmessage = e => {
          messages.push(e.data);
        };
        client.onerror = reject;
        client.onclose = e => {
          resolve({ result: e, messages });
        };
        return promise;
      }
      const url = `wss://127.0.0.1:${server.address.port}`;
      {
        // by default rejectUnauthorized is true
        const client = WebSocket(url);
        const { result, messages } = await testClient(client);
        expect(["Hello from Bun!", "Hello from client!"]).not.toEqual(messages);
        expect(result.code).toBe(1006);
        expect(result.reason).toBe("Failed to connect");
      }

      {
        // just in case we change the default to true and test
        const client = WebSocket(url, { tls: { rejectUnauthorized: true } });
        const { result, messages } = await testClient(client);
        expect(["Hello from Bun!", "Hello from client!"]).not.toEqual(messages);
        expect(result.code).toBe(1006);
        expect(result.reason).toBe("Failed to connect");
      }
    } finally {
      server.stop(true);
    }
  });

  it("rejectUnauthorized should NOT reject self-sign certs when false", async () => {
    const COMMON_CERT = {
      cert: "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAKLdQVPy90jjMA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV\nBAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX\naWRnaXRzIFB0eSBMdGQwHhcNMTkwMjAzMTQ0OTM1WhcNMjAwMjAzMTQ0OTM1WjBF\nMQswCQYDVQQGEwJBVTETMBEGA1UECAwKU29tZS1TdGF0ZTEhMB8GA1UECgwYSW50\nZXJuZXQgV2lkZ2l0cyBQdHkgTHRkMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIB\nCgKCAQEA7i7IIEdICTiSTVx+ma6xHxOtcbd6wGW3nkxlCkJ1UuV8NmY5ovMsGnGD\nhJJtUQ2j5ig5BcJUf3tezqCNW4tKnSOgSISfEAKvpn2BPvaFq3yx2Yjz0ruvcGKp\nDMZBXmB/AAtGyN/UFXzkrcfppmLHJTaBYGG6KnmU43gPkSDy4iw46CJFUOupc51A\nFIz7RsE7mbT1plCM8e75gfqaZSn2k+Wmy+8n1HGyYHhVISRVvPqkS7gVLSVEdTea\nUtKP1Vx/818/HDWk3oIvDVWI9CFH73elNxBkMH5zArSNIBTehdnehyAevjY4RaC/\nkK8rslO3e4EtJ9SnA4swOjCiqAIQEwIDAQABo1AwTjAdBgNVHQ4EFgQUv5rc9Smm\n9c4YnNf3hR49t4rH4yswHwYDVR0jBBgwFoAUv5rc9Smm9c4YnNf3hR49t4rH4ysw\nDAYDVR0TBAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEATcL9CAAXg0u//eYUAlQa\nL+l8yKHS1rsq1sdmx7pvsmfZ2g8ONQGfSF3TkzkI2OOnCBokeqAYuyT8awfdNUtE\nEHOihv4ZzhK2YZVuy0fHX2d4cCFeQpdxno7aN6B37qtsLIRZxkD8PU60Dfu9ea5F\nDDynnD0TUabna6a0iGn77yD8GPhjaJMOz3gMYjQFqsKL252isDVHEDbpVxIzxPmN\nw1+WK8zRNdunAcHikeoKCuAPvlZ83gDQHp07dYdbuZvHwGj0nfxBLc9qt90XsBtC\n4IYR7c/bcLMmKXYf0qoQ4OzngsnPI5M+v9QEHvYWaKVwFY4CTcSNJEwfXw+BAeO5\nOA==\n-----END CERTIFICATE-----",
      key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDuLsggR0gJOJJN\nXH6ZrrEfE61xt3rAZbeeTGUKQnVS5Xw2Zjmi8ywacYOEkm1RDaPmKDkFwlR/e17O\noI1bi0qdI6BIhJ8QAq+mfYE+9oWrfLHZiPPSu69wYqkMxkFeYH8AC0bI39QVfOSt\nx+mmYsclNoFgYboqeZTjeA+RIPLiLDjoIkVQ66lznUAUjPtGwTuZtPWmUIzx7vmB\n+pplKfaT5abL7yfUcbJgeFUhJFW8+qRLuBUtJUR1N5pS0o/VXH/zXz8cNaTegi8N\nVYj0IUfvd6U3EGQwfnMCtI0gFN6F2d6HIB6+NjhFoL+QryuyU7d7gS0n1KcDizA6\nMKKoAhATAgMBAAECggEAd5g/3o1MK20fcP7PhsVDpHIR9faGCVNJto9vcI5cMMqP\n6xS7PgnSDFkRC6EmiLtLn8Z0k2K3YOeGfEP7lorDZVG9KoyE/doLbpK4MfBAwBG1\nj6AHpbmd5tVzQrnNmuDjBBelbDmPWVbD0EqAFI6mphXPMqD/hFJWIz1mu52Kt2s6\n++MkdqLO0ORDNhKmzu6SADQEcJ9Suhcmv8nccMmwCsIQAUrfg3qOyqU4//8QB8ZM\njosO3gMUesihVeuF5XpptFjrAliPgw9uIG0aQkhVbf/17qy0XRi8dkqXj3efxEDp\n1LSqZjBFiqJlFchbz19clwavMF/FhxHpKIhhmkkRSQKBgQD9blaWSg/2AGNhRfpX\nYq+6yKUkUD4jL7pmX1BVca6dXqILWtHl2afWeUorgv2QaK1/MJDH9Gz9Gu58hJb3\nymdeAISwPyHp8euyLIfiXSAi+ibKXkxkl1KQSweBM2oucnLsNne6Iv6QmXPpXtro\nnTMoGQDS7HVRy1on5NQLMPbUBQKBgQDwmN+um8F3CW6ZV1ZljJm7BFAgNyJ7m/5Q\nYUcOO5rFbNsHexStrx/h8jYnpdpIVlxACjh1xIyJ3lOCSAWfBWCS6KpgeO1Y484k\nEYhGjoUsKNQia8UWVt+uWnwjVSDhQjy5/pSH9xyFrUfDg8JnSlhsy0oC0C/PBjxn\nhxmADSLnNwKBgQD2A51USVMTKC9Q50BsgeU6+bmt9aNMPvHAnPf76d5q78l4IlKt\nwMs33QgOExuYirUZSgjRwknmrbUi9QckRbxwOSqVeMOwOWLm1GmYaXRf39u2CTI5\nV9gTMHJ5jnKd4gYDnaA99eiOcBhgS+9PbgKSAyuUlWwR2ciL/4uDzaVeDQKBgDym\nvRSeTRn99bSQMMZuuD5N6wkD/RxeCbEnpKrw2aZVN63eGCtkj0v9LCu4gptjseOu\n7+a4Qplqw3B/SXN5/otqPbEOKv8Shl/PT6RBv06PiFKZClkEU2T3iH27sws2EGru\nw3C3GaiVMxcVewdg1YOvh5vH8ZVlxApxIzuFlDvnAoGAN5w+gukxd5QnP/7hcLDZ\nF+vesAykJX71AuqFXB4Wh/qFY92CSm7ImexWA/L9z461+NKeJwb64Nc53z59oA10\n/3o2OcIe44kddZXQVP6KTZBd7ySVhbtOiK3/pCy+BQRsrC7d71W914DxNWadwZ+a\njtwwKjDzmPwdIXDSQarCx0U=\n-----END PRIVATE KEY-----",
      passphrase: "1234",
    };

    const server = Bun.serve({
      port: 0,
      tls: COMMON_CERT,
      fetch(req, server) {
        // upgrade the request to a WebSocket
        if (server.upgrade(req)) {
          return; // do not return a Response
        }
        return new Response("Upgrade failed :(", { status: 500 });
      },
      websocket: {
        message(ws, message) {
          ws.send(message);
          ws.close();
        }, // a message is received
        open(ws) {
          // a socket is opened
          ws.send("Hello from Bun!");
        },
      },
    });

    try {
      function testClient(client) {
        const { promise, resolve, reject } = Promise.withResolvers();
        let messages = [];
        client.onopen = () => {
          client.send("Hello from client!");
        };
        client.onmessage = e => {
          messages.push(e.data);
        };
        client.onerror = reject;
        client.onclose = e => {
          resolve({ result: e, messages });
        };
        return promise;
      }
      const url = `wss://127.0.0.1:${server.address.port}`;

      {
        // should allow self-signed certs when rejectUnauthorized is false
        const client = WebSocket(url, { tls: { rejectUnauthorized: false } });
        const { result, messages } = await testClient(client);
        expect(["Hello from Bun!", "Hello from client!"]).toEqual(messages);
        expect(result.code).toBe(1000);
      }
    } finally {
      server.stop(true);
    }
  });

  it("should not accept untrusted certificates", async () => {
    const UNTRUSTED_CERT = {
      key: readFileSync(join(import.meta.dir, "..", "..", "node", "http", "fixtures", "openssl.key")),
      cert: readFileSync(join(import.meta.dir, "..", "..", "node", "http", "fixtures", "openssl.crt")),
      passphrase: "123123123",
    };

    const server = Bun.serve({
      port: 0,
      tls: UNTRUSTED_CERT,
      fetch(req, server) {
        // upgrade the request to a WebSocket
        if (server.upgrade(req)) {
          return; // do not return a Response
        }
        return new Response("Upgrade failed :(", { status: 500 });
      },
      websocket: {
        message(ws, message) {
          ws.send(message);
          ws.close();
        }, // a message is received
        open(ws) {
          // a socket is opened
          ws.send("Hello from Bun!");
        },
      },
    });

    try {
      function testClient(client) {
        const { promise, resolve, reject } = Promise.withResolvers();
        let messages = [];
        client.onopen = () => {
          client.send("Hello from client!");
        };
        client.onmessage = e => {
          messages.push(e.data);
        };
        client.onerror = reject;
        client.onclose = e => {
          resolve({ result: e, messages });
        };
        return promise;
      }
      const url = `wss://localhost:${server.address.port}`;
      {
        const client = WebSocket(url);
        const { result, messages } = await testClient(client);
        expect(["Hello from Bun!", "Hello from client!"]).not.toEqual(messages);
        expect(result.code).toBe(1006);
        expect(result.reason).toBe("Failed to connect");
      }
    } finally {
      server.stop(true);
    }
  });

  it("supports headers", done => {
    const server = Bun.serve({
      port: 0,
      fetch(req, server) {
        expect(req.headers.get("X-Hello")).toBe("World");
        expect(req.headers.get("content-type")).toBe("lolwut");
        server.stop();
        done();
        return new Response();
      },
      websocket: {
        open(ws) {
          ws.close();
        },
      },
    });
    const ws = new WebSocket(`ws://${server.hostname}:${server.port}`, {
      headers: {
        "X-Hello": "World",
        "content-type": "lolwut",
      },
    });
  });

  it("should FAIL to connect over http when the status code is invalid", done => {
    const server = Bun.serve({
      port: 0,
      fetch(req, server) {
        server.stop();
        return new Response();
      },
      websocket: {
        open(ws) {},
        message(ws) {
          ws.close();
        },
        close() {},
      },
    });
    var ws = new WebSocket(`http://${server.hostname}:${server.port}`, {});
    ws.onopen = () => {
      ws.send("Hello World!");
    };

    ws.onclose = e => {
      expect(e.code).toBe(1002);
      done();
    };
  });

  it("should connect over http ", done => {
    const server = Bun.serve({
      port: 0,
      fetch(req, server) {
        server.upgrade(req);
        server.stop();

        return new Response();
      },
      websocket: {
        open(ws) {},
        message(ws) {
          ws.close();
        },
        close() {},
      },
    });
    var ws = new WebSocket(`http://${server.hostname}:${server.port}`, {});
    ws.onopen = () => {
      ws.send("Hello World!");
    };

    ws.onclose = () => {
      done();
    };
  });
  describe("nodebuffer", () => {
    it("should support 'nodebuffer' binaryType", done => {
      const server = Bun.serve({
        port: 0,
        fetch(req, server) {
          if (server.upgrade(req)) {
            return;
          }

          return new Response();
        },
        websocket: {
          open(ws) {
            ws.sendBinary(new Uint8Array([1, 2, 3]));
          },
        },
      });
      const ws = new WebSocket(`http://${server.hostname}:${server.port}`, {});
      ws.binaryType = "nodebuffer";
      expect(ws.binaryType).toBe("nodebuffer");
      Bun.gc(true);
      ws.onmessage = ({ data }) => {
        ws.close();
        expect(Buffer.isBuffer(data)).toBe(true);
        expect(data).toEqual(new Uint8Array([1, 2, 3]));
        server.stop(true);
        Bun.gc(true);
        done();
      };
    });

    it("should support 'nodebuffer' binaryType when the handler is not immediately provided", done => {
      var client;
      const server = Bun.serve({
        port: 0,
        fetch(req, server) {
          if (server.upgrade(req)) {
            return;
          }

          return new Response();
        },
        websocket: {
          open(ws) {
            ws.sendBinary(new Uint8Array([1, 2, 3]));
            client.onmessage = ({ data }) => {
              client.close();
              expect(Buffer.isBuffer(data)).toBe(true);
              expect(data).toEqual(new Uint8Array([1, 2, 3]));
              server.stop(true);
              done();
            };
          },
        },
      });
      client = new WebSocket(`http://${server.hostname}:${server.port}`, {});
      client.binaryType = "nodebuffer";
      expect(client.binaryType).toBe("nodebuffer");
    });
  });

  it("should send and receive messages", async () => {
    const ws = new WebSocket(TEST_WEBSOCKET_HOST);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
      ws.onclose = () => {
        reject("WebSocket closed");
      };
    });
    const count = 10;

    // 10 messages in burst
    var promise = new Promise((resolve, reject) => {
      var remain = count;
      ws.onmessage = event => {
        gc(true);
        expect(event.data).toBe("Hello World!");
        remain--;

        if (remain <= 0) {
          ws.onmessage = () => {};
          resolve();
        }
      };
      ws.onerror = reject;
    });

    for (let i = 0; i < count; i++) {
      ws.send("Hello World!");
      gc(true);
    }

    await promise;
    var echo = 0;

    // 10 messages one at a time
    function waitForEcho() {
      return new Promise((resolve, reject) => {
        gc(true);
        const msg = `Hello World! ${echo++}`;
        ws.onmessage = event => {
          expect(event.data).toBe(msg);
          resolve();
        };
        ws.onerror = reject;
        ws.onclose = reject;
        ws.send(msg);
        gc(true);
      });
    }
    gc(true);
    for (let i = 0; i < count; i++) await waitForEcho();
    ws.onclose = () => {};
    ws.onerror = () => {};
    ws.close();
    gc(true);
  });

  it("should report failing websocket construction to onerror/onclose", async () => {
    let did_report_error = false;
    let did_report_close = false;

    try {
      const url = `wss://some-random-domain.smth`;
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(url, {});
        let timeout = setTimeout(() => {
          reject.call();
        }, 500);

        ws.onclose = () => {
          did_report_close = true;
          clearTimeout(timeout);
          resolve.call();
        };

        ws.onerror = () => {
          did_report_error = true;
        };
      });
    } finally {
    }

    expect(did_report_error).toBe(true);
    expect(did_report_close).toBe(true);
  });
});

describe("websocket in subprocess", () => {
  it("should exit", async () => {
    let messageReceived = false;
    const server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }

        return new Response("http response");
      },
      websocket: {
        open(ws) {
          ws.send("hello websocket");
        },
        message(ws) {
          messageReceived = true;
          ws.close();
        },
        close(ws) {},
      },
    });
    const subprocess = Bun.spawn({
      cmd: [bunExe(), import.meta.dir + "/websocket-subprocess.ts", `http://${server.hostname}:${server.port}`],
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
      env: bunEnv,
    });

    expect(await subprocess.exited).toBe(0);
    expect(messageReceived).toBe(true);
    server.stop(true);
  });

  it("should exit after killed", async () => {
    const subprocess = Bun.spawn({
      cmd: [bunExe(), import.meta.dir + "/websocket-subprocess.ts", TEST_WEBSOCKET_HOST],
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
      env: bunEnv,
    });

    subprocess.kill();

    if (isWindows) {
      expect(await subprocess.exited).toBe(1);
    } else {
      expect(await subprocess.exited).toBe(143);
    }
  });

  it("should exit with invalid url", async () => {
    const subprocess = Bun.spawn({
      cmd: [bunExe(), import.meta.dir + "/websocket-subprocess.ts", "invalid url"],
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
      env: bunEnv,
    });

    expect(await subprocess.exited).toBe(1);
  });

  it("should exit after timeout", async () => {
    let messageReceived = false;
    let start = 0;
    const server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }

        return new Response("http response");
      },
      websocket: {
        open(ws) {
          start = performance.now();
          ws.send("timeout");
        },
        message(ws, message) {
          messageReceived = true;
          expect(performance.now() - start >= 300).toBe(true);
          ws.close();
        },
        close(ws) {},
      },
    });
    const subprocess = Bun.spawn({
      cmd: [bunExe(), import.meta.dir + "/websocket-subprocess.ts", `http://${server.hostname}:${server.port}`],
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
      env: bunEnv,
    });

    expect(await subprocess.exited).toBe(0);
    expect(messageReceived).toBe(true);
    server.stop(true);
  });

  it("should exit after server stop and 0 messages", async () => {
    const { promise, resolve } = Promise.withResolvers();
    const server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }

        return new Response("http response");
      },
      websocket: {
        open(ws) {
          resolve();
        },
        message(ws, message) {},
        close(ws) {},
      },
    });

    const subprocess = Bun.spawn({
      cmd: [bunExe(), import.meta.dir + "/websocket-subprocess.ts", `http://${server.hostname}:${server.port}`],
      stderr: "inherit",
      stdin: "inherit",
      stdout: "inherit",
      env: bunEnv,
    });
    await promise;
    server.stop(true);
    expect(await subprocess.exited).toBe(0);
  });
});
