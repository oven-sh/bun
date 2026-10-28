// Opt-in test. Each ./features/<name> is a server that exercises many features of Bun.serve, node:http or one framework: hooks
// and middleware, prefixed routers, schemas that validate, coerce and serialize, error handlers, cookies, redirects, content
// negotiation, streams and every kind of request body. Each one is built with `bun build --compile`, with and without --aot,
// and both builds receive the same requests. Status, headers and body of every response must match. The --aot build is also
// run with the RegExp JIT off (the frameworks build patterns from paths and schemas at run time) and in zombie mode with a GC
// every few allocations.
//
//   AOT_SERVERS=1 bun test test/aot/servers/features     all six
//   AOT_SERVERS=hono bun test test/aot/servers/features  only this one
//
// See ./servers.test.ts for AOT_SERVERS and AOT_SERVERS_MODULES.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned, unsupported } from "../run-programs";
import {
  filterRequested,
  installPackages,
  moreEnvironment,
  moreFlags,
  removeFolders,
  requestedServers,
  startServer,
} from "./run-servers";

type RequestSpec = [method: string, path: string, headers?: Record<string, string>, body?: string];

const json = { "Content-Type": "application/json" };
const form = { "Content-Type": "application/x-www-form-urlencoded" };
const item = JSON.stringify({ name: "kettle", tags: ["kitchen", "steel"], price: 24.99 });

const multipart =
  "--line\r\n" +
  'Content-Disposition: form-data; name="a"\r\n\r\n1\r\n--line\r\n' +
  'Content-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--line--\r\n';

