import { test, expect, describe } from "bun:test";
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

    // miss → records
    const r1 = await fetch(`http://localhost:${server.port}/hello`, { store });
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ n: 1, path: "/hello" });
    expect(hits).toBe(1);

    // hit → replays, server not contacted
    const r2 = await fetch(`http://localhost:${server.port}/hello`, { store });
    expect(r2.status).toBe(200);
    expect(r2.headers.get("content-type")).toBe("application/json");
    expect(r2.headers.get("x-hit")).toBe("1");
    expect(await r2.json()).toEqual({ n: 1, path: "/hello" });
    expect(hits).toBe(1);

    // one file on disk, valid JSON with the expected shape
    const files = readdirSync(String(cacheDir)).filter(f => f.endsWith(".json"));
    expect(files.length).toBe(1);
    const data = JSON.parse(readFileSync(join(String(cacheDir), files[0]), "utf8"));
    expect(data.request.method).toBe("GET");
    expect(data.request.url).toContain("/hello");
    expect(data.response.status).toBe(200);
    expect(data.response.headers["content-type"]).toBe("application/json");
    expect(typeof data.response.body).toBe("string");
    expect(JSON.parse(data.response.body)).toEqual({ n: 1, path: "/hello" });
  });

  test("dir: different method/url/body get different keys", async () => {
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
    expect(hits).toBe(4);

    // all four should now hit
    await (await fetch(`${base}/a`, { store })).text();
    await (await fetch(`${base}/b`, { store })).text();
    await (await fetch(`${base}/a`, { method: "POST", body: "x", store })).text();
    await (await fetch(`${base}/a`, { method: "POST", body: "y", store })).text();
    expect(hits).toBe(4);

    expect(readdirSync(String(cacheDir)).filter(f => f.endsWith(".json")).length).toBe(4);
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

  test("memory: max evicts when full", async () => {
    let hits = 0;
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        hits++;
        return new Response(new URL(req.url).pathname);
      },
    });
    const store = { type: "memory", max: 2 } as const;
    const base = `http://localhost:${server.port}`;

    await (await fetch(`${base}/m1`, { store })).text();
    await (await fetch(`${base}/m2`, { store })).text();
    await (await fetch(`${base}/m3`, { store })).text();
    // 3 misses; map holds 2 entries. m3 is definitely cached.
    expect(hits).toBe(3);
    await (await fetch(`${base}/m3`, { store })).text();
    expect(hits).toBe(3);
  });

  test("store type validation", async () => {
    // @ts-expect-error invalid type
    expect(fetch("http://example.com", { store: { type: "nope" } })).rejects.toThrow(/store\.type/);
    // @ts-expect-error missing path
    expect(fetch("http://example.com", { store: { type: "dir" } })).rejects.toThrow(/store\.path/);
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
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    const out = JSON.parse(stdout.trim());
    expect(out).toEqual({ a: "ok1", b: "ok1", hits: 1 });
    expect(exitCode).toBe(0);
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
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ a: "m1", b: "m1", hits: 1 });
    expect(exitCode).toBe(0);
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
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ a: "bf1", b: "bf1", hits: 1 });
    expect(exitCode).toBe(0);
    expect(readdirSync(String(cacheDir)).filter(f => f.endsWith(".json")).length).toBe(1);
  });
});
