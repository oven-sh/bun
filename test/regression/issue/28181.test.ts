import { spawn } from "bun";
import { afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

let inspectee: ReturnType<typeof spawn> | undefined;

afterEach(() => {
  inspectee?.kill();
  inspectee = undefined;
});

async function startInspectee(): Promise<URL> {
  inspectee = spawn({
    cwd: join(import.meta.dir, "../../cli/inspect"),
    cmd: [bunExe(), "--inspect=127.0.0.1:0", "inspectee.js"],
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });

  let stderr = "";
  const decoder = new TextDecoder();
  for await (const chunk of inspectee.stderr as ReadableStream) {
    stderr += decoder.decode(chunk);
    if (stderr.includes("Listening:")) {
      break;
    }
  }

  const match = stderr.match(/ws:\/\/[^\s\x1b]+/);
  if (!match) {
    throw new Error("Unable to find listening URL in stderr: " + stderr);
  }
  return new URL(match[0]);
}

describe("inspector /json endpoints", () => {
  test("/json/list returns target info with webSocketDebuggerUrl", async () => {
    const wsUrl = await startInspectee();
    const httpUrl = `http://${wsUrl.hostname}:${wsUrl.port}`;

    const res = await fetch(`${httpUrl}/json/list`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const targets = await res.json();
    expect(targets).toBeArray();
    expect(targets).toHaveLength(1);

    const target = targets[0];
    expect(target).toMatchObject({
      description: "Bun instance",
      type: "node",
    });
    expect(target.webSocketDebuggerUrl).toStartWith("ws://");
    expect(target.id).toBeString();
    expect(target.title).toBeString();
    expect(target.url).toStartWith("file://");
    expect(target.devtoolsFrontendUrl).toBeString();
  });

  test("/json returns the same as /json/list", async () => {
    const wsUrl = await startInspectee();
    const httpUrl = `http://${wsUrl.hostname}:${wsUrl.port}`;

    const [listRes, jsonRes] = await Promise.all([
      fetch(`${httpUrl}/json/list`).then(r => r.json()),
      fetch(`${httpUrl}/json`).then(r => r.json()),
    ]);

    // Both should have the same structure
    expect(jsonRes).toHaveLength(1);
    expect(listRes).toHaveLength(1);
    expect(jsonRes[0].type).toBe(listRes[0].type);
    expect(jsonRes[0].description).toBe(listRes[0].description);
  });

  test("/json/version still works", async () => {
    const wsUrl = await startInspectee();
    const httpUrl = `http://${wsUrl.hostname}:${wsUrl.port}`;

    const res = await fetch(`${httpUrl}/json/version`);
    expect(res.status).toBe(200);

    const version = await res.json();
    expect(version).toMatchObject({
      "Protocol-Version": "1.3",
      "Browser": "Bun",
    });
    expect(version["Bun-Version"]).toBeString();
  });

  test("webSocketDebuggerUrl from /json/list is connectable", async () => {
    const wsUrl = await startInspectee();
    const httpUrl = `http://${wsUrl.hostname}:${wsUrl.port}`;

    const res = await fetch(`${httpUrl}/json/list`);
    const targets = await res.json();
    const debugUrl = targets[0].webSocketDebuggerUrl;

    // Connect using the discovered URL
    const ws = new WebSocket(debugUrl);

    const opened = await new Promise<boolean>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(true));
      ws.addEventListener("error", () => reject(new Error("WebSocket error")));
    });
    expect(opened).toBe(true);

    // Verify we can execute commands over the discovered WebSocket
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "2 + 2" } }));

    const result = await new Promise<any>(resolve => {
      ws.addEventListener("message", event => {
        resolve(JSON.parse(String(event.data)));
      });
    });

    expect(result).toMatchObject({
      id: 1,
      result: {
        result: {
          type: "number",
          value: 4,
        },
      },
    });

    ws.close();
  });
});
