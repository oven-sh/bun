import svgpath from "cool.svg";
svgpath satisfies `${string}.svg`;

import * as test from "bun:test";
test.describe;
test.it;

const options: Bun.TLSOptions = {
  keyFile: "",
};

process.assert;

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
new URLSearchParams();
new File([], "filename", { type: "text/plain" });
new Blob([], { type: "text/plain" });
new ReadableStream();
new WritableStream();
new TransformStream();
new AbortSignal();
new AbortController();

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

new Map();
new Set();
new WeakMap();
new WeakSet();
new Map();
new Set();
new WeakMap();

const statuses = [200, 400, 401, 403, 404, 500, 501, 502, 503, 504];

const r = new Request("", {
  body: "",
});

await fetch(r);
await fetch("", {
  tls: {
    rejectUnauthorized: false,
  },
});

r.method;
r.body;
r.headers.get("content-type");

new Request("", {});

await r.json();
await r.text();

declare const headers: Headers;
headers.toJSON();

const req1 = new Request("", {
  body: "",
});

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

  key: Bun.file(""),
  cert: Bun.file(""),

  tls: {
    key: Bun.file(""),
    cert: Bun.file(""),
  },
});

new URL("", "");
const myUrl: URL = new URL("");
URL.canParse;
URL.createObjectURL;
URL.revokeObjectURL;

Response.json("");
Response.redirect("bun.sh", 300);
Response.error();
Response.redirect("bun.sh", {
  headers: {
    "x-bun": "is cool",
  },
});

Bun.fetch.preconnect;

type g = BodyInit;

Bun.fetch("", {
  proxy: "",
  s3: {
    acl: "public-read",
  },
});

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

new Worker("").on("message", (e: MessageEvent<string>) => {
  e;
  e.data satisfies string;
});

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
