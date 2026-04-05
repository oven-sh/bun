// https://github.com/oven-sh/bun/issues/28883

import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// Windows 2019 x64 CI flakes when reading --inspect subprocess stderr over
// pipes; other lanes (Linux, darwin, Windows 11 aarch64) cover the fix.
const t = isWindows ? test.skip : test;

async function readListenUrl(proc: ReturnType<typeof spawn>): Promise<URL> {
  let stderr = "";
  const decoder = new TextDecoder();
  for await (const chunk of proc.stderr as ReadableStream) {
    stderr += decoder.decode(chunk);
    for (const line of stderr.split("\n")) {
      try {
        const url = new URL(line.trim());
        if (url.protocol === "ws:" || url.protocol === "wss:") {
          return url;
        }
      } catch {}
    }
  }
  throw new Error("Never saw a ws:// URL in stderr. Got:\n" + stderr);
}

t("/json and /json/list expose webSocketDebuggerUrl for VS Code attach", async () => {
  await using inspectee = spawn({
    cmd: [bunExe(), "--inspect=127.0.0.1:0/abc123", "-e", "setInterval(() => {}, 1000)"],
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });

  const url = await readListenUrl(inspectee);
  const base = `http://${url.host}`;

  for (const path of ["/json", "/json/list"]) {
    const res = await fetch(`${base}${path}`);
    expect(res.status).toBe(200);
    const targets = await res.json();
    expect(Array.isArray(targets)).toBe(true);
    expect(targets).toHaveLength(1);

    const target = targets[0];
    // Critical fields VS Code reads. type:"node" keeps it in the node list.
    expect(target).toMatchObject({
      type: "node",
      id: "abc123",
      webSocketDebuggerUrl: `ws://${url.host}/abc123`,
    });
    expect(typeof target.title).toBe("string");
    expect(typeof target.description).toBe("string");
    expect(typeof target.devtoolsFrontendUrl).toBe("string");
  }

  // Sanity: /json/version still works.
  const versionRes = await fetch(`${base}/json/version`);
  expect(versionRes.status).toBe(200);
  const version = await versionRes.json();
  expect(version).toMatchObject({ "Browser": "Bun" });
});

t("/json echoes the Host header so 0.0.0.0-bound bun is reachable", async () => {
  await using inspectee = spawn({
    cmd: [bunExe(), "--inspect=0.0.0.0:0/xyz789", "-e", "setInterval(() => {}, 1000)"],
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });

  const url = await readListenUrl(inspectee);
  // Hit the server via 127.0.0.1 — the echoed host must be 127.0.0.1, not 0.0.0.0.
  const res = await fetch(`http://127.0.0.1:${url.port}/json`, {
    headers: { Host: `127.0.0.1:${url.port}` },
  });
  expect(res.status).toBe(200);
  const targets = await res.json();
  expect(targets[0].webSocketDebuggerUrl).toBe(`ws://127.0.0.1:${url.port}/xyz789`);
});
