// https://github.com/oven-sh/bun/issues/28984
//
// WebStorm's "Coding assistance for Node.js" configures the debugger by
// hitting GET /json and /json/list on the inspector HTTP server to discover
// the webSocketDebuggerUrl. Bun used to 404 those endpoints, so the IDE
// failed with "Cannot connect to VM localhost/127.0.0.1:<port>".
//
// Make sure both endpoints now return a CDP-compatible array describing the
// current target and that its webSocketDebuggerUrl actually accepts an
// upgrade.
import { spawn } from "bun";
import { afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

let inspectee: ReturnType<typeof spawn> | undefined;

afterEach(() => {
  inspectee?.kill();
  inspectee = undefined;
});

async function startInspector(extraArgs: string[] = []): Promise<URL> {
  inspectee = spawn({
    cmd: [bunExe(), "--inspect=127.0.0.1:0", ...extraArgs, "-e", "setInterval(() => {}, 1000)"],
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });

  const decoder = new TextDecoder();
  let stderr = "";
  for await (const chunk of inspectee.stderr as ReadableStream) {
    stderr += decoder.decode(chunk);
    for (const line of stderr.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("ws:")) continue;
      try {
        return new URL(trimmed);
      } catch {
        // keep looking
      }
    }
    if (stderr.includes("Listening:") && stderr.includes("Inspect in browser")) {
      break;
    }
  }

  throw new Error(`Unable to find inspector URL in stderr: ${stderr}`);
}

async function fetchJson(wsUrl: URL, pathname: string): Promise<Response> {
  const httpUrl = new URL(pathname, `http://${wsUrl.host}/`);
  return await fetch(httpUrl);
}

function assertTarget(entry: unknown, wsUrl: URL) {
  expect(typeof entry).toBe("object");
  const e = entry as Record<string, unknown>;

  // Capture the scalar fields BEFORE any matcher mutation and assert them
  // with primitive checks — JetBrains's Node.js coding assistance matches
  // on type === "node" so that's the field that matters most for #28984.
  expect(typeof e.description).toBe("string");
  expect(typeof e.faviconUrl).toBe("string");
  expect(typeof e.id).toBe("string");
  expect((e.id as string).length).toBeTruthy();
  expect(typeof e.title).toBe("string");
  expect((e.title as string).length).toBeTruthy();
  expect(e.type).toBe("node");
  expect(e.devtoolsFrontendUrl as string).toContain("debug.bun.sh");
  expect(e.url as string).toMatch(/^file:\/\//);

  // The websocket URL must point back at the same host:port the HTTP
  // request landed on, with the inspector's pathname preserved.
  expect(typeof e.webSocketDebuggerUrl).toBe("string");
  const wsDebugger = new URL(e.webSocketDebuggerUrl as string);
  expect(wsDebugger.protocol).toBe("ws:");
  expect(wsDebugger.host).toBe(wsUrl.host);
  expect(wsDebugger.pathname).toBe(wsUrl.pathname);
}

describe("issue #28984 — inspector /json discovery endpoints", () => {
  test("GET /json returns a non-empty CDP target list", async () => {
    const wsUrl = await startInspector();
    const res = await fetchJson(wsUrl, "/json");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list).toHaveLength(1);
    assertTarget(list[0], wsUrl);
  });

  test("GET /json/list matches GET /json", async () => {
    const wsUrl = await startInspector();
    const [a, b] = await Promise.all([fetchJson(wsUrl, "/json"), fetchJson(wsUrl, "/json/list")]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const [listA, listB] = await Promise.all([a.json(), b.json()]);
    expect(listA).toEqual(listB);
    expect(listA).toHaveLength(1);
    assertTarget(listA[0], wsUrl);
  });

  test("webSocketDebuggerUrl from /json/list actually upgrades", async () => {
    const wsUrl = await startInspector();
    const res = await fetchJson(wsUrl, "/json/list");
    const [target] = await res.json();

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", e => reject(new Error("websocket error", { cause: e })));
    ws.addEventListener("close", e => reject(new Error("websocket closed", { cause: e })));

    try {
      await promise;
    } finally {
      ws.close();
    }
  });

  test("GET /json/version still works alongside /json", async () => {
    const wsUrl = await startInspector();
    const res = await fetchJson(wsUrl, "/json/version");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      "Protocol-Version": expect.any(String),
      "Browser": "Bun",
      "Bun-Version": expect.any(String),
    });
  });

  test("POST /json is rejected with 405", async () => {
    const wsUrl = await startInspector();
    const res = await fetch(new URL("/json", `http://${wsUrl.host}/`), { method: "POST" });
    expect(res.status).toBe(405);
  });
});
