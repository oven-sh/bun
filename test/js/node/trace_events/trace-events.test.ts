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

// fs.rm is one native call. Its span is the lstat that Node's rm starts with, also for a recursive call and for a
// call that throws.
test("every form of fs.rm emits one balanced lstat span", async () => {
  using dir = tempDir("trace-events-rm", {
    "main.mjs": `
      import fs from "node:fs";
      for (const tree of ["callback", "promise", "sync"]) fs.mkdirSync(tree + "/a", { recursive: true });
      fs.writeFileSync("file.txt", "");
      try {
        fs.rm(123, () => {});
      } catch (err) {
        console.log("threw", err.code);
      }
      fs.rmSync("sync", { recursive: true });
      await fs.promises.rm("promise", { recursive: true });
      fs.rm("callback", { recursive: true }, first => {
        fs.rm("file.txt", second => console.log("removed", first ?? second));
      });
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
  const phases = (name: string) =>
    events
      .filter(e => e.name === name)
      .map(e => e.ph)
      .sort()
      .join("");
  expect({ stdout, async: phases("lstat"), sync: phases("fs.sync.lstat"), exitCode }).toEqual({
    stdout: "threw ERR_INVALID_ARG_TYPE\nremoved null\n",
    async: "bbbbeeee",
    sync: "BE",
    exitCode: 0,
  });
});