const requests: Record<string, RequestSpec[]> = {
  "bun.ts": [
    ["GET", "/fixed"],
    ["HEAD", "/fixed"],
    ["POST", "/fixed"],
    ["GET", "/fixed.json"],
    ["GET", "/methods"],
    ["PUT", "/methods", {}, "four"],
    ["DELETE", "/methods"],
    ["POST", "/methods"],
    ["HEAD", "/methods"],
    ["GET", "/things/7"],
    ["GET", "/things/caf%C3%A9"],
    ["GET", "/things/a%2Fb"],
    ["GET", "/things/"],
    ["GET", "/things/7/parts/wheel?x=1"],
    ["GET", "/rest/a/b/c"],
    ["GET", "/rest/"],
    ["GET", "/moved"],
    ["GET", "/headers", { "x-custom": "yes" }],
    ["GET", "/cookies"],
    ["GET", "/cookies", { Cookie: "visits=41; old=1; other=a%20b" }],
    ["GET", "/address"],
    ["GET", "/generator"],
    ["GET", "/stream"],
    ["GET", "/blob"],
    ["GET", "/bytes"],
    ["POST", "/form", form, "a=1&a=2&b=x+y"],
    ["POST", "/form", { "Content-Type": "multipart/form-data; boundary=line" }, multipart],
    ["POST", "/form", json, "{}"],
    ["POST", "/json", json, item],
    ["POST", "/json", json, "{"],
    ["POST", "/json", json, ""],
    ["POST", "/buffer", {}, "x".repeat(100_000)],
    ["POST", "/clone", {}, "twice"],
    ["GET", "/throws"],
    ["GET", "/rejects"],
    ["GET", "/not-a-response"],
    ["GET", "/missing"],
    ["OPTIONS", "/missing"],
    ["GET", "/socket"],
  ],
  "node.ts": [
    ["GET", "/headers", { "x-custom": "yes", Cookie: "a=1; b=2" }],
    ["HEAD", "/headers"],
    ["GET", "/write-head"],
    ["GET", "/write-head-pairs"],
    ["GET", "/status?code=200"],
    ["GET", "/status?code=404"],
    ["GET", "/status?code=418"],
    ["GET", "/status?code=599"],
    ["GET", "/chunks"],
    ["HEAD", "/chunks"],
    ["GET", "/drain"],
    ["GET", "/piped"],
    ["GET", "/gzip"],
    ["GET", "/empty"],
    ["GET", "/late-header"],
    ["GET", "/bad-header"],
    ["GET", "/events"],
    ["GET", "/socket"],
    ["POST", "/echo", json, item],
    ["POST", "/echo", {}, ""],
    ["POST", "/echo", { "Content-Type": "application/octet-stream" }, "x".repeat(300_000)],
    ["POST", "/events", { "Content-Type": "text/plain" }, "caf\u00e9 ".repeat(1000)],
    ["POST", "/back", { "Content-Type": "text/plain" }, "returned ".repeat(5000)],
    ["POST", "/ignored", {}, "x".repeat(100_000)],
    ["GET", "/throws"],
    ["GET", "/rejects"],
    ["GET", "/missing"],
    ["DELETE", "/headers"],
  ],
  "fastify.ts": [
    ["POST", "/items", json, item],
    ["POST", "/items", json, JSON.stringify({ name: "kettle", price: 1 })],
    ["POST", "/items", json, JSON.stringify({ name: "kettle" })],
    ["POST", "/items", json, JSON.stringify({ name: "kettle", price: 1, color: "red" })],
    ["POST", "/items", json, JSON.stringify({ name: "k".repeat(21), price: 1 })],
    ["POST", "/items", json, JSON.stringify({ name: "kettle", price: "3.5" })],
    ["POST", "/items", json, JSON.stringify({ name: "kettle", price: -1 })],
    ["POST", "/items", json, JSON.stringify({ name: "kettle", price: 1, tags: "one" })],
    ["POST", "/items", json, JSON.stringify({ name: 7, price: 1 })],
    ["POST", "/items", json, "{"],
    ["POST", "/items", json, ""],
    ["POST", "/items", { "Content-Type": "application/xml" }, "<item/>"],
    ["GET", "/search"],
    ["GET", "/search?limit=5&exact=true&words=a&words=b"],
    ["GET", "/search?words=a"],
    ["GET", "/search?limit=0"],
    ["GET", "/search?limit=abc"],
    ["GET", "/search?limit=5.5"],
    ["GET", "/search?exact=yes"],
    ["GET", "/search?other=1"],
    ["GET", "/throws"],
    ["GET", "/teapot"],
    ["GET", "/moved"],
    ["GET", "/nothing-to-say"],
    ["GET", "/who"],
    ["GET", "/who", { "x-user": "ada", "User-Agent": "test" }],
    ["HEAD", "/who"],
    ["OPTIONS", "/who"],
    ["POST", "/shout", { "Content-Type": "text/plain" }, "quiet"],
    ["GET", "/v1/things/7"],
    ["GET", "/v1/things/a/b/c"],
    ["GET", "/v1/nothing"],
    ["GET", "/missing?x=1", { "x-user": "ada" }],
  ],
  "hono.ts": [
    ["GET", "/open/data", { Origin: "https://example.com" }],
    ["GET", "/open/data", { Origin: "https://example.org" }],
    [
      "OPTIONS",
      "/open/data",
      {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "x-user",
      },
    ],
    ["GET", "/safe/data"],
    ["GET", "/tagged/data"],
    ["GET", "/tagged/data", { "If-None-Match": '"nothing"' }],
    ["GET", "/private/data"],
    ["GET", "/private/data", { Authorization: "Basic " + btoa("bun:hunter2") }],
    ["GET", "/private/data", { Authorization: "Basic " + btoa("bun:hunter3") }],
    ["GET", "/private/data", { Authorization: "Bearer token" }],
    ["GET", "/throws"],
    ["GET", "/teapot"],
    ["GET", "/moved"],
    ["GET", "/page"],
    ["GET", "/nothing-to-say"],
    ["GET", "/visits"],
    ["GET", "/visits", { Cookie: "visits=41; other=x" }],
    ["GET", "/visits", { Cookie: "visits=many" }],
    ["GET", "/queries"],
    ["GET", "/queries?tag=a&tag=b&x=1&y"],
    ["GET", "/queries?tag=%E2%9C%93&tag=a+b"],
    ["GET", "/files/readme.txt"],
    ["GET", "/files/README.txt"],
    ["GET", "/optional"],
    ["GET", "/optional/tea"],
    ["GET", "/rest/a/b/c"],
    ["POST", "/items", json, item],
    ["POST", "/items", json, JSON.stringify({ name: "" })],
    ["POST", "/items", json, JSON.stringify({ name: "kettle", tags: [1, null] })],
    ["POST", "/items", json, "{"],
    ["POST", "/items", form, "name=kettle"],
    ["POST", "/form", form, "a=1&a=2&b=x+y&c="],
    ["GET", "/v1/things/9"],
    ["GET", "/v1/other"],
    ["GET", "/missing", { "x-user": "ada" }],
    ["HEAD", "/page"],
  ],
  "elysia.ts": [
    ["POST", "/items", json, item],
    ["POST", "/items", json, JSON.stringify({ name: "kettle", price: 1 })],
    ["POST", "/items", json, JSON.stringify({ name: "kettle" })],
    ["POST", "/items", json, JSON.stringify({ name: "", price: 1, tags: [] })],
    ["POST", "/items", json, JSON.stringify({ name: "kettle", price: "3.5", tags: [] })],
    ["POST", "/items", json, "{"],
    ["GET", "/search"],
    ["GET", "/search?limit=5&exact=true"],
    ["GET", "/search?limit=0"],
    ["GET", "/search?limit=abc"],
    ["GET", "/search?exact=yes"],
    ["GET", "/throws"],
    ["GET", "/sold-out"],
    ["GET", "/moved"],
    ["GET", "/who"],
    ["GET", "/who", { "x-user": "ada" }],
    ["GET", "/visits"],
    ["GET", "/visits", { Cookie: "visits=41" }],
    ["GET", "/private"],
    ["GET", "/private", { Authorization: "Bearer token" }],
    ["GET", "/numbers"],
    ["GET", "/v1/things/7"],
    ["GET", "/v1/things/seven"],
    ["GET", "/v1/things/a/b"],
    ["GET", "/missing"],
    ["HEAD", "/who"],
  ],
  "express.js": [
    ["GET", "/who"],
    ["GET", "/who", { "x-user": "ada" }],
    ["GET", "/v2/things/7"],
    ["GET", "/v2/things/seven"],
    ["GET", "/v2/things/"],
    ["POST", "/v2/things/", json, item],
    ["POST", "/v2/things/", json, "{"],
    ["GET", "/moved"],
    ["GET", "/nothing-to-say"],
    ["GET", "/visits"],
    ["GET", "/visits", { Cookie: "visits=41" }],
    ["GET", "/either", { Accept: "text/plain" }],
    ["GET", "/either", { Accept: "application/json;q=0.9, text/plain;q=0.1" }],
    ["GET", "/either", { Accept: "image/png" }],
    ["GET", "/queries?a=1&a=2&b[c]=d&e"],
    ["GET", "/files/readme.txt"],
    ["GET", "/files/README.txt"],
    ["GET", "/rest/a/b/c"],
    ["GET", "/optional"],
    ["GET", "/optional/tea"],
    ["POST", "/form", form, "a=1&a=2&b[c]=d&e=x+y"],
    ["POST", "/text", { "Content-Type": "text/plain" }, "quiet"],
    ["PUT", "/any"],
    ["PATCH", "/any"],
    ["GET", "/throws"],
    ["GET", "/rejects"],
    ["GET", "/chain"],
    ["GET", "/who", { "If-None-Match": "*" }],
    ["HEAD", "/who"],
    ["OPTIONS", "/v2/things/"],
    ["GET", "/missing?x=1", { "x-user": "ada" }],
  ],
};

