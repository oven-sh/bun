import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";
import { WebSocket } from "ws";

async function startInspectee(): Promise<{ proc: ReturnType<typeof Bun.spawn>; wsUrl: URL }> {
  const proc = Bun.spawn({
    cwd: join(import.meta.dir, "../../cli/inspect"),
    cmd: [bunExe(), "--inspect=127.0.0.1:0", "inspectee.js"],
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });

  let stderr = "";
  const decoder = new TextDecoder();
  for await (const chunk of proc.stderr as ReadableStream) {
    stderr += decoder.decode(chunk);
    if (stderr.includes("Listening:")) {
      break;
    }
  }

  // Strip ANSI escape sequences before extracting the URL
  const cleaned = stderr.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
  const match = cleaned.match(/ws:\/\/\S+/);
  if (!match) {
    const exitCode = proc.exitCode;
    proc.kill();
    throw new Error(`Unable to find listening URL (exitCode=${exitCode}) in stderr: ${stderr}`);
  }
  return { proc, wsUrl: new URL(match[0]) };
}

describe("inspector /json endpoints", () => {
  test("/json/list returns target info with webSocketDebuggerUrl", async () => {
    const { proc, wsUrl } = await startInspectee();
    await using _ = proc;
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
    const { proc, wsUrl } = await startInspectee();
    await using _ = proc;
    const httpUrl = `http://${wsUrl.hostname}:${wsUrl.port}`;

    const [listResponse, jsonResponse] = await Promise.all([fetch(`${httpUrl}/json/list`), fetch(`${httpUrl}/json`)]);

    expect(listResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);

    const [listRes, jsonRes] = await Promise.all([listResponse.json(), jsonResponse.json()]);

    expect(jsonRes).toEqual(listRes);
  });

  test("/json/version still works", async () => {
    const { proc, wsUrl } = await startInspectee();
    await using _ = proc;
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
    const { proc, wsUrl } = await startInspectee();
    await using _ = proc;
    const httpUrl = `http://${wsUrl.hostname}:${wsUrl.port}`;

    const res = await fetch(`${httpUrl}/json/list`);
    const targets = await res.json();
    const debugUrl = targets[0].webSocketDebuggerUrl;

    // Connect using the discovered URL (use `ws` package like existing inspect tests)
    const ws = new WebSocket(debugUrl);

    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", cause => reject(new Error("WebSocket error", { cause })));
      ws.addEventListener("close", cause => reject(new Error("WebSocket closed", { cause })));
    });

    // Set up message listener before sending to avoid race
    const messagePromise = new Promise<any>(resolve => {
      ws.addEventListener("message", ({ data }) => {
        const parsed = JSON.parse(data.toString());
        if (parsed.id === 1) {
          resolve(parsed);
        }
      });
    });

    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "2 + 2" } }));

    const result = await messagePromise;
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
