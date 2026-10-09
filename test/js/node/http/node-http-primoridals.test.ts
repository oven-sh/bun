import { afterEach, expect, test } from "bun:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { text } from "node:stream/consumers";
import vm from "node:vm";

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
  } as any;
  globalThis.Request = class MyRequest {} as any;
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
  } as any;
  globalThis.Blob = class MyBlob {} as any;

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

async function withEchoServer(run: (http: typeof import("node:http"), origin: string) => Promise<void>) {
  // Not imported: the test above is about loading node:http with the globals replaced.
  const http = require("node:http");
  const server = http.createServer((req, res) => {
    let body = "";
    req
      .on("data", chunk => (body += chunk))
      .on("end", () => {
        res.write(`${req.url} ${body} `);
        res.write(uint8ArrayOfAnotherRealm());
        res.end(uint8ArrayOfAnotherRealm());
      });
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  try {
    await run(http, `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

function uint8ArrayOfAnotherRealm(): Uint8Array {
  return vm.runInNewContext("new Uint8Array([97, 98])");
}

test("a Uint8Array of another realm is a chunk", async () => {
  await withEchoServer(async (http, origin) => {
    const request = http.request(origin + "/", { method: "POST" });
    request.write(uint8ArrayOfAnotherRealm());
    request.end(uint8ArrayOfAnotherRealm());
    const [response] = await once(request, "response");
    expect(await text(response)).toBe("/ abab abab");
  });
});

test("a URL of another implementation is a URL", async () => {
  function foreignURL(input: string) {
    const { href, origin, protocol, username, password, host, hostname, port, pathname, search, hash } = new URL(input);
    return { href, origin, protocol, username, password, host, hostname, port, pathname, search, hash };
  }
  await withEchoServer(async (http, origin) => {
    const [response] = await once(http.get(foreignURL(origin + "/path?query")), "response");
    expect(await text(response)).toBe("/path?query  abab");
  });
  const request = require("node:https")
    .request(foreignURL("https://127.0.0.1:1/path?query"))
    .on("error", () => {});
  expect(request.path).toBe("/path?query");
  request.destroy();
});

test("does not read URL from globalThis", async () => {
  const { URL } = globalThis;
  globalThis.URL = class {} as unknown as typeof URL;
  try {
    await withEchoServer(async (http, origin) => {
      const [response] = await once(http.get(origin + "/path?query"), "response");
      expect(await text(response)).toBe("/path?query  abab");
    });
  } finally {
    globalThis.URL = URL;
  }
});
