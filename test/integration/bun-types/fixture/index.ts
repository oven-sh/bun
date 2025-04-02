import svgpath from "cool.svg";
svgpath satisfies `${string}.svg`;

import * as test from "bun:test";
test.describe;
test.it;

const options: Bun.TLSOptions = {
  keyFile: "",
};

process.assert;

const error = new Error("hello world");
const clone = structuredClone(error);
console.log(clone.message); // "hello world"

new SubtleCrypto();
declare const mySubtleCrypto: SubtleCrypto;

new CryptoKey();
declare const myCryptoKey: CryptoKey;

import * as sqlite from "bun:sqlite";
sqlite.Database;

Bun satisfies typeof import("bun");

type ConstructorOf<T> = new (...args: any[]) => T;

import * as NodeTLS from "node:tls";
import * as TLS from "tls";

process.revision;

NodeTLS satisfies typeof TLS;
TLS satisfies typeof NodeTLS;

type NodeTLSOverrideTest = NodeTLS.BunConnectionOptions;
type TLSOverrideTest = TLS.BunConnectionOptions;

WebAssembly.Global;
WebAssembly.Memory;
WebAssembly.compile;
WebAssembly.compileStreaming;
WebAssembly.instantiate;
WebAssembly.instantiateStreaming;
WebAssembly.validate;

WebAssembly.Global satisfies ConstructorOf<Bun.WebAssembly.Global>;
WebAssembly.Memory satisfies ConstructorOf<Bun.WebAssembly.Memory>;

type wasmglobalthing = Bun.WebAssembly.Global;

type S3OptionsFromNamespace = Bun.S3Options;
type S3OptionsFromImport = import("bun").S3Options;

type c = import("bun").S3Client;

Bun.s3.file("").name;

const client = new Bun.S3Client({
  secretAccessKey: "",
});

new TextEncoder();

client.file("");

Bun.fetch;

// just some APIs
new Request("url");
new Response();
new Headers();
new URL("");
new URLSearchParams([["cool", "stuff"]]);
new File([], "filename", { type: "text/plain" });
new Blob([], { type: "text/plain" });
new ReadableStream();
new WritableStream();
new TransformStream();
new AbortSignal();
new AbortController();
AbortSignal.timeout(200);
AbortSignal.any([new AbortSignal()]);
AbortSignal.abort(200);

new TextDecoder();
new TextEncoder();

fetch("url", {
  proxy: "",
});

fetch(new URL("url"), {
  proxy: "",
});

Bun.fetch(new URL("url"), {
  proxy: "",
});

Bun.S3Client;

Bun.$.ShellPromise;

new Bun.$.ShellError();

new Promise(resolve => {
  resolve(1);
});

import.meta.hot.on("bun:bun:beforeFullReloadBut also allows anything", () => {
  //
});

new Map();
new Set();
new WeakMap();
new WeakSet();
new Map();
new Set();
new WeakMap();

Promise.try(() => {
  return 1;
});

Promise.try(() => {
  throw new Error("test");
});

Promise.try((message: string) => {
  throw new Error(message);
}, "Bun");

declare const myReadableStream: ReadableStream<string>;
for await (const chunk of myReadableStream) {
  console.log(chunk);
}

for await (const chunk of Bun.stdin.stream()) {
  // chunk is Uint8Array
  // this converts it to text (assumes ASCII encoding)
  const chunkText = Buffer.from(chunk).toString();
  console.log(`Chunk: ${chunkText}`);
}

const myAsyncGenerator = async function* () {
  yield new Uint8Array([1, 2, 3]);
  yield new Uint8Array([4, 5, 6]);
};

new Response(myAsyncGenerator());

const statuses = [200, 400, 401, 403, 404, 500, 501, 502, 503, 504];

const r = new Request("", {
  body: "",
});

await fetch(r);
await fetch("", {
  tls: {
    key: Bun.file("key.pem"),
    cert: Bun.file("cert.pem"),
    ca: [Bun.file("ca.pem")],
    rejectUnauthorized: false,
  },
});

r.method;
r.body;
r.headers.get("content-type");

new Request("", {});
new Bun.$.ShellError() instanceof Bun.$.ShellError;

await r.json();
await r.text();

declare const headers: Headers;
headers.toJSON();

const req1 = new Request("", {
  body: "",
});

for (const header of new Headers()) {
  console.log(header);
}

fetch("", {
  tls: {
    rejectUnauthorized: false,
    checkServerIdentity: () => {
      return undefined;
    },
  },
});

req1.body;
req1.json();
req1.formData();
req1.arrayBuffer();
req1.blob();
req1.text();
req1.arrayBuffer();
req1.blob();

req1.headers;
req1.headers.toJSON();

