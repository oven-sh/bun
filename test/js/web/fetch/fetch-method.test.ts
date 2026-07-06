import { describe, expect, test } from "bun:test";
import type { AddressInfo } from "node:net";
import net from "node:net";

// Raw-socket server: hand back the verbatim request line so the assertions see
// the bytes that actually went out, not what Bun echoes back in `request.method`.
async function requestLine(run: (url: string) => Promise<unknown>): Promise<string> {
  const { promise: line, resolve, reject } = Promise.withResolvers<string>();

  const server = net.createServer(socket => {
    let buffered = "";
    socket.on("error", reject);
    socket.on("data", chunk => {
      buffered += chunk.toString("latin1");
      if (!buffered.includes("\r\n\r\n")) return;
      resolve(buffered.slice(0, buffered.indexOf("\r\n")));
      socket.end("HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
    });
  });
  server.on("error", reject);

  try {
    await new Promise<void>(listening => server.listen(0, "127.0.0.1", listening));
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    return await line;
  } finally {
    server.close();
  }
}

const wireMethod = (method: string) => requestLine(url => fetch(url, { method })).then(line => line.split(" ")[0]);

// Redirects once, then answers 200. Returns the method of every request line the
// server saw, so a custom method's token can be watched across hops: it borrows
// FetchTasklet-owned storage that the HTTP thread reads again on the second hop.
async function redirectedMethods(status: number, init: RequestInit): Promise<string[]> {
  const methods: string[] = [];
  const { promise: finished, resolve, reject } = Promise.withResolvers<void>();

  const server = net.createServer(socket => {
    let buffered = "";
    socket.on("error", reject);
    socket.on("data", chunk => {
      buffered += chunk.toString("latin1");
      if (!buffered.includes("\r\n\r\n")) return;
      if (methods.length === 2) return; // trailing body bytes of hop 2
      methods.push(buffered.slice(0, buffered.indexOf(" ")));
      if (methods.length === 1) {
        socket.end(`HTTP/1.1 ${status} Redirect\r\nLocation: /hop2\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
      } else {
        socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
        resolve();
      }
    });
  });
  server.on("error", reject);

  try {
    await new Promise<void>(listening => server.listen(0, "127.0.0.1", listening));
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`, init);
    expect(await res.text()).toBe("ok");
    await finished;
    return methods;
  } finally {
    server.close();
  }
}

describe("fetch() method", () => {
  // https://fetch.spec.whatwg.org/#concept-method-normalize — only these six
  // are case-normalized, and only to uppercase.
  test.each([
    ["DELETE", "DELETE"],
    ["Delete", "DELETE"],
    ["delete", "DELETE"],
    ["GET", "GET"],
    ["Get", "GET"],
    ["HEAD", "HEAD"],
    ["hEaD", "HEAD"],
    ["OPTIONS", "OPTIONS"],
    ["Options", "OPTIONS"],
    ["POST", "POST"],
    ["pOsT", "POST"],
    ["PUT", "PUT"],
    ["Put", "PUT"],
    ["put", "PUT"],
  ])("normalizes %p to %p", async (input, expected) => {
    expect(await wireMethod(input)).toBe(expected);
  });

  // Everything else reaches the server exactly as written.
  test.each([
    "PATCH",
    "patch",
    "pAtCh",
    "PROPFIND",
    "Propfind",
    "propfind",
    "PROPPATCH",
    "MKCALENDAR",
    "REPORT",
    "QUERY",
    "BREW",
    "X-Custom_1",
    "a!#$%&'*+-.^_`|~0",
  ])("forwards %p byte-for-byte", async input => {
    expect(await wireMethod(input)).toBe(input);
  });

  test("a custom method may carry a body", async () => {
    expect(await requestLine(url => fetch(url, { method: "BREW", body: "coffee" }))).toBe("BREW / HTTP/1.1");
  });

  test("a Request's method survives being passed to fetch()", async () => {
    const line = await requestLine(url => fetch(new Request(url, { method: "Propfind" })));
    expect(line).toBe("Propfind / HTTP/1.1");
  });

  // A custom method's wire bytes are borrowed from the FetchTasklet, and a
  // redirect re-reads them on the HTTP thread for the next hop.
  test("a custom method survives a 302 redirect", async () => {
    expect(await redirectedMethods(302, { method: "BREW" })).toEqual(["BREW", "BREW"]);
  });

  test("a custom method with a body survives a 307 redirect", async () => {
    expect(await redirectedMethods(307, { method: "Propfind", body: "x" })).toEqual(["Propfind", "Propfind"]);
  });

  // https://fetch.spec.whatwg.org/#http-redirect-fetch step 11: 303 rewrites
  // anything that is not GET or HEAD, 301/302 rewrite only POST.
  test("303 rewrites a custom method to GET, 302 does not", async () => {
    expect(await redirectedMethods(303, { method: "BREW" })).toEqual(["BREW", "GET"]);
    expect(await redirectedMethods(302, { method: "POST", body: "x" })).toEqual(["POST", "GET"]);
  });

  test.each(["", "GET POST", "GET\n", "foo bar", "GET/1", "@GET", "GET\u00ff"])(
    "rejects on the invalid token %p",
    async input => {
      await expect(fetch("http://127.0.0.1:1/", { method: input })).rejects.toThrow(/is not a valid HTTP method/);
    },
  );

  // https://fetch.spec.whatwg.org/#forbidden-method
  test.each(["CONNECT", "TRACE", "TRACK", "connect", "TrAcE"])("rejects on the forbidden method %p", async input => {
    await expect(fetch("http://127.0.0.1:1/", { method: input })).rejects.toThrow(/HTTP method is unsupported/);
  });
});

describe("new Request() method", () => {
  test.each([
    ["Put", "PUT"],
    ["delete", "DELETE"],
    ["pOsT", "POST"],
    ["PATCH", "PATCH"],
    ["patch", "patch"],
    ["pAtCh", "pAtCh"],
    ["Propfind", "Propfind"],
    ["BREW", "BREW"],
  ])("reports %p as %p", (input, expected) => {
    expect(new Request("http://example.com/", { method: input }).method).toBe(expected);
    expect(new Request("http://example.com/", { method: input }).clone().method).toBe(expected);
  });

  test("copies the method from another Request", () => {
    const source = new Request("http://example.com/", { method: "BREW" });
    expect(new Request(source).method).toBe("BREW");
    expect(new Request("http://example.com/other", source).method).toBe("BREW");
  });

  test.each(["", "GET POST", "foo bar", "@GET"])("throws a TypeError on the invalid token %p", input => {
    expect(() => new Request("http://example.com/", { method: input })).toThrow(/is not a valid HTTP method/);
    expect(() => new Request("http://example.com/", { method: input })).toThrow(TypeError);
  });

  test.each(["CONNECT", "TRACE", "TRACK"])("throws a TypeError on the forbidden method %p", input => {
    expect(() => new Request("http://example.com/", { method: input })).toThrow(/HTTP method is unsupported/);
    expect(() => new Request("http://example.com/", { method: input })).toThrow(TypeError);
  });

  // `init["method"]` keys on WebIDL presence, so only `undefined` falls through
  // to the default; everything else is stringified and validated as a token.
  test("only undefined falls through to GET", () => {
    const method = (init: RequestInit) => new Request("http://example.com/", init).method;
    expect(method({})).toBe("GET");
    expect(method({ method: undefined })).toBe("GET");
    expect(method({ method: null as never })).toBe("null");
    expect(method({ method: 0 as never })).toBe("0");
    expect(method({ method: false as never })).toBe("false");
  });
});
