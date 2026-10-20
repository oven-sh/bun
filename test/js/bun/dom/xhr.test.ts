import {
  Document,
  ProgressEvent,
  Window,
  XMLDocument,
  XMLHttpRequest,
  XMLHttpRequestEventTarget,
  XMLHttpRequestUpload,
} from "bun:dom";
import { afterAll, beforeAll, describe, expect, jest, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const progressTypes = ["loadstart", "progress", "load", "abort", "error", "timeout", "loadend"];

// Each gate lets the next chunk of one "/gated" response go.
const gates = new Map<string, () => void>();
let server: ReturnType<typeof Bun.serve>;
let base: string;
let closedPort: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      switch (url.pathname) {
        case "/text":
        case "/dir/text":
          return new Response("hello", {
            headers: { "X-B": "2", "x-a": "1", "Set-Cookie": "a=b", "Set-Cookie2": "c=d" },
          });
        case "/json":
          return Response.json({ a: [1, "é"] });
        case "/not-json":
          return new Response("{", { headers: { "Content-Type": "application/json" } });
        case "/bytes":
          return new Response(new Uint8Array([0, 1, 2, 255]), { headers: { "Content-Type": "application/x-bytes" } });
        case "/html":
          return new Response("<!doctype html><title>T</title><p id=p>hi<script>globalThis.ranScript = true</script>", {
            headers: { "Content-Type": "text/html" },
          });
        case "/xml":
          return new Response("<a><b/></a>", { headers: { "Content-Type": "application/xml" } });
        case "/body":
          return new Response(Buffer.from(url.searchParams.get("hex")!, "hex"), {
            headers: { "Content-Type": url.searchParams.get("type")! },
          });
        case "/e-acute":
          return new Response(new Uint8Array([0xe9]), { headers: { "Content-Type": url.searchParams.get("type")! } });
        case "/utf16":
          return new Response(new Uint8Array([0xff, 0xfe, 0x68, 0, 0x69, 0]), {
            headers: { "Content-Type": "text/plain;charset=utf-8" },
          });
        case "/bom":
          return new Response(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]));
        case "/gzip":
          return new Response(Bun.gzipSync(Buffer.alloc(1000, "z")), {
            headers: { "Content-Encoding": "gzip", "Content-Type": "text/plain" },
          });
        case "/echo": {
          const body = Buffer.from(await request.arrayBuffer());
          return Response.json({
            method: request.method,
            headers: Object.fromEntries(request.headers),
            body: body.toString("latin1"),
          });
        }
        case "/404":
          return new Response("nope", { status: 404 });
        case "/204":
          return new Response(null, { status: 204 });
        case "/zero":
          return new Response("");
        case "/redirect":
          return new Response(null, { status: 302, headers: { Location: "/text#fragment" } });
        case "/never":
          return new Promise<Response>(() => {});
        case "/gated": {
          const id = url.searchParams.get("id")!;
          const chunks = url.searchParams.getAll("chunk").map(hex => Buffer.from(hex, "hex"));
          return new Response(
            new ReadableStream({
              async start(controller) {
                for (let i = 0; i < chunks.length; i++) {
                  if (i) await new Promise<void>(resolve => gates.set(id, resolve));
                  controller.enqueue(chunks[i]);
                }
                controller.close();
              },
            }),
            { headers: { "Content-Type": "text/plain" } },
          );
        }
      }
      return new Response("no such route", { status: 500 });
    },
  });
  base = server.url.href;

  const other = Bun.serve({ port: 0, fetch: () => new Response() });
  closedPort = other.url.href;
  other.stop(true);
});

afterAll(() => server.stop(true));

let lastGate = 0;
function gated(...chunks: (string | number[])[]) {
  const id = String(++lastGate);
  const query = chunks.map(chunk => "&chunk=" + Buffer.from(chunk as string).toString("hex")).join("");
  return { url: `${base}gated?id=${id}${query}`, release: () => gates.get(id)!() };
}

interface Options {
  method?: string;
  body?: any;
  headers?: [string, string][];
  responseType?: string;
  timeout?: number;
  upload?: boolean;
  mimeType?: string;
  Constructor?: typeof XMLHttpRequest;
  sent?(xhr: XMLHttpRequest, events: string[]): void;
  on?: Record<string, (xhr: XMLHttpRequest, events: string[]) => void>;
}

/** Writes down every event with the `readyState` at that time, until `loadend`. */
function listen(xhr: XMLHttpRequest, options: Options = {}) {
  const events: string[] = [];
  const { promise, resolve } = Promise.withResolvers<{ xhr: XMLHttpRequest; events: string[] }>();
  xhr.addEventListener("readystatechange", () => {
    events.push(`readystatechange ${xhr.readyState}`);
    options.on?.[`readystatechange ${xhr.readyState}`]?.(xhr, events);
  });
  for (const type of progressTypes) {
    xhr.addEventListener(type, event => {
      const { loaded, total, lengthComputable } = event as ProgressEvent;
      events.push(`${type} ${xhr.readyState} ${loaded}/${lengthComputable ? total : "?"}`);
      options.on?.[type]?.(xhr, events);
      if (type === "loadend") resolve({ xhr, events });
    });
    if (options.upload) {
      xhr.upload.addEventListener(type, event => {
        const { loaded, total, lengthComputable } = event as ProgressEvent;
        events.push(`upload ${type} ${loaded}/${lengthComputable ? total : "?"}`);
        options.on?.[`upload ${type}`]?.(xhr, events);
      });
    }
  }
  return { events, ended: promise };
}

function request(url: string, options: Options = {}) {
  const xhr = new (options.Constructor ?? XMLHttpRequest)();
  const { events, ended } = listen(xhr, options);
  xhr.open(options.method ?? "GET", url);
  for (const [name, value] of options.headers ?? []) xhr.setRequestHeader(name, value);
  if (options.responseType !== undefined) xhr.responseType = options.responseType as XMLHttpRequestResponseType;
  if (options.timeout !== undefined) xhr.timeout = options.timeout;
  if (options.mimeType !== undefined) xhr.overrideMimeType(options.mimeType);
  xhr.send(options.body);
  options.sent?.(xhr, events);
  return ended;
}

async function echo(options: Options) {
  const { xhr, events } = await request(base + "echo", { method: "POST", responseType: "json", ...options });
  return { ...(xhr.response as { method: string; headers: Record<string, string>; body: string }), events };
}

const named = (name: string) => expect.objectContaining({ name });

async function run(script: string) {
  await using process = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([process.stdout.text(), process.stderr.text(), process.exited]);
  return { stdout, stderr, exitCode };
}