const servers = filterRequested(Object.keys(requests));

async function collectResponses(origin: string, specs: RequestSpec[]) {
  const all: Record<string, unknown> = {};
  // Two passes: a server may keep state, and the second request hits warm caches.
  for (const pass of ["first", "second"]) {
    for (const [method, path, headers, body] of specs) {
      const response = await fetch(origin + path, { method, headers, body, redirect: "manual" });
      all[`${pass} ${method} ${path} ${JSON.stringify(headers ?? {})} ${body ?? ""}`] = {
        status: response.status,
        headers: [...response.headers]
          .filter(([header]) => header !== "date")
          .map(([header, value]) => [header, value.replace(/Expires=[^;]+/, "Expires=<time>")])
          .sort(),
        body: (await response.text()).replaceAll(origin, "<origin>"),
      };
    }
  }
  return all;
}

/** Returns the raw status line and header lines of every response. fetch() hides their order and case. */
async function collectRawHeaders(origin: string, specs: RequestSpec[]) {
  const all: Record<string, string[]> = {};
  const { hostname, port } = new URL(origin);
  for (const [method, path, headers, body] of specs) {
    const lines = [`${method} ${path} HTTP/1.1`, `Host: ${hostname}:${port}`, "Connection: close"];
    for (const [header, value] of Object.entries(headers ?? {})) lines.push(`${header}: ${value}`);
    if (body !== undefined) lines.push(`Content-Length: ${Buffer.byteLength(body)}`);
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    let received = "";
    await Bun.connect({
      hostname,
      port: Number(port),
      socket: {
        open: socket => void socket.write(lines.join("\r\n") + "\r\n\r\n" + (body ?? "")),
        data: (socket, chunk) => void (received += chunk.toString("latin1")),
        close: () => resolve(received),
        error: (socket, error) => reject(error),
      },
    });
    all[`${method} ${path} ${JSON.stringify(headers ?? {})} ${(body ?? "").length}`] = (await promise)
      .split("\r\n\r\n")[0]
      .split("\r\n")
      .filter(line => !/^date:/i.test(line))
      .map(line => line.replace(/Expires=[^;]+/, "Expires=<time>").replaceAll(origin, "<origin>"));
  }
  return all;
}

