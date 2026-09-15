// Flags: --expose-internals
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import assert from "node:assert";
import { URL, parse } from "node:url";

describe("internal/url", () => {
  test.skip("isURL", () => {
    const { isURL } = require("internal/url");

    assert.strictEqual(isURL("https://www.nodejs.org"), true);
    assert.strictEqual(isURL(new URL("https://www.nodejs.org")), true);
    assert.strictEqual(isURL(parse("https://www.nodejs.org")), false);
    assert.strictEqual(
      isURL({
        href: "https://www.nodejs.org",
        protocol: "https:",
        path: "/",
      }),
      false,
    );
  });

  // The consumers of isURL, driven with URL instances after globalThis.URL was
  // replaced. @happy-dom/global-registrator (the DOM testing setup in
  // docs/test/dom.mdx) installs its own URL class there, so a URL made by
  // node:url or Bun.pathToFileURL, or before the registration, is no longer
  // `instanceof URL`. Node detects URLs structurally and is not affected.
  test("URL instances are still URLs after globalThis.URL is replaced", async () => {
    using dir = tempDir("is-url-consumers", {
      "a.txt": "hello",
      "worker.js": `require("node:worker_threads").parentPort.postMessage("from worker");`,
      "main.js": `
        const NativeURL = URL;
        globalThis.URL = class URL extends NativeURL {};
        const fs = require("node:fs");
        const http = require("node:http");
        const { once } = require("node:events");
        const { Worker } = require("node:worker_threads");
        const { pathToFileURL } = require("node:url");
        const fileURL = name => new NativeURL(pathToFileURL(name).href);

        const out = {};
        const probe = async (name, fn) => {
          try {
            out[name] = await fn();
          } catch (e) {
            out[name] = e.code ?? e.message;
          }
        };
        out.instanceOfURL = fileURL("a.txt") instanceof URL;

        await probe("createReadStream", async () => {
          let body = "";
          for await (const chunk of fs.createReadStream(fileURL("a.txt"), "utf8")) body += chunk;
          return body;
        });
        await probe("createWriteStream", async () => {
          const stream = fs.createWriteStream(fileURL("w.txt"));
          stream.end("written");
          await once(stream, "finish");
          return fs.readFileSync("w.txt", "utf8");
        });
        await probe("watch", () => {
          fs.watch(fileURL("a.txt")).close();
          return "ok";
        });
        await probe("watchFile", () => {
          fs.watchFile(fileURL("a.txt"), () => {});
          fs.unwatchFile(fileURL("a.txt"));
          return "ok";
        });
        await probe("cpSync", () => {
          fs.cpSync(fileURL("a.txt"), "b.txt");
          return fs.readFileSync("b.txt", "utf8");
        });
        await probe("cp", async () => {
          await fs.promises.cp(fileURL("a.txt"), "c.txt");
          return fs.readFileSync("c.txt", "utf8");
        });
        await probe("Worker", async () => {
          const worker = new Worker(fileURL("worker.js"));
          const [message] = await once(worker, "message");
          await worker.terminate();
          return message;
        });
        await probe("http.get", async () => {
          const server = http.createServer((req, res) => res.end(req.url));
          server.listen(0);
          await once(server, "listening");
          try {
            const url = new NativeURL("http://127.0.0.1:" + server.address().port + "/some/path?q=1");
            const [res] = await once(http.get(url), "response");
            let body = "";
            for await (const chunk of res.setEncoding("utf8")) body += chunk;
            return body;
          } finally {
            server.close();
          }
        });
        console.log(JSON.stringify(out));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      instanceOfURL: false,
      createReadStream: "hello",
      createWriteStream: "written",
      watch: "ok",
      watchFile: "ok",
      cpSync: "hello",
      cp: "hello",
      Worker: "from worker",
      "http.get": "/some/path?q=1",
    });
    expect(exitCode).toBe(0);
  });
});