describe("the classes", () => {
  test("are exports of bun:dom and properties of a window, and not globals", () => {
    const window = new Window();
    for (const [name, constructor] of Object.entries({
      XMLHttpRequest,
      XMLHttpRequestUpload,
      XMLHttpRequestEventTarget,
    })) {
      expect(window[name].prototype).toBe(constructor.prototype);
      expect(Object.hasOwn(window, name)).toBe(true);
      expect(name in globalThis).toBe(false);
    }
    expect(new window.XMLHttpRequest()).toBeInstanceOf(XMLHttpRequest);
  });

  test("inherit from EventTarget", () => {
    const xhr = new XMLHttpRequest();
    expect(xhr).toBeInstanceOf(XMLHttpRequestEventTarget);
    expect(xhr).toBeInstanceOf(EventTarget);
    expect(xhr.upload).toBeInstanceOf(XMLHttpRequestUpload);
    expect(xhr.upload).toBeInstanceOf(XMLHttpRequestEventTarget);
    expect(xhr.upload).toBeInstanceOf(EventTarget);
    expect(xhr.upload).toBe(xhr.upload);
    expect(Object.getPrototypeOf(XMLHttpRequest)).toBe(XMLHttpRequestEventTarget);
    expect(Object.prototype.toString.call(xhr)).toBe("[object XMLHttpRequest]");
    expect(Object.prototype.toString.call(xhr.upload)).toBe("[object XMLHttpRequestUpload]");
  });

  test("only XMLHttpRequest can be constructed", () => {
    expect(() => new (XMLHttpRequestUpload as any)()).toThrow(TypeError);
    expect(() => new (XMLHttpRequestEventTarget as any)()).toThrow(TypeError);
    expect(() => (XMLHttpRequest as any)()).toThrow(TypeError);
  });

  test("the states are constants of the class and of its instances", () => {
    const names = ["UNSENT", "OPENED", "HEADERS_RECEIVED", "LOADING", "DONE"];
    expect(names.map(name => XMLHttpRequest[name])).toEqual([0, 1, 2, 3, 4]);
    expect(names.map(name => new XMLHttpRequest()[name])).toEqual([0, 1, 2, 3, 4]);
  });

  test("a new request", () => {
    const xhr = new XMLHttpRequest();
    expect({
      readyState: xhr.readyState,
      status: xhr.status,
      statusText: xhr.statusText,
      responseURL: xhr.responseURL,
      responseType: xhr.responseType,
      response: xhr.response,
      responseText: xhr.responseText,
      responseXML: xhr.responseXML,
      timeout: xhr.timeout,
      withCredentials: xhr.withCredentials,
      headers: xhr.getAllResponseHeaders(),
      header: xhr.getResponseHeader("content-type"),
    }).toEqual({
      readyState: 0,
      status: 0,
      statusText: "",
      responseURL: "",
      responseType: "",
      response: "",
      responseText: "",
      responseXML: null,
      timeout: 0,
      withCredentials: false,
      headers: "",
      header: null,
    });
  });

  test("the attributes are configurable accessors on the prototype", () => {
    for (const name of ["readyState", "status", "statusText", "response", "responseText", "responseXML", "upload"]) {
      const descriptor = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, name)!;
      expect([name, typeof descriptor.get, descriptor.set, descriptor.configurable, descriptor.enumerable]).toEqual([
        name,
        "function",
        undefined,
        true,
        true,
      ]);
    }
    for (const name of ["timeout", "withCredentials", "responseType", "onreadystatechange"])
      expect(typeof Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, name)!.set).toBe("function");
    expect(Object.keys(new XMLHttpRequest())).toEqual([]);
  });

  test("withCredentials is kept", () => {
    const xhr = new XMLHttpRequest();
    xhr.withCredentials = true;
    expect(xhr.withCredentials).toBe(true);
  });

  test("an unknown responseType is ignored", () => {
    const xhr = new XMLHttpRequest();
    xhr.responseType = "moz-blob" as XMLHttpRequestResponseType;
    expect(xhr.responseType).toBe("");
  });
});

describe("the order of events", () => {
  test("a response with a body", async () => {
    const { xhr, events } = await request(base + "text");
    expect(events).toEqual([
      "readystatechange 1",
      "loadstart 1 0/?",
      "readystatechange 2",
      "readystatechange 3",
      "progress 3 5/5",
      "readystatechange 4",
      "load 4 5/5",
      "loadend 4 5/5",
    ]);
    expect([xhr.status, xhr.statusText, xhr.responseText, xhr.responseURL]).toEqual([
      200,
      "OK",
      "hello",
      base + "text",
    ]);
  });

  test("open() and send() fire readystatechange and loadstart before they return, and nothing else", async () => {
    const xhr = new XMLHttpRequest();
    const { events, ended } = listen(xhr);
    xhr.open("GET", base + "text");
    expect(events).toEqual(["readystatechange 1"]);
    xhr.send();
    expect(events).toEqual(["readystatechange 1", "loadstart 1 0/?"]);
    await Promise.resolve();
    expect(events.length).toBe(2);
    await ended;
  });

  test.each(["204", "zero"])("a response without a body: /%s", async path => {
    const { xhr, events } = await request(base + path);
    expect(events).toEqual([
      "readystatechange 1",
      "loadstart 1 0/?",
      "readystatechange 2",
      "readystatechange 4",
      "load 4 0/?",
      "loadend 4 0/?",
    ]);
    expect(xhr.responseText).toBe("");
  });

  test("HEAD", async () => {
    const { xhr, events } = await request(base + "text", { method: "HEAD" });
    expect(events.filter(event => event.startsWith("readystatechange"))).toEqual([
      "readystatechange 1",
      "readystatechange 2",
      "readystatechange 4",
    ]);
    expect([xhr.status, xhr.responseText, xhr.getResponseHeader("x-a")]).toEqual([200, "", "1"]);
  });

  test("a 404 is a response like any other", async () => {
    const { xhr, events } = await request(base + "404");
    expect(events).toEqual([
      "readystatechange 1",
      "loadstart 1 0/?",
      "readystatechange 2",
      "readystatechange 3",
      "progress 3 4/4",
      "readystatechange 4",
      "load 4 4/4",
      "loadend 4 4/4",
    ]);
    expect([xhr.status, xhr.statusText, xhr.responseText]).toEqual([404, "Not Found", "nope"]);
  });

  test("a network error", async () => {
    const { xhr, events } = await request(closedPort);
    expect(events).toEqual([
      "readystatechange 1",
      "loadstart 1 0/?",
      "readystatechange 4",
      "error 4 0/?",
      "loadend 4 0/?",
    ]);
    expect([xhr.status, xhr.statusText, xhr.responseText, xhr.responseURL, xhr.getAllResponseHeaders()]).toEqual([
      0,
      "",
      "",
      "",
      "",
    ]);
  });

  test("a scheme that fetch() does not know is a network error", async () => {
    const { events } = await request("ftp://localhost/file");
    expect(events.slice(2)).toEqual(["readystatechange 4", "error 4 0/?", "loadend 4 0/?"]);
  });

  test("one readystatechange and one progress for each chunk", async () => {
    const { url, release } = gated("one", "two", "three");
    const texts: string[] = [];
    const { events } = await request(url, {
      on: {
        progress(xhr) {
          texts.push(xhr.responseText);
          if (texts.length < 3) release();
        },
      },
    });
    expect(events).toEqual([
      "readystatechange 1",
      "loadstart 1 0/?",
      "readystatechange 2",
      "readystatechange 3",
      "progress 3 3/?",
      "readystatechange 3",
      "progress 3 6/?",
      "readystatechange 3",
      "progress 3 11/?",
      "readystatechange 4",
      "load 4 11/?",
      "loadend 4 11/?",
    ]);
    expect(texts).toEqual(["one", "onetwo", "onetwothree"]);
  });

  test("the headers are there before the body", async () => {
    // Bun.serve() sends the headers together with the first bytes of the body.
    let connection: Bun.Socket | undefined;
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket) {
          connection = socket;
          socket.write(
            "HTTP/1.1 200 OK\r\nContent-Type: text/x-test\r\nContent-Length: 4\r\nConnection: close\r\n\r\n",
          );
        },
      },
    });
    try {
      let seen: unknown[] = [];
      const { xhr, events } = await request(`http://127.0.0.1:${listener.port}/`, {
        on: {
          "readystatechange 2"(xhr) {
            seen = [xhr.status, xhr.getResponseHeader("content-type"), xhr.responseText];
            connection!.end("late");
          },
        },
      });
      expect(seen).toEqual([200, "text/x-test", ""]);
      expect(xhr.responseText).toBe("late");
      expect(events.slice(2)).toEqual([
        "readystatechange 2",
        "readystatechange 3",
        "progress 3 4/4",
        "readystatechange 4",
        "load 4 4/4",
        "loadend 4 4/4",
      ]);
    } finally {
      listener.stop(true);
    }
  });

  test("a script that waited for load is in time for loadend", async () => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", base + "text");
    xhr.send();
    await new Promise(resolve => xhr.addEventListener("load", resolve, { once: true }));
    await new Promise(resolve => xhr.addEventListener("loadend", resolve, { once: true }));
    expect(xhr.responseText).toBe("hello");
  });

  test("a request can be used again, from its own load listener too", async () => {
    const xhr = new XMLHttpRequest();
    const results: string[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    xhr.onload = () => {
      results.push(xhr.responseText);
      if (results.length === 2) return resolve();
      xhr.open("GET", base + "404");
      expect([xhr.readyState, xhr.status, xhr.responseText]).toEqual([1, 0, ""]);
      xhr.send();
    };
    xhr.open("GET", base + "text");
    xhr.send();
    await promise;
    expect(results).toEqual(["hello", "nope"]);
  });

  test("open() while a request is under way cancels it without events", async () => {
    const xhr = new XMLHttpRequest();
    const { events, ended } = listen(xhr);
    xhr.open("GET", base + "never");
    xhr.send();
    xhr.open("GET", base + "text");
    expect(events).toEqual(["readystatechange 1", "loadstart 1 0/?"]);
    xhr.send();
    await ended;
    expect(events.slice(2)).toEqual([
      "loadstart 1 0/?",
      "readystatechange 2",
      "readystatechange 3",
      "progress 3 5/5",
      "readystatechange 4",
      "load 4 5/5",
      "loadend 4 5/5",
    ]);
  });
});

