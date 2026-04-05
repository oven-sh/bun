// https://github.com/oven-sh/bun/issues/28883

import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, randomPort } from "harness";

async function waitForInspector(base: string, maxMs = 10_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/json/version`);
      if (res.status === 200) {
        await res.arrayBuffer();
        return;
      }
      await res.arrayBuffer();
    } catch {}
    await Bun.sleep(50);
  }
  throw new Error(`Inspector never came up at ${base}`);
}

test("/json and /json/list expose webSocketDebuggerUrl for VS Code attach", async () => {
  const port = randomPort();
  await using inspectee = spawn({
    cmd: [bunExe(), `--inspect=127.0.0.1:${port}/abc123`, "-e", "setInterval(() => {}, 1000)"],
    env: bunEnv,
    stdout: "ignore",
    stderr: "ignore",
  });

  const base = `http://127.0.0.1:${port}`;
  await waitForInspector(base);

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
      webSocketDebuggerUrl: `ws://127.0.0.1:${port}/abc123`,
    });
    expect(typeof target.title).toBe("string");
    expect(typeof target.description).toBe("string");
    expect(typeof target.devtoolsFrontendUrl).toBe("string");
  }
});

test("/json echoes the Host header so 0.0.0.0-bound bun is reachable", async () => {
  const port = randomPort();
  await using inspectee = spawn({
    cmd: [bunExe(), `--inspect=0.0.0.0:${port}/xyz789`, "-e", "setInterval(() => {}, 1000)"],
    env: bunEnv,
    stdout: "ignore",
    stderr: "ignore",
  });

  const base = `http://127.0.0.1:${port}`;
  await waitForInspector(base);

  // Hit the server via 127.0.0.1 — the echoed host must be 127.0.0.1, not 0.0.0.0.
  const res = await fetch(`${base}/json`, {
    headers: { Host: `127.0.0.1:${port}` },
  });
  expect(res.status).toBe(200);
  const targets = await res.json();
  expect(targets[0].webSocketDebuggerUrl).toBe(`ws://127.0.0.1:${port}/xyz789`);
});
