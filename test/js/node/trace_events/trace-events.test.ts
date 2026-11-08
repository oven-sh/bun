import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The 'http.client.request' trace span must be closed on every terminal path,
// including ones that never reach the parser or the emitErrorEvent funnel.
test("http.client.request span is closed when the proxy CONNECT tunnel fails", async () => {
  using dir = tempDir("trace-events-proxy", {
    // A fake proxy that rejects the CONNECT with 502 -> ERR_PROXY_TUNNEL on the request.
    "main.mjs": `
      import net from "node:net";
      import https from "node:https";
      const proxy = net.createServer(s => {
        s.once("data", () => { s.end("HTTP/1.1 502 Bad Gateway\\r\\n\\r\\n"); });
      });
      proxy.listen(0, "127.0.0.1", () => {
        const agent = new https.Agent({
          proxyEnv: { HTTPS_PROXY: \`http://127.0.0.1:\${proxy.address().port}\` },
        });
        const r = https.request({ host: "example.invalid", port: 443, path: "/", agent });
        r.on("error", e => { console.log("errored", e.code); proxy.close(); });
        r.end();
      });
    `,
  });
  const traceFile = join(String(dir), "node_trace.log");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--trace-event-categories", "node.http", "--trace-event-file-pattern", traceFile, "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The scenario must actually have happened for the assertion below to mean anything.
  expect(stdout).toContain("errored ERR_PROXY_TUNNEL");

  const events = JSON.parse(readFileSync(traceFile, "utf8")).traceEvents;
  const phases = events.filter(e => e.name === "http.client.request").map(e => e.ph);
  expect({ phases: phases.sort(), exitCode }).toEqual({ phases: ["b", "e"], exitCode: 0 });
});

// fs.rm is one native call. Its span has the name of the lstat that Node's rm starts with. Node's rmSync runs no lstat
// for `recursive` with `force`, so that call has no span. A call that throws closes its span. Node opens none for it.
test("every form of fs.rm emits one balanced lstat span", async () => {
  using dir = tempDir("trace-events-rm", {
    "main.mjs": `
      import fs from "node:fs";
      for (const tree of ["callback", "promise", "sync", "forced"]) fs.mkdirSync(tree + "/a", { recursive: true });
      for (const file of ["file.txt", "sync.txt"]) fs.writeFileSync(file, "");
      const viaCallback = (...args) => new Promise(resolve => fs.rm(...args, resolve));

      fs.rmSync("sync.txt");
      fs.accessSync(".");
      fs.rmSync("sync", { recursive: true });
      fs.accessSync(".");
      fs.rmSync("forced", { recursive: true, force: true });
      fs.accessSync(".");

      try {
        fs.rm(123, () => {});
      } catch (err) {
        console.log("threw", err.code);
      }
      await fs.promises.access(".");
      await fs.promises.rm("promise", { recursive: true });
      await fs.promises.access(".");
      console.log("removed", await viaCallback("callback", { recursive: true }));
      await fs.promises.access(".");
      console.log("removed", await viaCallback("file.txt"));
    `,
  });
  const traceFile = join(String(dir), "node_trace.log");

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "--trace-event-categories",
      "node.fs.sync,node.fs.async",
      "--trace-event-file-pattern",
      traceFile,
      "main.mjs",
    ],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const events = JSON.parse(readFileSync(traceFile, "utf8")).traceEvents;
  // A call to access() stands between two calls to rm, so "|" closes the spans of one call.
  const spans = (lstat: string, access: string) =>
    events.map(e => (e.name === lstat ? e.ph : e.name === access && "Bb".includes(e.ph) ? "|" : "")).join("");
  const seen = { stdout, async: spans("lstat", "access"), sync: spans("fs.sync.lstat", "fs.sync.access"), exitCode };
  expect(seen).toEqual({
    stdout: "threw ERR_INVALID_ARG_TYPE\nremoved null\nremoved null\n",
    async: "be|be|be|be",
    sync: "BE|BE||",
    exitCode: 0,
  });
});
