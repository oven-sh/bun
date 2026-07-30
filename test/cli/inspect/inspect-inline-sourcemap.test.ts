import { spawn } from "bun";
import { expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { WebSocket } from "ws";

test("--inspect inline sourcemap sources[0] is a valid path under cwd", async () => {
  using dir = tempDir("inspect-sourcemap", {
    "sub/target.mjs": "// comment line\nsetInterval(() => {}, 200);\n",
  });
  const cwd = fs.realpathSync(String(dir));

  await using proc = spawn({
    cmd: [bunExe(), "--inspect=127.0.0.1:0", join("sub", "target.mjs")],
    env: bunEnv,
    cwd,
    stdout: "ignore",
    stderr: "pipe",
  });

  let url: URL | undefined;
  let stderr = "";
  const decoder = new TextDecoder();
  for await (const chunk of proc.stderr as ReadableStream) {
    stderr += decoder.decode(chunk);
    for (const line of stderr.split("\n")) {
      try {
        url = new URL(line);
      } catch {}
      if (url?.protocol.includes("ws")) break;
    }
    if (stderr.includes("Listening:")) break;
  }
  if (!url) {
    process.stderr.write(stderr);
    throw new Error("Unable to find listening URL");
  }

  const ws = new WebSocket(url);
  try {
    const failed = new Promise<never>((_, reject) => {
      ws.addEventListener("error", cause => reject(new Error("WebSocket error", { cause })));
      ws.addEventListener("close", cause => reject(new Error("WebSocket closed", { cause })));
      proc.exited.then(code => reject(new Error(`inspectee exited (${code})`)));
    });
    failed.catch(() => {});

    await Promise.race([new Promise<void>(resolve => ws.addEventListener("open", () => resolve())), failed]);

    const scriptParsed = new Promise<any>(resolve => {
      ws.addEventListener("message", ({ data }) => {
        const msg = JSON.parse(data.toString());
        if (msg.method === "Debugger.scriptParsed" && String(msg.params?.url ?? "").endsWith("target.mjs")) {
          resolve(msg.params);
        }
      });
    });
    ws.send(JSON.stringify({ id: 1, method: "Inspector.enable" }));
    ws.send(JSON.stringify({ id: 2, method: "Debugger.enable" }));
    const params = await Promise.race([scriptParsed, failed]);

    const m = String(params.sourceMapURL ?? "").match(/base64,([A-Za-z0-9+/=]+)/);
    expect(m).not.toBeNull();
    const map = JSON.parse(Buffer.from(m![1], "base64").toString());

    expect(map.sources[0]).toBe("/sub/target.mjs");
  } finally {
    ws.close();
  }
});