describe("abort()", () => {
  test("does nothing before send()", () => {
    const xhr = new XMLHttpRequest();
    const { events } = listen(xhr);
    xhr.abort();
    expect([xhr.readyState, events]).toEqual([0, []]);
    xhr.open("GET", base + "text");
    xhr.abort();
    expect([xhr.readyState, events]).toEqual([1, ["readystatechange 1"]]);
  });

  test("after send() fires readystatechange, abort and loadend at once, and nothing afterwards", async () => {
    const xhr = new XMLHttpRequest();
    const { events } = listen(xhr);
    xhr.open("GET", base + "text");
    xhr.send();
    xhr.abort();
    const expected = ["readystatechange 1", "loadstart 1 0/?", "readystatechange 4", "abort 4 0/?", "loadend 4 0/?"];
    expect(events).toEqual(expected);
    expect([xhr.readyState, xhr.status, xhr.responseText]).toEqual([0, 0, ""]);

    expect((await request(base + "text")).xhr.responseText).toBe("hello");
    expect(events).toEqual(expected);
  });

  test("while the body arrives", async () => {
    const { url } = gated("one", "never sent");
    const { xhr, events } = await request(url, { on: { progress: xhr => xhr.abort() } });
    expect(events).toEqual([
      "readystatechange 1",
      "loadstart 1 0/?",
      "readystatechange 2",
      "readystatechange 3",
      "progress 3 3/?",
      "readystatechange 4",
      "abort 4 0/?",
      "loadend 4 0/?",
    ]);
    expect([xhr.readyState, xhr.status, xhr.responseText, xhr.getAllResponseHeaders()]).toEqual([0, 0, "", ""]);
  });

  test("from a loadstart listener", async () => {
    const { xhr, events } = await request(base + "text", { on: { loadstart: xhr => xhr.abort() } });
    expect(events).toEqual([
      "readystatechange 1",
      "loadstart 1 0/?",
      "readystatechange 4",
      "abort 4 0/?",
      "loadend 4 0/?",
    ]);
    expect(xhr.readyState).toBe(0);
  });

  test("tells the upload first", async () => {
    const { events } = await request(base + "never", {
      method: "POST",
      body: "abc",
      upload: true,
      sent: xhr => xhr.abort(),
    });
    expect(events).toEqual([
      "readystatechange 1",
      "loadstart 1 0/?",
      "upload loadstart 0/3",
      "readystatechange 4",
      "upload abort 0/?",
      "upload loadend 0/?",
      "abort 4 0/?",
      "loadend 4 0/?",
    ]);
  });

  test("after the request is done only resets the state", async () => {
    const { xhr, events } = await request(base + "text");
    const count = events.length;
    xhr.abort();
    expect([xhr.readyState, events.length]).toEqual([0, count]);
  });

  test("the server sees the connection close", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    using other = Bun.serve({
      port: 0,
      fetch(request) {
        request.signal.addEventListener("abort", () => resolve());
        xhr.abort();
        return new Promise<Response>(() => {});
      },
    });
    const xhr = new XMLHttpRequest();
    xhr.open("GET", other.url.href);
    xhr.send();
    await promise;
  });
});

describe("timeout", () => {
  const expected = ["readystatechange 1", "loadstart 1 0/?", "readystatechange 4", "timeout 4 0/?", "loadend 4 0/?"];

  test("a server that never answers", async () => {
    const { xhr, events } = await request(base + "never", { timeout: 10 });
    expect(events).toEqual(expected);
    expect([xhr.readyState, xhr.status, xhr.responseText, xhr.timeout]).toEqual([4, 0, "", 10]);
  });

  test("a body that never ends", async () => {
    const { url } = gated("one", "never sent");
    const { xhr, events } = await request(url, { timeout: 100 });
    expect(events.slice(-3)).toEqual(expected.slice(-3));
    expect(xhr.responseText).toBe("");
  });

  test("tells the upload first", async () => {
    const { events } = await request(base + "never", { method: "POST", body: "abc", upload: true, timeout: 10 });
    expect(events.slice(3)).toEqual([
      "readystatechange 4",
      "upload timeout 0/?",
      "upload loadend 0/?",
      "timeout 4 0/?",
      "loadend 4 0/?",
    ]);
  });

  test("runs on the real clock under fake timers", async () => {
    jest.useFakeTimers();
    try {
      expect((await request(base + "never", { timeout: 10 })).events).toEqual(expected);
    } finally {
      jest.useRealTimers();
    }
  });

  test("a request that ends in time hears nothing of it", async () => {
    const { events } = await request(base + "text", { timeout: 60_000 });
    expect(events.at(-1)).toBe("loadend 4 5/5");
  });
});

