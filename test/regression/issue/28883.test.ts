// https://github.com/oven-sh/bun/issues/28883
//
// VS Code's "Attach to Node Process" action queries /json (aka /json/list) on
// the inspector HTTP server to discover the WebSocket URL. Bun used to 404
// this path, so the attach hung. /json now returns the standard Chrome
// DevTools Protocol target array with a webSocketDebuggerUrl the client can
// dial straight through.

import { spawn } from "bun";
import { afterEach, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { WebSocket } from "ws";

let inspectee: ReturnType<typeof spawn> | undefined;

afterEach(() => {
  inspectee?.kill();
  inspectee = undefined;
});

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
    if (stderr.includes("Listening:") && stderr.includes("\n")) {
      // Give the second line a chance to arrive if it hasn't yet.
    }
  }
  throw new Error("Never saw a ws:// URL in stderr. Got:\n" + stderr);
}

test("/json and /json/list expose webSocketDebuggerUrl for VS Code attach", async () => {
  inspectee = spawn({
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

  // And crucially: connect to the URL we just advertised and run some JS.
  const webSocketDebuggerUrl = (await (await fetch(`${base}/json`)).json())[0].webSocketDebuggerUrl;
  const ws = new WebSocket(webSocketDebuggerUrl);
  const { promise: opened, resolve: onOpen, reject: onError } = Promise.withResolvers<void>();
  ws.addEventListener("open", () => onOpen());
  ws.addEventListener("error", cause => onError(new Error("WebSocket error", { cause })));
  ws.addEventListener("close", cause => onError(new Error("WebSocket closed before open", { cause })));
  await opened;

  const { promise: replied, resolve: onMessage } = Promise.withResolvers<any>();
  ws.addEventListener("message", ({ data }) => onMessage(JSON.parse(data.toString())));
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "1 + 1" } }));
  const response = await replied;
  expect(response).toMatchObject({
    id: 1,
    result: { result: { type: "number", value: 2 } },
  });
  ws.close();
});

test("/json echoes the Host header so 0.0.0.0-bound bun is reachable", async () => {
  inspectee = spawn({
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