/** Connects two clients to the WebSocket endpoint of ./features/bun.ts and returns the messages each one received. */
async function runWebSocketSession(origin: string) {
  const messages: Record<string, string[]> = { ada: [], bob: [] };
  const messageCount = () => messages.ada.length + messages.bob.length;
  const waitForMessages = async (count: number) => {
    for (let n = 0; messageCount() < count; n++) {
      if (n === 500) throw new Error(`timed out waiting for ${count} messages: ${JSON.stringify(messages)}`);
      await Bun.sleep(10);
    }
  };
  const connect = (name: string) => {
    const socket = new WebSocket(`${origin.replace("http", "ws")}/socket?name=${name}`);
    socket.binaryType = "arraybuffer";
    socket.onmessage = event =>
      messages[name].push(typeof event.data === "string" ? event.data : `bytes ${new Uint8Array(event.data)}`);
    socket.onclose = event => messages[name].push(`closed: ${event.code} ${event.reason}`);
    return socket;
  };
  const ada = connect("ada");
  await waitForMessages(1);
  const bob = connect("bob");
  await waitForMessages(2);
  ada.send("quiet");
  await waitForMessages(3);
  ada.send(new Uint8Array([1, 2, 3]));
  await waitForMessages(4);
  ada.send("all:good morning");
  await waitForMessages(5);
  bob.send("x".repeat(100_000));
  await waitForMessages(6);
  bob.send("bye");
  await waitForMessages(8);
  ada.close(1000, "done");
  await waitForMessages(9);
  return messages;
}

/** Aborts a request to the endless event stream of ./features/bun.ts. Returns what the client read and the abort counters of the server. */
async function abortEventStream(origin: string) {
  const controller = new AbortController();
  const response = await fetch(origin + "/events", { signal: controller.signal });
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";
  while (!text.includes("id: 5\n")) text += (await reader.read()).value;
  controller.abort();
  let counters = {};
  for (let n = 0; n < 500 && !Bun.deepEquals(counters, { aborted: 1, cancelled: 1 }); n++) {
    await Bun.sleep(10);
    counters = await (await fetch(origin + "/left")).json();
  }
  return { type: response.headers.get("Content-Type"), first: text.slice(0, text.indexOf("id: 5\n")), counters };
}

if (!requestedServers)
  console.error(
    "SKIPPED: test/aot/servers/features.test.ts: it installs packages from npm. Set AOT_SERVERS=1 to run it",
  );

describe.skipIf(!requestedServers || !!unsupported)("compile/aot/servers/features", () => {
  const folder = String(tempDir("aot-servers-features", {}));
  // Each executable is as large as Bun itself.
  afterAll(() => removeFolders(folder));

  beforeAll(async () => {
    cpSync(join(import.meta.dir, "app"), folder, { recursive: true });
    cpSync(join(import.meta.dir, "features"), join(folder, "features"), { recursive: true });
    await installPackages(folder);
  }, 120_000);

  test.each(servers)(
    "%s matches the build without --aot",
    async file => {
      const executables = [];
      for (const flags of [["--aot"], []]) {
        const executable = join(folder, `${file}${flags[0] ?? "--no-aot"}${isWindows ? ".exe" : ""}`);
        built(
          await spawned(
            [
              bunExe(),
              "build",
              "--compile",
              ...flags,
              ...(flags.length ? moreFlags : []),
              "--define",
              'process.env.NODE_ENV="production"',
              "--target=bun",
              `./features/${file}`,
              "--outfile",
              executable,
            ],
            folder,
            bunEnv,
          ),
        );
        executables.push(executable);
      }
      using aot = await startServer([executables[0]], folder, {
        ...bunEnv,
        BUN_JSC_crashIfInterpreterIsUsed: "1",
        ...moreEnvironment,
      });
      using aotWithoutRegExpJIT = await startServer([executables[0]], folder, {
        ...bunEnv,
        BUN_JSC_crashIfInterpreterIsUsed: "1",
        BUN_JSC_useRegExpJIT: "0",
      });
      using aotZombieMode = await startServer([executables[0]], folder, {
        ...bunEnv,
        BUN_JSC_crashIfInterpreterIsUsed: "1",
        BUN_JSC_useZombieMode: "1",
        BUN_JSC_sweepSynchronously: "1",
        BUN_JSC_slowPathAllocsBetweenGCs: "50",
      });
      using reference = await startServer([executables[1]], folder, bunEnv);
      const expected = await collectResponses(reference.origin, requests[file]);
      expect(await collectResponses(aot.origin, requests[file])).toEqual(expected);
      expect(await collectResponses(aotWithoutRegExpJIT.origin, requests[file])).toEqual(expected);
      expect(await collectResponses(aotZombieMode.origin, requests[file])).toEqual(expected);
      expect(await collectRawHeaders(aot.origin, requests[file])).toEqual(
        await collectRawHeaders(reference.origin, requests[file]),
      );
      if (file === "bun.ts") {
        const messages = await runWebSocketSession(reference.origin);
        expect(messages.ada).toContain("bob left: 4001 said bye");
        expect(await runWebSocketSession(aot.origin)).toEqual(messages);
        expect(await abortEventStream(aot.origin)).toEqual(await abortEventStream(reference.origin));
      }
    },
    120_000,
  );
});