describe("the response", () => {
  test("text", async () => {
    const { xhr } = await request(base + "text", { responseType: "text" });
    expect([xhr.response, xhr.responseText]).toEqual(["hello", "hello"]);
  });

  test("json", async () => {
    const { xhr } = await request(base + "json", { responseType: "json" });
    expect(xhr.response).toEqual({ a: [1, "é"] });
    expect(xhr.response).toBe(xhr.response);
  });

  test("json that does not parse is null", async () => {
    expect((await request(base + "not-json", { responseType: "json" })).xhr.response).toBeNull();
    expect((await request(base + "zero", { responseType: "json" })).xhr.response).toBeNull();
  });

  test("json is UTF-8 whatever the headers say, less the byte order mark", async () => {
    expect(
      (await request(base + "bom", { responseType: "json", mimeType: "text/plain;charset=utf-16le" })).xhr.response,
    ).toEqual({});
  });

  test("arraybuffer", async () => {
    const { xhr } = await request(base + "bytes", { responseType: "arraybuffer" });
    expect(xhr.response).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(xhr.response)]).toEqual([0, 1, 2, 255]);
    expect(xhr.response).toBe(xhr.response);
  });

  test("blob", async () => {
    const { xhr } = await request(base + "bytes", { responseType: "blob" });
    expect(xhr.response).toBeInstanceOf(Blob);
    expect(xhr.response).not.toBeInstanceOf(File);
    expect([xhr.response.type, xhr.response.size]).toEqual(["application/x-bytes", 4]);
    expect([...(await xhr.response.bytes())]).toEqual([0, 1, 2, 255]);
    expect(xhr.response).toBe(xhr.response);
  });

  test.each(["json", "arraybuffer", "blob", "document"])("%s is null until the request is done", async responseType => {
    const seen: unknown[] = [];
    await request(base + "html", {
      responseType,
      on: {
        "readystatechange 2": xhr => seen.push(xhr.response),
        "readystatechange 3": xhr => seen.push(xhr.response),
      },
    });
    expect(seen).toEqual([null, null]);
  });

  test("document", async () => {
    const { xhr } = await request(base + "html", { responseType: "document" });
    const document = xhr.response as Document;
    expect(document).toBeInstanceOf(Document);
    expect(xhr.responseXML).toBe(document);
    expect([document.title, document.querySelector("#p")!.firstChild!.nodeValue]).toEqual(["T", "hi"]);
    expect([document.URL, document.contentType, document.defaultView]).toEqual([base + "html", "text/html", null]);
    expect("ranScript" in globalThis).toBe(false);
  });

  test("responseXML is null for HTML unless the type is document", async () => {
    const { xhr } = await request(base + "html");
    expect(xhr.responseXML).toBeNull();
    expect(xhr.responseText).toStartWith("<!doctype html>");
  });

  test.each(["", "document"])("responseXML is a document for XML, with the type %p", async responseType => {
    const { xhr } = await request(base + "xml", { responseType });
    const document = xhr.responseXML!;
    expect(document).toBeInstanceOf(XMLDocument);
    expect(xhr.responseXML).toBe(document);
    if (responseType) expect(xhr.response).toBe(document);
    expect(document.documentElement.outerHTML).toBe("<a><b/></a>");
    expect([document.URL, document.contentType, document.defaultView]).toEqual([base + "xml", "application/xml", null]);
  });

  /** A response with these bytes, or this Latin-1 text, and this Content-Type. */
  const body = (bytes: string | number[], type: string) =>
    `${base}body?hex=${Buffer.from(bytes as string, "latin1").toString("hex")}&type=${encodeURIComponent(type)}`;

  test.each([
    ["text/xml", "text/xml"],
    ["application/xhtml+xml", "application/xhtml+xml"],
    ["image/svg+xml", "image/svg+xml"],
    ["application/rss+xml;charset=utf-8", "application/rss+xml"],
    ["not-a-type", "text/xml"],
  ])("%p is a type of XML", async (type, contentType) => {
    const { xhr } = await request(body(`<p xmlns="http://www.w3.org/1999/xhtml"/>`, type));
    expect(xhr.responseXML).toBeInstanceOf(XMLDocument);
    expect(xhr.responseXML!.contentType).toBe(contentType);
    expect(xhr.responseXML!.documentElement.constructor.name).toBe("HTMLParagraphElement");
  });

  test.each(["", "document"])("responseXML is null for XML that is not well-formed, with the type %p", async type => {
    expect((await request(body("<a/>", "application/xml"), { responseType: type })).xhr.responseXML).not.toBeNull();
    for (const text of ["<a><b></a>", "<p:a/>", "", "hello"]) {
      const { xhr } = await request(body(text, "application/xml"), { responseType: type });
      expect(xhr.responseXML).toBeNull();
      if (!type) expect(xhr.responseText).toBe(text);
    }
  });

  describe("the encoding of XML", () => {
    const latin1 = `<?xml version="1.0" encoding="ISO-8859-1"?><a>\xE9</a>`;
    const utf16 = (text: string) => Array.from(Buffer.from(text, "utf16le"));

    test.each(["", "document"])("the XML declaration names it, with the type %p", async responseType => {
      const { xhr } = await request(body(latin1, "application/xml"), { responseType });
      expect(xhr.responseXML!.documentElement.textContent).toBe("é");
      if (!responseType) expect(xhr.responseText).toBe(latin1);
    });

    test("the charset of the Content-Type comes first", async () => {
      const { xhr } = await request(body(latin1.replace("\xE9", "\xC3\xA9"), "application/xml;charset=utf-8"));
      expect(xhr.responseXML!.documentElement.textContent).toBe("é");
    });

    test("a byte order mark comes first", async () => {
      const { xhr } = await request(body([0xff, 0xfe, ...utf16(latin1)], "application/xml"));
      expect(xhr.responseXML!.documentElement.textContent).toBe("é");
    });

    test("UTF-16 without a byte order mark", async () => {
      const { xhr } = await request(body(utf16(`<?xml version="1.0" encoding="UTF-16"?><a>é€</a>`), "text/xml"));
      expect(xhr.responseXML!.documentElement.textContent).toBe("é€");
    });

    test("UTF-8 without a declaration, or with one that does not say", async () => {
      for (const start of ["", `<?xml version="1.0"?>`, `<?xml version="1.0" encoding="UTF-16"?>`]) {
        const { xhr } = await request(body(start + "<a>\xC3\xA9</a>", "text/xml"));
        expect(xhr.responseXML!.documentElement.textContent).toBe("é");
      }
    });

    test("the declaration is not read for other types", async () => {
      expect((await request(body(latin1, "application/xml"))).xhr.responseText).toEndWith("<a>é</a>");
      expect((await request(body(latin1, "application/xml"), { responseType: "text" })).xhr.responseText).toEndWith(
        "<a>\uFFFD</a>",
      );
      expect((await request(body(latin1, "text/plain"))).xhr.responseText).toEndWith("<a>\uFFFD</a>");
    });

    test("a declaration that is split over two chunks", async () => {
      const { url, release } = gated(
        Array.from(Buffer.from(latin1.slice(0, 25), "latin1")),
        Array.from(Buffer.from(latin1.slice(25), "latin1")),
      );
      const texts: string[] = [];
      const { xhr } = await request(url, {
        mimeType: "application/xml",
        on: {
          progress(xhr) {
            if (texts.push(xhr.responseText) === 1) release();
          },
        },
      });
      expect(texts[0]).toBe("");
      expect(xhr.responseText).toBe(latin1);
      expect(xhr.responseXML!.documentElement.textContent).toBe("é");
    });
  });

  test("document is null for anything else", async () => {
    expect((await request(base + "text", { responseType: "document" })).xhr.response).toBeNull();
  });

  test("a compressed body is decompressed, and its length is not known in advance", async () => {
    const { xhr, events } = await request(base + "gzip");
    expect(xhr.responseText).toBe(Buffer.alloc(1000, "z").toString());
    expect(events.at(-1)).toBe("loadend 4 1000/?");
  });

  describe("the encoding of text", () => {
    test.each([
      ["the charset of the Content-Type", "e-acute?type=text/plain;charset=iso-8859-1", undefined, "é"],
      ["UTF-8 without one", "e-acute?type=text/plain", undefined, "�"],
      ["UTF-8 for a charset nobody knows", "e-acute?type=text/plain;charset=nope", undefined, "�"],
      [
        "the charset of overrideMimeType()",
        "e-acute?type=text/plain;charset=utf-8",
        "text/plain;charset=iso-8859-1",
        "é",
      ],
      ["a byte order mark before either", "utf16", "text/plain;charset=iso-8859-1", "hi"],
      ["a UTF-8 byte order mark is dropped", "bom", undefined, "{}"],
    ])("%s", async (_, path, mimeType, expected) => {
      expect((await request(base + path, { mimeType })).xhr.responseText).toBe(expected);
    });

    test("a character that is split over two chunks", async () => {
      const { url, release } = gated([0x61, 0xc3], [0xa9, 0x62]);
      const texts: string[] = [];
      await request(url, {
        on: {
          progress(xhr) {
            if (texts.push(xhr.responseText) === 1) release();
          },
        },
      });
      expect(texts).toEqual(["a", "aéb"]);
    });

    test("a byte order mark that is split over two chunks", async () => {
      const { url, release } = gated([0xff], [0xfe, 0x68, 0]);
      let released = false;
      const { xhr } = await request(url, {
        on: {
          progress() {
            if (!released) release();
            released = true;
          },
        },
      });
      expect(xhr.responseText).toBe("h");
    });
  });

  test("overrideMimeType() decides the type of a blob and of a document", async () => {
    expect((await request(base + "text", { responseType: "blob", mimeType: "image/x-test" })).xhr.response.type).toBe(
      "image/x-test",
    );
    expect((await request(base + "text", { responseType: "blob", mimeType: "not a type" })).xhr.response.type).toBe(
      "application/octet-stream",
    );
    const { xhr } = await request(base + "text", { responseType: "document", mimeType: "text/html" });
    expect(xhr.response.body.textContent).toBe("hello");
  });

  test("a redirect is followed, and responseURL is where it led, without the fragment", async () => {
    const { xhr, events } = await request(base + "redirect#here");
    expect([xhr.status, xhr.responseText, xhr.responseURL]).toEqual([200, "hello", base + "text"]);
    expect(events.filter(event => event.startsWith("readystatechange"))).toEqual([
      "readystatechange 1",
      "readystatechange 2",
      "readystatechange 3",
      "readystatechange 4",
    ]);
  });
});

describe("response headers", () => {
  test("getAllResponseHeaders() is lower case, sorted and separated by CRLF", async () => {
    const { xhr } = await request(base + "text");
    expect(xhr.getAllResponseHeaders().replace(/date: .*/, "date: now")).toBe(
      "content-length: 5\r\ncontent-type: text/plain;charset=utf-8\r\ndate: now\r\nx-a: 1\r\nx-b: 2\r\n",
    );
  });

  test("getResponseHeader() ignores case", async () => {
    const { xhr } = await request(base + "text");
    expect([xhr.getResponseHeader("X-A"), xhr.getResponseHeader("x-b"), xhr.getResponseHeader("nope")]).toEqual([
      "1",
      "2",
      null,
    ]);
  });

  test("cookies are not shown", async () => {
    const { xhr } = await request(base + "text");
    expect([xhr.getResponseHeader("Set-Cookie"), xhr.getResponseHeader("set-cookie2")]).toEqual([null, null]);
  });

  test("there are none before HEADERS_RECEIVED", async () => {
    const seen: unknown[] = [];
    const look = (xhr: XMLHttpRequest) =>
      seen.push(xhr.getAllResponseHeaders(), xhr.getResponseHeader("x-a"), xhr.status);
    await request(base + "text", { on: { "readystatechange 1": look, loadstart: look } });
    expect(seen).toEqual(["", null, 0, "", null, 0]);
  });
});

