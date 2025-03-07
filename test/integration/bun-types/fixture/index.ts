import svgpath from "cool.svg";
svgpath satisfies `${string}.svg`;

import * as test from "bun:test";
test.describe;
test.it;

import * as sqlite from "bun:sqlite";
sqlite.Database;

Bun satisfies typeof import("bun");

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

URL.canParse;
URL.createObjectURL;
URL.revokeObjectURL;

Response.json();
Response.redirect("bun.sh", 300);
Response.error();
Response.redirect("bun.sh", {
  status: 200,
  headers: new Headers(
    (() => {
      const h = new Headers();
      h.set("key", "value");
      h.toJSON();
      return h;
    })(),
  ),
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

fetch("", {
  tls: {
    rejectUnauthorized: false,
  },
});

import.meta.hot?.data;

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
