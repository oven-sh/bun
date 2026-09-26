import { afterEach, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const Response = globalThis.Response;
const Request = globalThis.Request;
const Headers = globalThis.Headers;
const Blob = globalThis.Blob;

afterEach(() => {
  globalThis.Response = Response;
  globalThis.Request = Request;
  globalThis.Headers = Headers;
  globalThis.Blob = Blob;
});

// This test passes by not hanging.
test("Overriding Request, Response, Headers, and Blob should not break node:http server", async () => {
  const Response = globalThis.Response;
  const Request = globalThis.Request;
  const Headers = globalThis.Headers;
  const Blob = globalThis.Blob;

  globalThis.Response = class MyResponse {
    get body() {
      throw new Error("body getter should not be called");
    }

    get headers() {
      throw new Error("headers getter should not be called");
    }

    get status() {
      throw new Error("status getter should not be called");
    }

    get statusText() {
      throw new Error("statusText getter should not be called");
    }

    get ok() {
      throw new Error("ok getter should not be called");
    }

    get url() {
      throw new Error("url getter should not be called");
    }

    get type() {
      throw new Error("type getter should not be called");
    }
  };
  globalThis.Request = class MyRequest {};
  globalThis.Headers = class MyHeaders {
    entries() {
      throw new Error("entries should not be called");
    }

    get() {
      throw new Error("get should not be called");
    }

    has() {
      throw new Error("has should not be called");
    }

    keys() {
      throw new Error("keys should not be called");
    }

    values() {
      throw new Error("values should not be called");
    }

    forEach() {
      throw new Error("forEach should not be called");
    }

    [Symbol.iterator]() {
      throw new Error("[Symbol.iterator] should not be called");
    }

    [Symbol.toStringTag]() {
      throw new Error("[Symbol.toStringTag] should not be called");
    }

    append() {
      throw new Error("append should not be called");
    }
  };
  globalThis.Blob = class MyBlob {};

  const http = require("http");
  const server = http.createServer((req, res) => {
    res.end("Hello World\n");
  });
  const { promise, resolve, reject } = Promise.withResolvers();

  server.listen(0, () => {
    const { port } = server.address();
    // client request
    const req = http
      .request(`http://localhost:${port}`, res => {
        res
          .on("data", data => {
            expect(data.toString()).toBe("Hello World\n");
          })
          .on("end", () => {
            server.close();
            console.log("closing time");
          });
      })
      .on("error", reject)
      .end();
  });

  server.on("close", () => {
    resolve();
  });
  server.on("error", err => {
    reject(err);
  });

  try {
    await promise;
  } finally {
    globalThis.Response = Response;
    globalThis.Request = Request;
    globalThis.Headers = Headers;
    globalThis.Blob = Blob;
  }
});

// The response header count is bounded with the engine's own min(), so a
// user-patched Math.min cannot make IncomingMessage read past the flat
// [name, value, ...] header array.
test("a patched Math.min does not reach IncomingMessage header parsing", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const http = require("http");
      const server = http.createServer((req, res) => {
        res.setHeader("x-server", "1");
        res.end("ok");
      });
      server.listen(0, "127.0.0.1", () => {
        const origMin = Math.min;
        Math.min = (...args) => origMin(...args) + 1;
        process.on("uncaughtException", err => {
          console.log("UNCAUGHT:", err.message);
          process.exit(1);
        });
        http.get({ host: "127.0.0.1", port: server.address().port, headers: { "x-h": "v" } }, res => {
          res.resume();
          res.on("end", () => {
            Math.min = origMin;
            console.log("client: got", res.statusCode, res.headers["x-server"]);
            server.close();
          });
        });
      });
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("client: got 200 1\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