describe("the request", () => {
  test.each(["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])("%s", async method => {
    expect((await echo({ method })).method).toBe(method);
  });

  test("the six methods of the standard are made upper case", async () => {
    expect((await echo({ method: "post" })).method).toBe("POST");
    expect((await echo({ method: "Delete" })).method).toBe("DELETE");
  });

  test("without a body", async () => {
    for (const body of [undefined, null]) {
      const { headers, body: received } = await echo({ body });
      expect([headers["content-type"], headers["content-length"], received]).toEqual([undefined, "0", ""]);
    }
  });

  test("a string", async () => {
    const { headers, body } = await echo({ body: "héllo" });
    expect([headers["content-type"], body]).toEqual(["text/plain;charset=UTF-8", "h\xc3\xa9llo"]);
  });

  test("an empty string", async () => {
    const { headers, body } = await echo({ body: "" });
    expect([headers["content-type"], headers["content-length"], body]).toEqual(["text/plain;charset=UTF-8", "0", ""]);
  });

  test("anything else is converted to a string", async () => {
    expect((await echo({ body: 12 })).body).toBe("12");
    expect((await echo({ body: { toString: () => "object" } })).body).toBe("object");
  });

  test("URLSearchParams", async () => {
    const { headers, body } = await echo({ body: new URLSearchParams({ a: "1 2", b: "é" }) });
    expect([headers["content-type"], body]).toEqual([
      "application/x-www-form-urlencoded;charset=UTF-8",
      "a=1+2&b=%C3%A9",
    ]);
  });

  test("FormData", async () => {
    const form = new FormData();
    form.append("field", "value");
    form.append("file", new File(["content"], "name.txt", { type: "text/x-test" }));
    const { headers, body } = await echo({ body: form });
    const boundary = headers["content-type"].match(/^multipart\/form-data; boundary=(\S+)$/)![1];
    expect(body.split(`--${boundary}`).map(part => part.trim())).toEqual([
      "",
      'Content-Disposition: form-data; name="field"\r\n\r\nvalue',
      'Content-Disposition: form-data; name="file"; filename="name.txt"\r\nContent-Type: text/x-test\r\n\r\ncontent',
      "--",
    ]);
  });

  test("the FormData of a form in a window", async () => {
    const window = new Window({ url: base });
    window.document.body.innerHTML = `<form><input name=a value=1><input name=b value=2 disabled></form>`;
    const { body } = await echo({
      body: new window.FormData(window.document.forms[0]),
      Constructor: window.XMLHttpRequest,
    });
    expect(body).toContain('name="a"\r\n\r\n1');
    expect(body).not.toContain('name="b"');
  });

  test("a Blob", async () => {
    const { headers, body } = await echo({ body: new Blob([new Uint8Array([1, 2, 255])], { type: "image/x-test" }) });
    expect([headers["content-type"], body]).toEqual(["image/x-test", "\x01\x02\xff"]);
  });

  test("a Blob without a type", async () => {
    const { headers, body } = await echo({ body: new Blob(["abc"]) });
    expect([headers["content-type"], body]).toEqual([undefined, "abc"]);
  });

  test("a file on disk", async () => {
    using dir = tempDir("xhr", { "upload.txt": "from disk" });
    const { body, events } = await echo({ body: Bun.file(join(String(dir), "upload.txt")), upload: true });
    expect(body).toBe("from disk");
    expect(events).toContain("upload load 9/9");
  });

  test("an ArrayBuffer and a view of a part of one", async () => {
    const bytes = new Uint8Array([9, 0, 1, 255, 9]);
    for (const body of [bytes.slice(1, 4).buffer, bytes.subarray(1, 4), new DataView(bytes.buffer, 1, 3)]) {
      const { headers, body: received } = await echo({ body });
      expect([headers["content-type"], received]).toEqual([undefined, "\x00\x01\xff"]);
    }
  });

  test("the bytes are those at the time of send()", async () => {
    const bytes = new Uint8Array([65, 66]);
    expect((await echo({ body: bytes, sent: () => bytes.fill(0) })).body).toBe("AB");
  });

  test("a Document", async () => {
    const { document } = new Window();
    document.body.innerHTML = "<p>é</p>";
    const { headers, body } = await echo({ body: document });
    expect([headers["content-type"], body]).toEqual([
      "text/html;charset=UTF-8",
      "<!DOCTYPE html><html><head></head><body><p>\xc3\xa9</p></body></html>",
    ]);
  });

  test("a Content-Type that the script sets stays, with its charset corrected for text", async () => {
    const type = (value: string): [string, string][] => [["Content-Type", value]];
    expect((await echo({ body: "x", headers: type("text/x-a") })).headers["content-type"]).toBe("text/x-a");
    expect((await echo({ body: "x", headers: type("text/x-a; charset=latin1") })).headers["content-type"]).toBe(
      "text/x-a;charset=UTF-8",
    );
    expect((await echo({ body: new Blob(["x"], { type: "a/b" }), headers: type("c/d") })).headers["content-type"]).toBe(
      "c/d",
    );
    expect((await echo({ body: new FormData(), headers: type("c/d") })).headers["content-type"]).toBe("c/d");
    expect((await echo({ body: new Uint8Array(1), headers: type("c/d;charset=latin1") })).headers["content-type"]).toBe(
      "c/d;charset=latin1",
    );
  });

  test.each(["GET", "HEAD"])("%s drops the body", async method => {
    const { xhr, events } = await request(base + "echo", {
      method,
      body: "ignored",
      upload: true,
      responseType: "json",
    });
    expect(events.filter(event => event.startsWith("upload"))).toEqual([]);
    if (method === "GET") expect([xhr.response.body, xhr.response.headers["content-type"]]).toEqual(["", undefined]);
  });

  test("headers with one name are joined", async () => {
    const { headers } = await echo({
      headers: [
        ["X-One", "a"],
        ["x-one", " b\t"],
        ["Accept", "text/x-a"],
        ["accept", "text/x-b"],
      ],
    });
    expect([headers["x-one"], headers.accept]).toEqual(["a, b", "text/x-a, text/x-b"]);
  });

  test("Accept is */* unless the script sets it", async () => {
    expect((await echo({})).headers.accept).toBe("*/*");
  });

  test("forbidden headers are ignored", async () => {
    const { headers, method } = await echo({
      body: "abc",
      headers: [
        ["Host", "example.com"],
        ["Cookie", "a=b"],
        ["Cookie2", "a=b"],
        ["Content-Length", "1"],
        ["Connection", "close"],
        ["Origin", "https://example.com"],
        ["Referer", "https://example.com/"],
        ["Date", "now"],
        ["Via", "x"],
        ["Sec-Anything", "x"],
        ["Proxy-Anything", "x"],
        ["X-HTTP-Method-Override", "get, TRACE"],
        ["X-Allowed", "yes"],
        ["X-Method-Override", "PUT"],
      ],
    });
    expect(method).toBe("POST");
    expect(headers).toEqual({
      accept: "*/*",
      "accept-encoding": expect.any(String),
      connection: "keep-alive",
      "content-length": "3",
      "content-type": "text/plain;charset=UTF-8",
      host: new URL(base).host,
      "user-agent": navigator.userAgent,
      "x-allowed": "yes",
      "x-method-override": "PUT",
    });
  });

  test("no cookie of the document is sent, with or without credentials", async () => {
    const window = new Window({ url: base });
    window.document.cookie = "a=b";
    const xhr = new window.XMLHttpRequest();
    xhr.open("GET", "/echo");
    xhr.withCredentials = true;
    xhr.responseType = "json";
    xhr.send();
    await new Promise(resolve => (xhr.onload = resolve));
    expect(xhr.response.headers.cookie).toBeUndefined();
  });

  test("open() forgets the headers of the last request", async () => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", base + "echo");
    xhr.setRequestHeader("X-Old", "1");
    xhr.open("GET", base + "echo");
    xhr.responseType = "json";
    xhr.send();
    await new Promise(resolve => (xhr.onload = resolve));
    expect(xhr.response.headers["x-old"]).toBeUndefined();
  });

  test("a user and a password become Basic authorization", async () => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", base + "echo", true, "user", "pass word");
    xhr.responseType = "json";
    xhr.send();
    await new Promise(resolve => (xhr.onload = resolve));
    expect(xhr.response.headers.authorization).toBe("Basic " + btoa("user:pass word"));
  });
});

