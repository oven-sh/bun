import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("fetch store", () => {
  test("dir: records response to disk and replays on second call", async () => {
    using cacheDir = tempDir("fetch-store-dir", {});
    let hits = 0;
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        hits++;
        return new Response(JSON.stringify({ n: hits, path: new URL(req.url).pathname }), {
          headers: { "content-type": "application/json", "x-hit": String(hits) },
        });
      },
    });
    const store = { type: "dir", path: String(cacheDir) } as const;

    const r1 = await fetch(`http://localhost:${server.port}/hello`, { store });
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ n: 1, path: "/hello" });
    expect(hits).toBe(1);

    const r2 = await fetch(`http://localhost:${server.port}/hello`, { store });
    expect(r2.status).toBe(200);
    expect(r2.headers.get("content-type")).toBe("application/json");
    expect(r2.headers.get("x-hit")).toBe("1");
    expect(await r2.json()).toEqual({ n: 1, path: "/hello" });
    expect(hits).toBe(1);

    const files = readdirSync(String(cacheDir)).filter(f => f.endsWith(".json"));
    expect(files.length).toBe(1);
    const data = JSON.parse(readFileSync(join(String(cacheDir), files[0]), "utf8"));
    expect(data.request.method).toBe("GET");
    expect(data.request.url).toContain("/hello");
    expect(data.response.status).toBe(200);
    expect(data.response.headers).toContainEqual(["content-type", "application/json"]);
    expect(typeof data.response.body).toBe("string");
    expect(JSON.parse(data.response.body)).toEqual({ n: 1, path: "/hello" });
  });

  test("dir: different method/url/body/headers get different keys", async () => {
    using cacheDir = tempDir("fetch-store-keys", {});
    let hits = 0;
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        hits++;
        return new Response(String(hits));
      },
    });
    const store = { type: "dir", path: String(cacheDir) } as const;
    const base = `http://localhost:${server.port}`;

    await (await fetch(`${base}/a`, { store })).text();
    await (await fetch(`${base}/b`, { store })).text();
    await (await fetch(`${base}/a`, { method: "POST", body: "x", store })).text();
    await (await fetch(`${base}/a`, { method: "POST", body: "y", store })).text();
    await (await fetch(`${base}/a`, { headers: { "x-k": "1" }, store })).text();
    await (await fetch(`${base}/a`, { headers: { "x-k": "2" }, store })).text();
    expect(hits).toBe(6);

    await (await fetch(`${base}/a`, { store })).text();
    await (await fetch(`${base}/b`, { store })).text();
    await (await fetch(`${base}/a`, { method: "POST", body: "x", store })).text();
    await (await fetch(`${base}/a`, { method: "POST", body: "y", store })).text();
    await (await fetch(`${base}/a`, { headers: { "x-k": "1" }, store })).text();
    await (await fetch(`${base}/a`, { headers: { "x-k": "2" }, store })).text();
    expect(hits).toBe(6);

    expect(readdirSync(String(cacheDir)).filter(f => f.endsWith(".json")).length).toBe(6);
  });

  test("dir: header order and case do not perturb the key", async () => {
    using cacheDir = tempDir("fetch-store-hdr-order", {});
    let hits = 0;
    await using server = Bun.serve({
      port: 0,
      async fetch() {
        hits++;
        return new Response(String(hits));
      },
    });
    const store = { type: "dir", path: String(cacheDir) } as const;
    const base = `http://localhost:${server.port}`;

    const a = await (
      await fetch(`${base}/h`, {
        headers: [
          ["X-A", "1"],
          ["x-b", "2"],
        ] as [string, string][],
        store,
      })
    ).text();
    const b = await (
      await fetch(`${base}/h`, {
        headers: [
          ["x-b", "2"],
          ["x-a", "1"],
        ] as [string, string][],
        store,
      })
    ).text();
    expect({ a, b, hits }).toEqual({ a: "1", b: "1", hits: 1 });
  });

  test("dir: repeated response headers (Set-Cookie) survive JSON round-trip", async () => {
    using cacheDir = tempDir("fetch-store-setcookie", {});
    let hits = 0;
    await using server = Bun.serve({
      port: 0,
      fetch() {
        hits++;
        return new Response("ok", {
          headers: [
            ["set-cookie", "a=1"],
            ["set-cookie", "b=2"],
          ],
        });
      },
    });
    const store = { type: "dir", path: String(cacheDir) } as const;
    const url = `http://localhost:${server.port}/cookies`;

    await (await fetch(url, { store })).text();
    const r2 = await fetch(url, { store });
    expect(r2.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    expect(hits).toBe(1);

    const files = readdirSync(String(cacheDir)).filter(f => f.endsWith(".json"));
    const data = JSON.parse(readFileSync(join(String(cacheDir), files[0]), "utf8"));
    const cookies = data.response.headers.filter((h: [string, string]) => h[0] === "set-cookie");
    expect(cookies).toEqual([
      ["set-cookie", "a=1"],
      ["set-cookie", "b=2"],
    ]);
  });

  test("dir: binary body is base64 encoded", async () => {
    using cacheDir = tempDir("fetch-store-binary", {});
    const payload = new Uint8Array([0, 1, 2, 255, 128, 0]);
    await using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(payload, { headers: { "content-type": "application/octet-stream" } });
      },
    });
    const store = { type: "dir", path: String(cacheDir) } as const;

    const r1 = await fetch(`http://localhost:${server.port}/bin`, { store });
    expect(new Uint8Array(await r1.arrayBuffer())).toEqual(payload);

    const r2 = await fetch(`http://localhost:${server.port}/bin`, { store });
    expect(new Uint8Array(await r2.arrayBuffer())).toEqual(payload);

    const files = readdirSync(String(cacheDir)).filter(f => f.endsWith(".json"));
    const data = JSON.parse(readFileSync(join(String(cacheDir), files[0]), "utf8"));
    expect(data.response.body).toEqual({
      encoding: "base64",
      data: Buffer.from(payload).toString("base64"),
    });
  });

  test("memory: records and replays within process", async () => {
    let hits = 0;
    await using server = Bun.serve({
      port: 0,
      fetch() {
        hits++;
        return new Response("v" + hits);
      },
    });
    const store = { type: "memory" } as const;

    expect(await (await fetch(`http://localhost:${server.port}/mem`, { store })).text()).toBe("v1");
    expect(await (await fetch(`http://localhost:${server.port}/mem`, { store })).text()).toBe("v1");
    expect(hits).toBe(1);
  });

  test.concurrent("memory: max bounds entry count", async () => {
    // Subprocess gives an isolated memory store. With max=1 each insert
    // evicts the prior key, so re-fetching both keys misses both times;
    // an unbounded store would leave `after` at 2.
    using srcDir = tempDir("fetch-store-mem-max", {
      "script.ts": `
        let hits = 0;
        await using server = Bun.serve({
          port: 0,
          fetch(req) { hits++; return new Response(new URL(req.url).pathname); },
        });
        const store = { type: "memory", max: 1 } as const;
        const base = "http://localhost:" + server.port;
        await (await fetch(base + "/m1", { store })).text();
        await (await fetch(base + "/m2", { store })).text();
        const before = hits;
        await (await fetch(base + "/m1", { store })).text();
        await (await fetch(base + "/m2", { store })).text();
        console.log(JSON.stringify({ before, after: hits }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "script.ts"],
      env: bunEnv,
      cwd: String(srcDir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ out: JSON.parse(stdout.trim()), stderr, exitCode }).toEqual({
      out: { before: 2, after: 4 },
      stderr: "",
      exitCode: 0,
    });
  });

  test("store type validation", async () => {
    // @ts-expect-error invalid type
    await expect(fetch("http://example.com", { store: { type: "nope" } })).rejects.toThrow(/store\.type/);
    // @ts-expect-error missing path
    await expect(fetch("http://example.com", { store: { type: "dir" } })).rejects.toThrow(/store\.path/);
  });

  test("Bun.file() request bodies are buffered and persist into the store", async () => {
    using cacheDir = tempDir("fetch-store-bunfile", {});
    using dataDir = tempDir("fetch-store-bunfile-src", {
      "a.bin": Buffer.alloc(40 * 1024, "A").toString(),
      "b.bin": Buffer.alloc(40 * 1024, "B").toString(),
    });
    let hits = 0;
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        hits++;
        const first = (await req.bytes())[0];
        return new Response(String.fromCharCode(first) + hits);
      },
    });
    const store = { type: "dir", path: String(cacheDir) } as const;
    const url = `http://localhost:${server.port}/file`;

    const a1 = await (
      await fetch(url, { method: "POST", body: Bun.file(join(String(dataDir), "a.bin")), store })
    ).text();
    const b1 = await (
      await fetch(url, { method: "POST", body: Bun.file(join(String(dataDir), "b.bin")), store })
    ).text();
    expect(hits).toBe(2);
    const a2 = await (
      await fetch(url, { method: "POST", body: Bun.file(join(String(dataDir), "a.bin")), store })
    ).text();
    const b2 = await (
      await fetch(url, { method: "POST", body: Bun.file(join(String(dataDir), "b.bin")), store })
    ).text();
    expect({ a1, b1, a2, b2, hits }).toEqual({ a1: "A1", b1: "B2", a2: "A1", b2: "B2", hits: 2 });
    expect(readdirSync(String(cacheDir)).filter(f => f.endsWith(".json")).length).toBe(2);
  });

  test("response bodies read as a stream still persist", async () => {
    using cacheDir = tempDir("fetch-store-resp-stream", {});
    let hits = 0;
    await using server = Bun.serve({
      port: 0,
      fetch() {
        hits++;
        const body = Buffer.alloc(8000, "x").toString() + hits;
        return new Response(
          new ReadableStream({
            async start(c) {
              c.enqueue(new TextEncoder().encode(body.slice(0, 4000)));
              await Bun.sleep(0);
              c.enqueue(new TextEncoder().encode(body.slice(4000)));
              c.close();
            },
          }),
        );
      },
    });
    const store = { type: "dir", path: String(cacheDir) } as const;
    const url = `http://localhost:${server.port}/stream-resp`;

    const r1 = await fetch(url, { store });
    let got = "";
    for await (const chunk of r1.body!) got += new TextDecoder().decode(chunk);
    expect(got.length).toBe(8001);
    expect(got.endsWith("1")).toBe(true);
    expect(hits).toBe(1);

    const r2 = await fetch(url, { store });
    expect(await r2.text()).toBe(got);
    expect(hits).toBe(1);

    const files = readdirSync(String(cacheDir)).filter(f => f.endsWith(".json"));
    expect(files.length).toBe(1);
  });

  test("ReadableStream request bodies bypass the store", async () => {
    using cacheDir = tempDir("fetch-store-stream", {});
    let hits = 0;
    const bodies: string[] = [];
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        hits++;
        bodies.push(await req.text());
        return new Response(String(hits));
      },
    });
    const store = { type: "dir", path: String(cacheDir) } as const;
    const mk = (s: string) =>
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(s));
          c.close();
        },
      });
    const a = await (await fetch(`http://localhost:${server.port}/s`, { method: "POST", body: mk("A"), store })).text();
    const b = await (await fetch(`http://localhost:${server.port}/s`, { method: "POST", body: mk("B"), store })).text();
    expect({ a, b, hits, bodies }).toEqual({ a: "1", b: "2", hits: 2, bodies: ["A", "B"] });
    expect(readdirSync(String(cacheDir))).toEqual([]);
  });

  test.concurrent("--fetch-cache=<dir> applies to all fetch() calls", async () => {
    using cacheDir = tempDir("fetch-store-cli", {});
    using srcDir = tempDir("fetch-store-cli-src", {
      "script.ts": `
        let hits = 0;
        await using server = Bun.serve({
          port: 0,
          fetch() { hits++; return new Response("ok" + hits); },
        });
        const url = "http://localhost:" + server.port + "/cli";
        const a = await (await fetch(url)).text();
        const b = await (await fetch(url)).text();
        console.log(JSON.stringify({ a, b, hits }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--fetch-cache", String(cacheDir), "script.ts"],
      env: bunEnv,
      cwd: String(srcDir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ out: JSON.parse(stdout.trim()), stderr, exitCode }).toEqual({
      out: { a: "ok1", b: "ok1", hits: 1 },
      stderr: "",
      exitCode: 0,
    });
    expect(readdirSync(String(cacheDir)).filter(f => f.endsWith(".json")).length).toBe(1);
  });

  test.concurrent("--fetch-cache=memory", async () => {
    using srcDir = tempDir("fetch-store-cli-mem", {
      "script.ts": `
        let hits = 0;
        await using server = Bun.serve({
          port: 0,
          fetch() { hits++; return new Response("m" + hits); },
        });
        const url = "http://localhost:" + server.port + "/climem";
        const a = await (await fetch(url)).text();
        const b = await (await fetch(url)).text();
        console.log(JSON.stringify({ a, b, hits }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--fetch-cache", "memory", "script.ts"],
      env: bunEnv,
      cwd: String(srcDir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ out: JSON.parse(stdout.trim()), stderr, exitCode }).toEqual({
      out: { a: "m1", b: "m1", hits: 1 },
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("bunfig [fetch] cache = <dir>", async () => {
    using cacheDir = tempDir("fetch-store-bunfig-cache", {});
    using srcDir = tempDir("fetch-store-bunfig", {
      "bunfig.toml": `[fetch]\ncache = ${JSON.stringify(String(cacheDir))}\n`,
      "script.ts": `
        let hits = 0;
        await using server = Bun.serve({
          port: 0,
          fetch() { hits++; return new Response("bf" + hits); },
        });
        const url = "http://localhost:" + server.port + "/bunfig";
        const a = await (await fetch(url)).text();
        const b = await (await fetch(url)).text();
        console.log(JSON.stringify({ a, b, hits }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "script.ts"],
      env: bunEnv,
      cwd: String(srcDir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ out: JSON.parse(stdout.trim()), stderr, exitCode }).toEqual({
      out: { a: "bf1", b: "bf1", hits: 1 },
      stderr: "",
      exitCode: 0,
    });
    expect(readdirSync(String(cacheDir)).filter(f => f.endsWith(".json")).length).toBe(1);
  });
});