new ReadableStream({});

const body = await fetch(req1);

Bun.fetch satisfies typeof fetch;
Bun.fetch.preconnect satisfies typeof fetch.preconnect;

await body.text();

fetch;

fetch.preconnect(new URL(""));

Bun.serve({
  port: 3000,
  fetch: () => new Response("ok"),

  // don't do this, use the `tls: {}` options instead
  key: Bun.file(""), // dont do it!
  cert: Bun.file(""), // dont do it!

  tls: {
    key: Bun.file(""), // do this!
    cert: Bun.file(""), // do this!
  },
});

import type { BinaryLike } from "node:crypto";
declare function asIs(value: BinaryLike): BinaryLike;
asIs(Buffer.from("Hey", "utf-8"));

new URL("", "");
const myUrl: URL = new URL("");
URL.canParse;
URL.createObjectURL;
URL.revokeObjectURL;

declare const myBodyInit: Bun.BodyInit;
declare const myHeadersInit: Bun.HeadersInit;

await new Blob().text();
await new Blob().json();
await new Blob().arrayBuffer();
await new Blob().bytes();
await new Blob().formData();

await new File(["code"], "name.ts").text();
await new File(["code"], "name.ts").json();
await new File(["code"], "name.ts").arrayBuffer();
await new File(["code"], "name.ts").bytes();
await new File(["code"], "name.ts").formData();

await Bun.file("test").text();
await Bun.file("test").json();
await Bun.file("test").arrayBuffer();
await Bun.file("test").bytes();
await Bun.file("test").formData();

new MessagePort();

new File(["code"], "name.ts");

URL.parse("bun.sh");
URL.parse("bun.sh", "bun.sh");
Error.isError(new Error());

Response.json("");
Response.redirect("bun.sh", 300);
Response.error();
Response.redirect("bun.sh", 302);
Response.redirect("bun.sh", {
  headers: {
    "x-bun": "is cool",
  },
});

Bun.inspect.custom;
Bun.inspect;

fetch.preconnect("bun.sh");
Bun.fetch.preconnect("bun.sh");

new Uint8Array().toBase64();

Bun.fetch("", {
  proxy: "",
  s3: {
    acl: "public-read",
  },
});

new HTMLRewriter()
  .on("script", {
    element(element) {
      console.log(element.getAttribute("src"));
    },
  })
  .transform(new Blob(['<script src="/main.js"></script>']));

Buffer.from("foo").equals(Buffer.from("bar"));

const myHeaders: Headers = new Headers();
myHeaders.append("x-bun", "is cool");
myHeaders.get("x-bun");
myHeaders.has("x-bun");
myHeaders.set("x-bun", "is cool");
myHeaders.delete("x-bun");
myHeaders.getSetCookie();
myHeaders.toJSON();
myHeaders.count;
myHeaders.getAll("set-cookie");
myHeaders.getAll("Set-Cookie");

// @ts-expect-error
myHeaders.getAll("Should fail");

const myRequest: Request = new Request("", {
  headers: new Headers(myHeaders),
  body: "",
  method: "GET",
  redirect: "follow",
  credentials: "include",
  mode: "cors",
  referrer: "about:client",
  referrerPolicy: "no-referrer",
  window: null,
});

const myResponse: Response = new Response("", {
  headers: new Headers([]),
  status: 200,
  statusText: "OK",
});

const myRequestInit: RequestInit = {
  body: "",
  method: "GET",
};

declare const requestInitKeys: `evaluate-${keyof RequestInit}`;
requestInitKeys satisfies string;

Bun.serve({
  fetch(req) {
    req.headers;
    const headers = req.headers.toJSON();

    const body = req.method === "GET" || req.method === "HEAD" ? undefined : req.body;

    return new Response(body, {
      headers,
      status: statuses[Math.floor(Math.random() * statuses.length)],
    });
  },
});

import.meta.hot.accept();
import.meta.hot.data;

fetch("", {
  tls: {
    rejectUnauthorized: false,
  },
});

new AbortController();
const myAbortController: AbortController = new AbortController();
new AbortSignal();
const myAbortSignal: AbortSignal = new AbortSignal();

import { serve } from "bun";

new Worker("", {
  type: "module",
  preload: ["preload.ts"],
});

serve({
  fetch(req) {
    const headers = req.headers.toJSON();

    const body = req.method === "GET" || req.method === "HEAD" ? undefined : req.body;

    return new Response(body, {
      headers,
      status: statuses[Math.floor(Math.random() * statuses.length)],
    });
  },
});

import { s3 } from "bun";

s3.file("");

declare const key: string;
declare const cert: string;

Bun.serve({
  fetch: () => new Response("ok"),
  tls: {
    key,
    cert,
  },
});