describe("upload", () => {
  test("its events come before the response's", async () => {
    const { events } = await echo({ body: "abc", upload: true });
    expect(events.slice(0, 7)).toEqual([
      "readystatechange 1",
      "loadstart 1 0/?",
      "upload loadstart 0/3",
      "upload progress 3/3",
      "upload load 3/3",
      "upload loadend 3/3",
      "readystatechange 2",
    ]);
    expect(events.slice(7).filter(event => event.startsWith("upload"))).toEqual([]);
  });

  test("the total is the length of the body as it is sent", async () => {
    const form = new FormData();
    form.append("a", "é");
    const { events, headers } = await echo({ body: form, upload: true });
    expect(events).toContain(`upload load ${headers["content-length"]}/${headers["content-length"]}`);
  });

  test("nothing is fired without a body", async () => {
    expect((await echo({ upload: true })).events.filter(event => event.startsWith("upload"))).toEqual([]);
  });

  test("a network error", async () => {
    const { events } = await request(closedPort, { method: "POST", body: "abc", upload: true });
    expect(events).toEqual([
      "readystatechange 1",
      "loadstart 1 0/?",
      "upload loadstart 0/3",
      "readystatechange 4",
      "upload error 0/?",
      "upload loadend 0/?",
      "error 4 0/?",
      "loadend 4 0/?",
    ]);
  });

  test("a listener that is added after send() hears nothing", async () => {
    let heard = false;
    await echo({ body: "abc", sent: xhr => xhr.upload.addEventListener("load", () => (heard = true)) });
    expect(heard).toBe(false);
  });

  test("the events are ProgressEvents at the upload", async () => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", base + "echo");
    const loaded = new Promise<ProgressEvent>(resolve => (xhr.upload.onload = resolve));
    xhr.send("abc");
    const event = await loaded;
    expect(event).toBeInstanceOf(ProgressEvent);
    // Promise jobs run after each listener, so the event is still being dispatched.
    expect([event.target, event.currentTarget, event.type, event.isTrusted]).toEqual([
      xhr.upload,
      xhr.upload,
      "load",
      true,
    ]);
  });
});

describe("event handlers", () => {
  test.each([...progressTypes, "readystatechange"])("on%s", type => {
    const xhr = new XMLHttpRequest();
    const calls: unknown[] = [];
    expect(xhr[`on${type}`]).toBeNull();
    const handler = function (this: unknown, event: Event) {
      calls.push(this, event);
    };
    xhr[`on${type}`] = handler;
    expect(xhr[`on${type}`]).toBe(handler);
    const event = new Event(type);
    xhr.dispatchEvent(event);
    expect(calls.length).toBe(2);
    expect(calls[0]).toBe(xhr);
    expect(calls[1]).toBe(event);
    xhr[`on${type}`] = "not a function";
    expect(xhr[`on${type}`]).toBeNull();
  });

  test("the upload has all but onreadystatechange", () => {
    const { upload } = new XMLHttpRequest();
    expect(progressTypes.map(type => upload[`on${type}`])).toEqual(progressTypes.map(() => null));
    expect("onreadystatechange" in upload).toBe(false);
  });

  test("what the listeners get", async () => {
    const xhr = new XMLHttpRequest();
    const seen: Record<string, Event> = {};
    xhr.onreadystatechange = xhr.onload = event => (seen[event.type] = event);
    xhr.open("GET", base + "text");
    xhr.send();
    await new Promise(resolve => (xhr.onloadend = resolve));
    expect(seen.load).toBeInstanceOf(ProgressEvent);
    expect(seen.load.constructor).toBe(ProgressEvent);
    expect(seen.readystatechange).not.toBeInstanceOf(ProgressEvent);
    for (const event of Object.values(seen))
      expect([event.target, event.bubbles, event.cancelable, event.isTrusted]).toEqual([xhr, false, false, true]);
  });

  test("an exception from a listener of a window's request goes to the window", async () => {
    const window = new Window({ url: base });
    const error = new Error("from a listener");
    const reported = new Promise<ErrorEvent>(resolve =>
      window.addEventListener("error", (event: ErrorEvent) => {
        event.preventDefault();
        resolve(event);
      }),
    );
    const xhr = new window.XMLHttpRequest();
    xhr.open("GET", "/text");
    xhr.onload = () => {
      throw error;
    };
    const ended = new Promise(resolve => (xhr.onloadend = resolve));
    xhr.send();
    expect((await reported).error).toBe(error);
    await ended;
  });
});

describe("errors", () => {
  const opened = () => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", base + "text");
    return xhr;
  };

  test("InvalidStateError: setRequestHeader() and send() before open()", () => {
    const xhr = new XMLHttpRequest();
    expect(() => xhr.setRequestHeader("a", "b")).toThrow(named("InvalidStateError"));
    expect(() => xhr.send()).toThrow(named("InvalidStateError"));
  });

  test("InvalidStateError: after send()", async () => {
    const xhr = opened();
    const ended = new Promise(resolve => (xhr.onloadend = resolve));
    xhr.send();
    expect(() => xhr.send()).toThrow(named("InvalidStateError"));
    expect(() => xhr.setRequestHeader("a", "b")).toThrow(named("InvalidStateError"));
    expect(() => (xhr.withCredentials = true)).toThrow(named("InvalidStateError"));
    await ended;
    expect(() => xhr.send()).toThrow(named("InvalidStateError"));
    expect(() => xhr.setRequestHeader("a", "b")).toThrow(named("InvalidStateError"));
    expect(() => (xhr.withCredentials = true)).toThrow(named("InvalidStateError"));
  });

  test("InvalidStateError: responseType and overrideMimeType() once the body arrives", async () => {
    const thrown: unknown[] = [];
    const attempt = (xhr: XMLHttpRequest) => {
      for (const change of [() => (xhr.responseType = "text"), () => xhr.overrideMimeType("text/plain")]) {
        try {
          change();
          thrown.push(null);
        } catch (error) {
          thrown.push((error as Error).name);
        }
      }
    };
    await request(base + "text", {
      on: { "readystatechange 2": attempt, "readystatechange 3": attempt, "readystatechange 4": attempt },
    });
    expect(thrown).toEqual([null, null, ...Array(4).fill("InvalidStateError")]);
  });

  test("InvalidStateError: responseText and responseXML with another responseType", () => {
    const xhr = new XMLHttpRequest();
    for (const type of ["arraybuffer", "blob", "json", "document"] as const) {
      xhr.responseType = type;
      expect(() => xhr.responseText).toThrow(named("InvalidStateError"));
    }
    for (const type of ["arraybuffer", "blob", "json", "text"] as const) {
      xhr.responseType = type;
      expect(() => xhr.responseXML).toThrow(named("InvalidStateError"));
    }
  });

  test("InvalidStateError: open() when the window is closed", () => {
    const window = new Window({ url: base });
    const xhr = new window.XMLHttpRequest();
    window.close();
    expect(() => xhr.open("GET", "/text")).toThrow(named("InvalidStateError"));
  });

  test("SyntaxError: a method or a header that is not a token, a value with a line break, a URL that does not parse", () => {
    const xhr = new XMLHttpRequest();
    for (const method of ["", "GET POST", "é", "a:b"])
      expect(() => xhr.open(method, base)).toThrow(named("SyntaxError"));
    expect(() => xhr.open("GET", "http://[")).toThrow(named("SyntaxError"));
    expect(xhr.readyState).toBe(0);
    xhr.open("GET", base);
    for (const name of ["", "a b", "a:", "é"])
      expect(() => xhr.setRequestHeader(name, "x")).toThrow(named("SyntaxError"));
    for (const value of ["a\nb", "a\rb", "a\0b"])
      expect(() => xhr.setRequestHeader("x", value)).toThrow(named("SyntaxError"));
  });

  test("TypeError: a header value outside Latin-1, too few arguments", () => {
    const xhr = opened();
    expect(() => xhr.setRequestHeader("x", "Ā")).toThrow(TypeError);
    expect(() => (xhr.open as any)("GET")).toThrow(TypeError);
    expect(() => (xhr.setRequestHeader as any)("x")).toThrow(TypeError);
  });

  test.each(["TRACE", "track", "Connect"])("SecurityError: %s", method => {
    expect(() => new XMLHttpRequest().open(method, base)).toThrow(named("SecurityError"));
  });

  describe("synchronous requests", () => {
    test("send() throws a NotSupportedError and changes nothing", () => {
      const xhr = new XMLHttpRequest();
      const { events } = listen(xhr);
      xhr.open("GET", base + "text", false);
      expect(() => xhr.send()).toThrow(named("NotSupportedError"));
      expect([xhr.readyState, events]).toEqual([1, ["readystatechange 1"]]);
      xhr.open("GET", base + "text");
      xhr.abort();
    });

    test("InvalidAccessError: with a timeout or a responseType", () => {
      let xhr = new XMLHttpRequest();
      xhr.timeout = 1;
      expect(() => xhr.open("GET", base, false)).toThrow(named("InvalidAccessError"));
      xhr = new XMLHttpRequest();
      xhr.responseType = "json";
      expect(() => xhr.open("GET", base, false)).toThrow(named("InvalidAccessError"));
      xhr = new XMLHttpRequest();
      xhr.open("GET", base, false);
      expect(() => (xhr.timeout = 1)).toThrow(named("InvalidAccessError"));
      expect(() => (xhr.responseType = "json")).toThrow(named("InvalidAccessError"));
    });
  });
});

describe("URLs", () => {
  test("are relative to the document of the window the constructor belongs to", async () => {
    const window = new Window({ url: base + "dir/page?query#fragment" });
    const get = async (url: string) => (await request(url, { Constructor: window.XMLHttpRequest })).xhr.responseURL;
    expect(await get("text")).toBe(base + "dir/text");
    expect(await get("/text")).toBe(base + "text");
    expect(await get("../text")).toBe(base + "text");
    expect(await get(`//${new URL(base).host}/text`)).toBe(base + "text");

    window.document.head.innerHTML = `<base href="/">`;
    expect(await get("text")).toBe(base + "text");
  });

  test("each window has its own base", async () => {
    const [one, two] = [new Window({ url: base }), new Window({ url: base + "dir/" })];
    expect(one.XMLHttpRequest).not.toBe(two.XMLHttpRequest);
    expect((await request("text", { Constructor: one.XMLHttpRequest })).xhr.responseURL).toBe(base + "text");
    expect((await request("text", { Constructor: two.XMLHttpRequest })).xhr.responseURL).toBe(base + "dir/text");
  });

  test("a subclass of a window's class keeps the window", async () => {
    const window = new Window({ url: base });
    class Subclass extends window.XMLHttpRequest {}
    const { xhr } = await request("/text", { Constructor: Subclass });
    expect(xhr).toBeInstanceOf(Subclass);
    expect(xhr.responseText).toBe("hello");
  });

  test("without a window a relative URL is a SyntaxError", () => {
    const xhr = new XMLHttpRequest();
    for (const url of ["/text", "text", "//localhost/text", ""])
      expect(() => xhr.open("GET", url)).toThrow(named("SyntaxError"));
    expect(() => new new Window().XMLHttpRequest().open("GET", "/text")).toThrow(named("SyntaxError"));
  });

  test("a URL object", async () => {
    expect((await request(new URL("text", base) as any)).xhr.responseText).toBe("hello");
  });

  test("data:", async () => {
    const { xhr, events } = await request("data:text/x-test;charset=iso-8859-1,%E9");
    expect([xhr.status, xhr.responseText, xhr.getResponseHeader("content-type")]).toEqual([
      200,
      "é",
      "text/x-test;charset=iso-8859-1",
    ]);
    expect(events.at(-1)).toStartWith("loadend 4 1/");
  });

  test("blob:", async () => {
    const url = URL.createObjectURL(new Blob(["from a blob"], { type: "text/x-test" }));
    try {
      const { xhr } = await request(url, { responseType: "blob" });
      expect([xhr.status, xhr.response.type, await xhr.response.text()]).toEqual([200, "text/x-test", "from a blob"]);
    } finally {
      URL.revokeObjectURL(url);
    }
    expect((await request(url)).events.slice(-2)).toEqual(["error 4 0/?", "loadend 4 0/?"]);
  });

  test("file:", async () => {
    using dir = tempDir("xhr", { "hello.txt": "from disk" });
    const { xhr } = await request(pathToFileURL(join(String(dir), "hello.txt")).href);
    expect([xhr.status, xhr.responseText]).toEqual([200, "from disk"]);
    const { events } = await request(pathToFileURL(join(String(dir), "missing.txt")).href);
    expect(events.slice(-2)).toEqual(["error 4 0/?", "loadend 4 0/?"]);
  });
});

// In a process of its own, so that the server keeps its classes.
test("what script replaces changes nothing", async () => {
  const replaceAndRequest = async (XMLHttpRequest: any, base: string, closedPort: string) => {
    const form = new FormData();
    form.append("a", "1");
    const blob = new Blob(["blob"]);

    // Each replacement says that it was called and then does what the original does, so that nothing hangs.
    const replace = (object: any, names: (string | symbol)[]) => {
      for (const name of names) {
        const original = object[name];
        const value = function (this: unknown, ...args: unknown[]) {
          console.log(String(name), "was called");
          return new.target ? Reflect.construct(original, args, new.target) : Reflect.apply(original, this, args);
        };
        object[name] = value;
      }
    };
    replace(Response.prototype, ["arrayBuffer", "bytes", "blob", "text", "json", "clone"]);
    replace(Headers.prototype, ["get", "has", "forEach", "entries", "keys", "values", Symbol.iterator]);
    replace(Blob.prototype, ["arrayBuffer", "bytes", "text", "stream", "slice"]);
    replace(FormData.prototype, ["entries", "forEach", "get", "getAll", Symbol.iterator]);
    replace(ReadableStream.prototype, ["getReader", "cancel", "tee", "pipeTo"]);
    replace(ReadableStreamDefaultReader.prototype, ["read", "cancel", "releaseLock"]);
    replace(EventTarget.prototype, ["dispatchEvent"]);
    replace(AbortSignal.prototype, ["throwIfAborted"]);
    replace(AbortController.prototype, ["abort"]);
    replace(TextDecoder.prototype, ["decode"]);
    replace(Promise.prototype, ["then", "catch", "finally"]);
    replace(globalThis, [
      "fetch",
      "Response",
      "Headers",
      "Request",
      "AbortController",
      "AbortSignal",
      "ReadableStream",
    ]);
    // What fetch() would take for options if it looked beyond the object it is given.
    Object.assign(Object.prototype, { proxy: closedPort, unix: "/nowhere", method: "DELETE", redirect: "error" });

    const send = (method: string, path: string, body?: unknown, timeout = 0, sent?: (xhr: any) => void) =>
      new Promise<any[]>(resolve => {
        const xhr = new XMLHttpRequest();
        const types: string[] = [];
        for (const type of ["load", "error", "abort", "timeout"]) xhr.addEventListener(type, () => types.push(type));
        xhr.onloadend = () => resolve([...types, xhr.status, xhr.getResponseHeader("x-a"), xhr.responseText]);
        xhr.open(method, base + path);
        xhr.timeout = timeout;
        xhr.send(body);
        sent?.(xhr);
      });
    return [
      await send("GET", "redirect"),
      await send("GET", "e-acute?type=text/plain;charset=iso-8859-1"),
      JSON.parse((await send("POST", "echo", form))[3]).body.includes('name="a"\r\n\r\n1'),
      JSON.parse((await send("POST", "echo", blob))[3]).body,
      await send("GET", "never", undefined, 0, xhr => xhr.abort()),
      await send("GET", "never", undefined, 10),
    ];
  };
  const { stdout, stderr, exitCode } = await run(`
    import { XMLHttpRequest } from "bun:dom";
    const results = await (${replaceAndRequest})(XMLHttpRequest, ${JSON.stringify(base)}, ${JSON.stringify(closedPort)});
    console.log(JSON.stringify(results));
  `);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual([
    ["load", 200, "1", "hello"],
    ["load", 200, null, "é"],
    true,
    "blob",
    ["abort", 0, null, ""],
    ["timeout", 0, null, ""],
  ]);
  expect(exitCode).toBe(0);
});

// What @mswjs/interceptors does to the class and to each instance.
test("can be wrapped in a Proxy, and an instance can be given own properties in place of the accessors", async () => {
  const window = new Window({ url: base });
  const Proxied = new Proxy(window.XMLHttpRequest, {
    construct(target, args, newTarget) {
      const xhr = Reflect.construct(target, args, newTarget);
      const descriptors = Object.getOwnPropertyDescriptors(target.prototype);
      for (const name in descriptors) expect(Reflect.defineProperty(xhr, name, descriptors[name])).toBe(true);
      return xhr;
    },
  });
  const xhr = new Proxied();
  expect(xhr).toBeInstanceOf(XMLHttpRequest);
  const upload = new Proxy(xhr.upload, {});
  expect(upload instanceof XMLHttpRequestUpload).toBe(true);
  expect(Reflect.defineProperty(xhr, "upload", { writable: true, enumerable: true, value: upload })).toBe(true);
  expect(xhr.upload).toBe(upload);

  xhr.open("GET", "/text");
  const ended = new Promise(resolve => xhr.addEventListener("loadend", resolve));
  xhr.send();
  await ended;
  expect([xhr.readyState, xhr.status, xhr.responseText]).toEqual([4, 200, "hello"]);

  for (const [name, value] of Object.entries({
    readyState: 1,
    status: 418,
    statusText: "mock",
    responseURL: "mock:",
  })) {
    expect(Reflect.defineProperty(xhr, name, { writable: true, enumerable: true, value })).toBe(true);
    expect(xhr[name]).toBe(value);
  }
  Object.defineProperties(xhr, {
    response: { enumerable: true, configurable: false, get: () => "mocked" },
    responseText: { enumerable: true, configurable: false, get: () => "mocked" },
  });
  expect([xhr.response, xhr.responseText]).toEqual(["mocked", "mocked"]);
});

describe("lifetime", () => {
  test("a request nobody holds still finishes", async () => {
    const { promise, resolve } = Promise.withResolvers<string>();
    const { url, release } = gated("kept ", "alive");
    (() => {
      const xhr = new XMLHttpRequest();
      xhr.onprogress = () => {
        Bun.gc(true);
        release();
      };
      xhr.onload = () => resolve(xhr.responseText);
      xhr.open("GET", url);
      xhr.send();
    })();
    Bun.gc(true);
    expect(await promise).toBe("kept alive");
  });

  test("a request in flight keeps the process alive", async () => {
    const { url, release } = gated("first ", "second");
    const script = `
      import { XMLHttpRequest } from "bun:dom";
      const xhr = new XMLHttpRequest();
      xhr.open("GET", ${JSON.stringify(url)});
      xhr.onprogress = () => console.log("progress");
      xhr.onloadend = () => console.log(xhr.responseText);
      xhr.send();
    `;
    await using process = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stderr: "pipe" });
    const reader = process.stdout.getReader();
    const decoder = new TextDecoder();
    let stdout = "";
    // The child has nothing to do but wait for the rest of the body.
    while (!stdout.includes("progress\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      stdout += decoder.decode(value, { stream: true });
    }
    release();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      stdout += decoder.decode(value, { stream: true });
    }
    expect(await process.stderr.text()).toBe("");
    expect(stdout).toBe("progress\nprogress\nfirst second\n");
    expect(await process.exited).toBe(0);
  });

  test.each([
    ["abort()", `xhr.abort();`],
    ["a timeout", `xhr.timeout = 10;`],
    ["window.close()", `window.close();`],
    ["open()", `xhr.open("GET", "/never");`],
  ])("after %s nothing keeps the process alive", async (_, end) => {
    const { stdout, stderr, exitCode } = await run(`
      import { Window } from "bun:dom";
      const window = new Window({ url: ${JSON.stringify(base)} });
      const xhr = new window.XMLHttpRequest();
      for (const type of ["abort", "timeout", "error", "load", "loadend"]) xhr.addEventListener(type, () => console.log(type));
      xhr.open("POST", "/never");
      xhr.timeout = 100_000;
      xhr.send("body");
      ${end}
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe({ "abort()": "abort\nloadend\n", "a timeout": "timeout\nloadend\n" }[_] ?? "");
    expect(exitCode).toBe(0);
  });

  test("window.close() cancels the window's requests, and no event follows", async () => {
    const window = new Window({ url: base });
    const { url } = gated("one", "never sent");
    const xhr = new window.XMLHttpRequest();
    const { events } = listen(xhr, { on: { progress: () => window.close() } });
    const other = new window.XMLHttpRequest();
    const { events: otherEvents } = listen(other);
    other.open("GET", "/never");
    other.send();
    xhr.open("GET", url);
    xhr.send();
    await new Promise(resolve => xhr.addEventListener("progress", resolve));
    expect((await request(base + "text")).xhr.responseText).toBe("hello");
    expect(events.at(-1)).toBe("progress 3 3/?");
    expect(otherEvents.at(-1)).toBe("loadstart 1 0/?");
    expect([xhr.readyState, other.readyState]).toEqual([0, 0]);
  });

  test("send() in a window that was closed after open() is a network error", async () => {
    const window = new Window({ url: base });
    const xhr = new window.XMLHttpRequest();
    const { events, ended } = listen(xhr);
    xhr.open("GET", "/text");
    window.close();
    xhr.send();
    await ended;
    expect(events.slice(1)).toEqual(["loadstart 1 0/?", "readystatechange 4", "error 4 0/?", "loadend 4 0/?"]);
  });
});

test("works in Workers at the same time as on the main thread", async () => {
  const run = async (XMLHttpRequest: any, Window: any, base: string) => {
    const send = (xhr: any, method: string, url: string, body?: string, timeout = 0) =>
      new Promise(resolve => {
        xhr.open(method, url);
        xhr.timeout = timeout;
        xhr.ontimeout = () => resolve("timeout");
        xhr.onloadend = () => resolve(xhr.status + " " + xhr.responseText);
        xhr.send(body);
      });
    const results = new Set();
    for (let i = 0; i < 10; i++) {
      const all = await Promise.all([
        send(new XMLHttpRequest(), "GET", base + "text"),
        send(new new Window({ url: base }).XMLHttpRequest(), "GET", "/404"),
        send(new XMLHttpRequest(), "POST", base + "echo", "x".repeat(i)).then(
          text => JSON.parse(String(text).slice(4)).body.length - i,
        ),
        send(new XMLHttpRequest(), "GET", base + "never", undefined, 5),
      ]);
      results.add(all.join());
    }
    return [...results];
  };
  const source = `import { Window, XMLHttpRequest } from "bun:dom"; postMessage(await (${run})(XMLHttpRequest, Window, ${JSON.stringify(base)}));`;
  const url = URL.createObjectURL(new Blob([source], { type: "application/javascript" }));
  const workers = Array.from({ length: 4 }, () => new Worker(url));
  const results = workers.map(worker => new Promise(resolve => (worker.onmessage = event => resolve(event.data))));
  const expected = ["200 hello,404 nope,0,timeout"];
  expect(await run(XMLHttpRequest, Window, base)).toEqual(expected);
  expect(await Promise.all(results)).toEqual([expected, expected, expected, expected]);
  for (const worker of workers) worker.terminate();
});

test("a Worker that is terminated with a request in flight", async () => {
  const source = `
    import { XMLHttpRequest } from "bun:dom";
    const xhr = new XMLHttpRequest();
    xhr.open("GET", ${JSON.stringify(base + "never")});
    xhr.onloadstart = () => postMessage("sent");
    xhr.send();
  `;
  const worker = new Worker(URL.createObjectURL(new Blob([source], { type: "application/javascript" })));
  expect(await new Promise(resolve => (worker.onmessage = event => resolve(event.data)))).toBe("sent");
  const closed = new Promise(resolve => worker.addEventListener("close", resolve));
  worker.terminate();
  await closed;
});

test("the three classes are globals under bun test --environment=bun:dom", async () => {
  using dir = tempDir("xhr-environment", {
    "globals.test.js": `
      // @vitest-environment-options { "url": ${JSON.stringify(base)} }
      import { expect, test } from "bun:test";
      test("XMLHttpRequest", async () => {
        expect(XMLHttpRequest).toBe(window.XMLHttpRequest);
        expect(XMLHttpRequestUpload).toBe(window.XMLHttpRequestUpload);
        expect(XMLHttpRequestEventTarget).toBe(window.XMLHttpRequestEventTarget);
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, "XMLHttpRequest");
        expect([descriptor.configurable, descriptor.writable]).toEqual([true, true]);
        const xhr = new XMLHttpRequest();
        expect(xhr.upload).toBeInstanceOf(XMLHttpRequestUpload);
        xhr.open("GET", "/text");
        xhr.send();
        await new Promise(resolve => (xhr.onloadend = resolve));
        expect([xhr.responseURL, xhr.responseText]).toEqual([location.origin + "/text", "hello"]);
      });
    `,
  });
  await using process = Bun.spawn({
    cmd: [bunExe(), "test", "--environment=bun:dom", "./globals.test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([process.stdout.text(), process.stderr.text(), process.exited]);
  expect(stdout + stderr).toContain("1 pass");
  expect(exitCode).toBe(0);
});
