import { DataViewReader } from "bake/data-view";
import { decodeSerializedError } from "bake/error-serialization.ts";
import { Subprocess, spawn } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "fs";
import { bunExe, bunEnv as env, isPosix, tmpdirSync } from "harness";
import path, { join } from "node:path";
import { InspectorSession, connect } from "./junit-reporter";
import { SocketFramer } from "./socket-framer";
const bunEnv = { ...env, NODE_ENV: "development" };
class BunFrontendDevServerSession extends InspectorSession {
  constructor() {
    super();
  }

  async enable(): Promise<void> {
    this.send("Inspector.enable");
    this.send("Console.enable");
    this.send("Runtime.enable");
    this.send("BunFrontendDevServer.enable");
    this.send("LifecycleReporter.enable");
    await this.sendAndWait("Inspector.initialized");
  }

  async disable(): Promise<void> {
    await this.sendAndWait("BunFrontendDevServer.disable");
  }

  // Helper to send a message and wait for its response
  async sendAndWait(method: string, params: any = {}): Promise<any> {
    if (!this.framer) throw new Error("Socket not connected");
    const id = this.nextId++;
    const message = { id, method, params };

    const responsePromise = new Promise<any>(resolve => {
      this.messageCallbacks.set(id, resolve);
    });

    this.framer.send(this.socket as any, JSON.stringify(message));

    const response = await responsePromise;
    if (response.error) {
      throw new Error(`Inspector error: ${response.error.message || JSON.stringify(response.error)}`);
    }
    return response;
  }

  unref() {
    this.socket?.unref();
  }

  ref() {
    this.socket?.ref();
  }

  // Waits for a specific event to be fired
  waitForEvent(eventName: string, timeout = 5000): Promise<any> {
    this.ref();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for event: ${eventName}`));
      }, timeout);

      const listener = (params: any) => {
        clearTimeout(timer);
        resolve(params);
      };

      this.addEventListener(eventName, listener);
    });
  }
}

describe.if(isPosix)("BunFrontendDevServer inspector protocol", () => {
  let devServerProcess: Subprocess;
  let serverUrl: URL;
  let session: BunFrontendDevServerSession;
  let tempdir: string;
  let socketPath: string;

  beforeAll(async () => {
    tempdir = tmpdirSync("bun-frontend-dev-server-test");

    // Create a simple app for testing without dependencies
    fs.writeFileSync(
      join(tempdir, "index.html"),
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Dev Server Test</title>
          <link rel="stylesheet" href="./styles.css" />
        </head>
        <body>
          <div id="app"></div>
          <script type="module" src="./main.ts"></script>
        </body>
      </html>
    `,
    );

    fs.writeFileSync(
      join(tempdir, "styles.css"),
      `
      body {
        background-color: #f0f0f0;
        color: #333;
        font-family: sans-serif;
      }
    `,
    );

    fs.writeFileSync(
      join(tempdir, "utils.ts"),
      `
      // Utility module to test dependencies
      export function greet(name: string) {
        return \`Hello, \${name}!\`;
      }
    `,
    );

    fs.writeFileSync(
      join(tempdir, "main.ts"),
      `
      import { greet } from './utils';
      
      // No dependencies needed
      document.addEventListener('DOMContentLoaded', () => {
        const app = document.getElementById('app');
        if (app) {
          app.innerHTML = \`
            <h1>\${greet('Dev Server')}</h1>
            <p>This is a test page for the bundler</p>
          \`;
        }
      });
    `,
    );
    // Create a second page to navigate to
    fs.writeFileSync(
      join(tempdir, "second.html"),
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Second Page</title>
          <script src="./main.ts" type="module" />
        </head>
        <body>
          <h1>Second Page</h1>
        </body>
      </html>
    `,
    );

    fs.writeFileSync(
      join(tempdir, "server.ts"),
      /* js */ `
      import { serve } from "bun";
      import homepage from "./index.html";
      import second from './second.html';

      const server = serve({
        port: 0, // Use a random available port
        routes: {
          "/": homepage,
          "/second": second,
        },
        development: true, // Enable HMR
      });

      console.log("Server listening at " + server.url);
    `,
    );

    const cwd = process.cwd();
    process.chdir(tempdir);

    // Create socket for inspector protocol
    socketPath = `inspector-${Math.random().toString(36).substring(2)}.sock`;

    try {
      const socketPromise = connect(`unix://${socketPath}`);

      // Start the server with inspector enabled (Unix socket only)
      devServerProcess = spawn({
        cmd: [bunExe(), `--inspect=unix:${socketPath}`, join(tempdir, "server.ts")],
        env: bunEnv,
        cwd: tempdir,
        stdout: "pipe",
        stderr: "pipe",
      });

      // Wait for the server to start
      let stdout = "";
      for await (const chunk of devServerProcess.stdout) {
        stdout += new TextDecoder().decode(chunk);
        if (stdout.includes("Server listening at")) {
          const match = stdout.match(/Server listening at (http:\/\/[^\s]+)/);
          if (match) {
            serverUrl = new URL(match[1]);
            break;
          }
        }
      }

      if (!serverUrl) {
        console.log(await new Response(devServerProcess.stderr).text());
        throw new Error("Failed to start dev server");
      }

      // Connect to the inspector socket using Unix domain socket
      session = new BunFrontendDevServerSession();
      const socket = await socketPromise;
      const framer = new SocketFramer((message: string) => {
        session.onMessage(message);
      });
      session.socket = socket;
      session.framer = framer;
      socket.data = {
        onData: framer.onData.bind(framer),
      };

      // Enable the BunFrontendDevServer domain
      await session.enable();
    } finally {
      if (devServerProcess) {
        devServerProcess.unref();
      }

      process.chdir(cwd);
    }
  });

  afterAll(() => {
    session?.disable().catch(() => {});
    devServerProcess?.kill();

    if (tempdir) {
      fs.rmSync(tempdir, { recursive: true, force: true });
    }
  });

  // WebSocket client for HMR testing
  async function createHMRClient() {
    // Create a minimal WebSocket client for HMR
    const wsUrl = new URL(serverUrl);
    wsUrl.protocol = "ws:";
    wsUrl.pathname = "/_bun/hmr"; // HMR endpoint

    // Native WebSocket implementation
    const socket = new WebSocket(wsUrl.toString());
    socket.binaryType = "arraybuffer";

    // Wait for connection to open
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
        resolve();
      };

      const onError = (err: any) => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
        reject(err);
      };

      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
    });

    return socket;
  }

  test("should receive clientConnected and clientDisconnected events", async () => {
    // Listen for the clientConnected event
    const eventPromise = session.waitForEvent("BunFrontendDevServer.clientConnected");

    // Create a client connection to trigger the event
    const ws = await createHMRClient();

    // Verify we received the clientConnected event
    const event = await eventPromise;
    expect(event).toHaveProperty("connectionId");
    expect(typeof event.connectionId).toBe("number");

    // Listen for the clientDisconnected event when client disconnects
    const disconnectEventPromise = session.waitForEvent("BunFrontendDevServer.clientDisconnected");

    // Close the connection
    ws.close();

    // Verify the clientDisconnected event
    const disconnectEvent = await disconnectEventPromise;
    expect(disconnectEvent).toHaveProperty("connectionId");
    expect(disconnectEvent.connectionId).toBe(event.connectionId);
    session.unref();
  });

  test("should notify on bundleStart and bundleComplete events", async () => {
    // Immediately start listening for events.
    const bundleStartEventPromise = session.waitForEvent("BunFrontendDevServer.bundleStart");
    const bundleCompleteEventPromise = session.waitForEvent("BunFrontendDevServer.bundleComplete");

    // Update file to trigger a build
    fs.writeFileSync(
      join(tempdir, "utils.ts"),
      `
      // Updated utility module to trigger bundling
      export function greet(name: string) {
        return \`Hello there, \${name}!\`;
      }
      
      export function formatTime(date: Date) {
        return date.toLocaleTimeString();
      }
    `,
    );

    // Force a rebuild by making a request to the server
    const resp = await fetch(serverUrl.href);
    await resp.blob();
    expect(resp.status).toBe(200);
    const bundleStartEvent = await bundleStartEventPromise;
    expect(bundleStartEvent).toHaveProperty("triggerFiles");
    expect(Array.isArray(bundleStartEvent.triggerFiles)).toBe(true);
    expect(bundleStartEvent).toHaveProperty("serverId");
    expect(typeof bundleStartEvent.serverId).toBe("number");

    // Store the serverId for verification in bundleComplete
    const serverId = bundleStartEvent.serverId;

    // Wait for bundleComplete event
    const bundleCompleteEvent = await bundleCompleteEventPromise;
    expect(bundleCompleteEvent).toHaveProperty("durationMs");
    expect(typeof bundleCompleteEvent.durationMs).toBe("number");
    expect(bundleCompleteEvent).toHaveProperty("serverId");
    expect(bundleCompleteEvent.serverId).toBe(serverId);

    // Verify the duration is reasonable
    expect(bundleCompleteEvent.durationMs).toBeGreaterThan(-1);

    // Test for LifecycleReporter.getModuleGraph
    type ModuleGraph = {
      argv: string[];
      cjs: string[];
      esm: string[];
      main: string;
      cwd: string;
    };
    const moduleGraph = (await session.sendAndWait("LifecycleReporter.getModuleGraph")) as ModuleGraph;
    const realCwd = path.resolve(tempdir).replaceAll("\\", "/");
    moduleGraph.argv = moduleGraph.argv.map(a => path.basename(a));
    moduleGraph.cjs = moduleGraph.cjs.map(a => a.replaceAll("\\", "/").replaceAll(realCwd, "<cwd>"));
    moduleGraph.esm = moduleGraph.esm.map(a => a.replaceAll("\\", "/").replaceAll(realCwd, "<cwd>"));
    moduleGraph.main = moduleGraph.main.replaceAll("\\", "/").replaceAll(realCwd, "<cwd>");
    moduleGraph.cwd = moduleGraph.cwd.replaceAll("\\", "/").replaceAll(realCwd, "<cwd>");
    expect(moduleGraph).toMatchInlineSnapshot(`
      {
        "argv": [
          "${path.basename(process.execPath)}",
          "server.ts",
        ],
        "cjs": [],
        "cwd": "<cwd>",
        "esm": [
          "bun:main",
          "<cwd>/server.ts",
          "<cwd>/index.html",
          "<cwd>/second.html",
        ],
        "main": "<cwd>/server.ts",
      }
    `);
  });

  test("should notify on bundleFailed events", async () => {
    // Create a file with a syntax error to trigger a bundle failure
    const invalidContent = `
      // Syntax error - missing closing parenthesis
      export function brokenFunction(name: string {
        return \`Broken, \${name}!\`;
      }
    `;

    // Listen for bundleStart event first to get the serverId
    const bundleStartPromise = session.waitForEvent("BunFrontendDevServer.bundleStart");

    // Then listen for bundleFailed event
    const bundleFailedPromise = session.waitForEvent("BunFrontendDevServer.bundleFailed");

    // Create the invalid file
    fs.writeFileSync(join(tempdir, "utils.ts"), invalidContent);

    await Bun.sleep(100);

    // Force a rebuild
    const response = await fetch(serverUrl.href);
    expect(response.status).toBe(500);
    await response.blob();

    // Verify we got bundleStart event
    const bundleStartEvent = await bundleStartPromise;
    expect(bundleStartEvent).toHaveProperty("serverId");
    const serverId = bundleStartEvent.serverId;

    // Verify we got bundleFailed event
    const bundleFailedEvent = await bundleFailedPromise;
    expect(bundleFailedEvent).toHaveProperty("buildErrorsPayloadBase64");
    expect(typeof bundleFailedEvent.buildErrorsPayloadBase64).toBe("string");
    expect(bundleFailedEvent).toHaveProperty("serverId");
    expect(bundleFailedEvent.serverId).toBe(serverId);

    // Verify the payload is a valid base64 string
    const buffer = Uint8Array.from(atob(bundleFailedEvent.buildErrorsPayloadBase64), c => c.charCodeAt(0));
    expect(buffer.length).toBeGreaterThan(0);

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let errors: Array<ReturnType<typeof decodeAndAppendServerError>> = [];

    const reader = new DataViewReader(view, 0);

    while (reader.hasMoreData()) {
      errors.push(decodeAndAppendServerError(reader));
    }

    // Set it to a deterministic number.
    errors[0].owner = 123;

    expect(errors).toMatchInlineSnapshot(`
      [
        {
          "file": "utils.ts",
          "messages": [
            {
              "kind": "bundler",
              "level": 0,
              "location": {
                "column": 51,
                "length": 1,
                "line": 3,
                "lineText": "      export function brokenFunction(name: string {",
              },
              "message": "Expected ")" but found "{"",
              "notes": [],
            },
            {
              "kind": "bundler",
              "level": 0,
              "location": {
                "column": 7,
                "length": 1,
                "line": 5,
                "lineText": "      }",
              },
              "message": "Unexpected }",
              "notes": [],
            },
          ],
          "owner": 123,
        },
      ]
    `);

    // Fix the file so subsequent tests don't fail
    fs.writeFileSync(
      join(tempdir, "utils.ts"),
      `
      // Fixed utility module
      export function greet(name: string) {
        return \`Hello, \${name}!\`;
      }
    `,
    );
  });

  test("should notify on clientNavigated events", async () => {
    await fetch(serverUrl.href).then(r => r.blob());

    // Connect a client to trigger connection events
    const ws = await createHMRClient();

    // Wait for clientConnected event to get the connectionId
    const connectedEvent = await session.waitForEvent("BunFrontendDevServer.clientConnected");
    const connectionId = connectedEvent.connectionId;

    // Listen for clientNavigated event
    const clientNavigatedPromise = session.waitForEvent("BunFrontendDevServer.clientNavigated");

    const url = new URL(serverUrl);
    url.pathname = "/second";
    await fetch(serverUrl.href).then(r => r.blob());

    ws.send("n" + "/second");

    const clientNavigatedEvent = await clientNavigatedPromise;
    expect(clientNavigatedEvent).toHaveProperty("connectionId");
    expect(clientNavigatedEvent.connectionId).toBe(connectionId);
    expect(clientNavigatedEvent).toHaveProperty("url");
    expect(clientNavigatedEvent.url).toContain("/second");

    // routeBundleId is optional, so we don't strictly check for it
    expect(clientNavigatedEvent.routeBundleId).toBe(1);

    // Clean up
    ws.close();
  });

  test("should notify on consoleLog events", async () => {
    await fetch(serverUrl.href).then(r => r.blob());

    // Connect a client to trigger connection events
    const ws = await createHMRClient();

    // Wait for clientConnected event to get the connectionId
    const connectedEvent = await session.waitForEvent("BunFrontendDevServer.clientConnected");

    // Listen for consoleLog event
    const consoleLogPromise = session.waitForEvent("BunFrontendDevServer.consoleLog");

    // Send a console log message from the client
    // 'l' is the message type for console.log (see ConsoleLogKind enum in DevServer.zig)
    ws.send("ll" + "Hello from client test");

    // Verify we received the consoleLog event
    const consoleLogEvent = await consoleLogPromise;
    expect(consoleLogEvent).toHaveProperty("kind");
    expect(consoleLogEvent.kind).toBe("l".charCodeAt(0));
    expect(consoleLogEvent).toHaveProperty("message");
    expect(consoleLogEvent.message).toBe("Hello from client test");

    // Test error log
    const consoleErrorPromise = session.waitForEvent("BunFrontendDevServer.consoleLog");
    ws.send("le" + "Error from client test");

    const consoleErrorEvent = await consoleErrorPromise;
    expect(consoleErrorEvent).toHaveProperty("kind");
    expect(consoleErrorEvent.kind).toBe("e".charCodeAt(0));
    expect(consoleErrorEvent).toHaveProperty("message");
    expect(consoleErrorEvent.message).toBe("Error from client test");

    // Clean up
    ws.close();
  });

  test.todo("should notify on clientErrorReported events", async () => {
    // fs.writeFileSync(join(tempdir, "main.ts"), errorReportingScript);

    // Force a rebuild
    await fetch(serverUrl.href);

    // Listen for clientErrorReported event
    const clientErrorPromise = session.waitForEvent("BunFrontendDevServer.clientErrorReported");

    // Create an HMR client to receive updates
    const ws = await createHMRClient();

    // Verify we received the clientErrorReported event (with graceful fallback)
    const clientErrorEvent = await clientErrorPromise;
    expect(clientErrorEvent).toHaveProperty("clientErrorPayloadBase64");

    // Verify the payload is a valid base64 string
    const base64Payload = clientErrorEvent.clientErrorPayloadBase64;
    expect(typeof base64Payload).toBe("string");

    const buffer = Buffer.from(base64Payload, "base64");
    expect(buffer.length).toBeGreaterThan(0);

    // Clean up
    ws.close();
  });

  test.todo("should notify on graphUpdate events", async () => {
    // Create a more complex dependency graph to trigger graph visualization updates
    fs.writeFileSync(
      join(tempdir, "module-a.ts"),
      `
      export function moduleA() {
        return "Module A";
      }
    `,
    );

    fs.writeFileSync(
      join(tempdir, "module-b.ts"),
      `
      import { moduleA } from './module-a';
      export function moduleB() {
        return moduleA() + " -> Module B";
      }
    `,
    );

    fs.writeFileSync(
      join(tempdir, "module-c.ts"),
      `
      import { moduleB } from './module-b';
      export function moduleC() {
        return moduleB() + " -> Module C";
      }
    `,
    );

    fs.writeFileSync(
      join(tempdir, "main.ts"),
      `
      import { moduleA } from './module-a';
      import { moduleB } from './module-b';
      import { moduleC } from './module-c';
      
      document.addEventListener('DOMContentLoaded', () => {
        const app = document.getElementById('app');
        if (app) {
          app.innerHTML = \`
            <h1>Module Dependencies Test</h1>
            <p>\${moduleA()}</p>
            <p>\${moduleB()}</p>
            <p>\${moduleC()}</p>
          \`;
        }
      });
    `,
    );

    // Listen for graphUpdate event
    const graphUpdatePromise = session.waitForEvent("BunFrontendDevServer.graphUpdate");

    // Force a rebuild
    await fetch(serverUrl.href);

    // Verify we received the graphUpdate event (with graceful fallback)

    const graphUpdateEvent = await graphUpdatePromise;
    expect(graphUpdateEvent).toHaveProperty("visualizerPayloadBase64");

    // Verify the payload is a valid base64 string
    const base64Payload = graphUpdateEvent.visualizerPayloadBase64;
    expect(typeof base64Payload).toBe("string");

    const buffer = Buffer.from(base64Payload, "base64");
    expect(buffer.length).toBeGreaterThan(0);

    expect(decodeGraphUpdate(buffer)).toMatchInlineSnapshot(`
      {
        "clientEdges": [
          {
            "from": 0,
            "to": 1,
          },
          {
            "from": 0,
            "to": 2,
          },
          {
            "from": 2,
            "to": 3,
          },
          {
            "from": 2,
            "to": 4,
          },
          {
            "from": 2,
            "to": 5,
          },
          {
            "from": 4,
            "to": 3,
          },
          {
            "from": 5,
            "to": 4,
          },
        ],
        "clientFiles": [
          {
            "id": 0,
            "isBoundary": false,
            "isFramework": false,
            "isRoute": true,
            "isSSR": false,
            "isServer": false,
            "isStale": false,
            "name": "index.html",
          },
          {
            "id": 1,
            "isBoundary": false,
            "isFramework": false,
            "isRoute": false,
            "isSSR": false,
            "isServer": false,
            "isStale": false,
            "name": "styles.css",
          },
          {
            "id": 2,
            "isBoundary": false,
            "isFramework": false,
            "isRoute": false,
            "isSSR": false,
            "isServer": false,
            "isStale": false,
            "name": "main.ts",
          },
          {
            "id": 3,
            "isBoundary": false,
            "isFramework": false,
            "isRoute": false,
            "isSSR": false,
            "isServer": false,
            "isStale": false,
            "name": "module-a.ts",
          },
          {
            "id": 4,
            "isBoundary": false,
            "isFramework": false,
            "isRoute": false,
            "isSSR": false,
            "isServer": false,
            "isStale": false,
            "name": "module-b.ts",
          },
          {
            "id": 5,
            "isBoundary": false,
            "isFramework": false,
            "isRoute": false,
            "isSSR": false,
            "isServer": false,
            "isStale": false,
            "name": "module-c.ts",
          },
          {
            "id": 6,
            "isBoundary": false,
            "isFramework": false,
            "isRoute": false,
            "isSSR": false,
            "isServer": false,
            "isStale": false,
            "name": "utils.ts",
          },
          {
            "id": 7,
            "isBoundary": false,
            "isFramework": false,
            "isRoute": true,
            "isSSR": false,
            "isServer": false,
            "isStale": true,
            "name": "second.html",
          },
        ],
        "serverEdges": [],
        "serverFiles": [],
      }
    `);
  });
});

function decodeGraphUpdate(buffer) {
  let clientFiles: Array<{
    id: number;
    name?: string;
    deleted?: boolean;
    isStale?: boolean;
    isServer?: boolean;
    isSSR?: boolean;
    isRoute?: boolean;
    isFramework?: boolean;
    isBoundary?: boolean;
  }> = [];
  let serverFiles: Array<{
    id: number;
    name?: string;
    deleted?: boolean;
    isStale?: boolean;
    isServer?: boolean;
    isSSR?: boolean;
    isRoute?: boolean;
    isFramework?: boolean;
    isBoundary?: boolean;
  }> = [];
  let clientEdges: Array<{ from: number; to: number }> = [];
  let serverEdges: Array<{ from: number; to: number }> = [];

  function decodeAndUpdate(buffer) {
    // Only process messages starting with 'v' (ASCII code 118)
    if (buffer[0] !== 118) return;

    let offset = 1; // Skip the 'v' byte

    // Parse client files
    const clientFileCount = readUint32(buffer, offset);
    offset += 4;

    const update = parseFiles(buffer, clientFileCount, offset);
    offset = update.offset;
    clientFiles = update.files;

    // Parse server files
    const serverFileCount = readUint32(buffer, offset);
    offset += 4;

    const update2 = parseFiles(buffer, serverFileCount, offset);
    offset = update2.offset;
    serverFiles = update2.files;

    // Parse client edges
    const clientEdgeCount = readUint32(buffer, offset);
    offset += 4;
    const update3 = parseEdges(buffer, clientEdgeCount, offset);
    offset = update3.offset;
    clientEdges = update3.edges;

    // Parse server edges
    const serverEdgeCount = readUint32(buffer, offset);
    offset += 4;
    const update4 = parseEdges(buffer, serverEdgeCount, offset);
    offset = update4.offset;
    serverEdges = update4.edges;
  }

  // Helper to read 4-byte unsigned int
  function readUint32(buffer, offset) {
    return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16) | (buffer[offset + 3] << 24);
  }

  // Parse the files from the buffer
  function parseFiles(buffer, count, offset) {
    const files = [];

    for (let i = 0; i < count; i++) {
      const nameLength = readUint32(buffer, offset);
      offset += 4;

      // If the name length is 0, it's a deleted file
      if (nameLength === 0) {
        files.push({ id: i, deleted: true });
        continue;
      }

      const nameBytes = buffer.slice(offset, offset + nameLength);
      const name = new TextDecoder().decode(nameBytes);
      offset += nameLength;

      const isStale = buffer[offset++] === 1;
      const isServer = buffer[offset++] === 1;
      const isSSR = buffer[offset++] === 1;
      const isRoute = buffer[offset++] === 1;
      const isFramework = buffer[offset++] === 1;
      const isBoundary = buffer[offset++] === 1;

      files.push({
        id: i,
        name,
        isStale,
        isServer,
        isSSR,
        isRoute,
        isFramework,
        isBoundary,
      });
    }

    return { files, offset };
  }

  // Parse the edges from the buffer
  function parseEdges(buffer, count, offset) {
    const edges = [];
    for (let i = 0; i < count; i++) {
      const from = readUint32(buffer, offset);
      offset += 4;
      const to = readUint32(buffer, offset);
      offset += 4;
      edges.push({ from, to });
    }
    return { edges, offset };
  }

  decodeAndUpdate(buffer);

  // Reconstruct client files and edges with IDs starting at 0
  const idMap = new Map();
  const visited = new Set();
  const newClientFiles: typeof clientFiles = [];
  const newClientEdges: typeof clientEdges = [];

  // Helper function for graph traversal
  function dfs(nodeId, newId) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    // Map old ID to new ID
    idMap.set(nodeId, newId);

    // Add file with new ID
    const file = clientFiles[nodeId];
    newClientFiles.push({ ...file, id: newId });

    // Find all edges from this node
    for (const edge of clientEdges) {
      if (edge.from === nodeId) {
        if (!visited.has(edge.to)) {
          dfs(edge.to, newClientFiles.length);
        }
        // Add edge with new IDs
        newClientEdges.push({
          from: idMap.get(edge.from),
          to: idMap.get(edge.to) || edge.to!, // Handle case where target not yet processed
        });
      }
    }
  }

  // Start traversal from each unvisited node
  for (let i = 0; i < clientFiles.length; i++) {
    if (!visited.has(i)) {
      dfs(i, newClientFiles.length);
    }
  }

  // Replace original arrays with reconstructed ones
  clientFiles = newClientFiles;
  clientEdges = newClientEdges;

  // Sort edges for consistency
  clientEdges.sort((a, b) => {
    if (a.from !== b.from) {
      return a.from - b.from;
    }
    return a.to - b.to;
  });

  return {
    serverEdges,
    serverFiles,
    clientFiles,
    clientEdges,
  };
}

function decodeAndAppendServerError(r: DataViewReader) {
  const owner = r.u32();
  const file = r.string32() || null;

  const messageCount = r.u32();
  const messages = new Array(messageCount);
  for (let i = 0; i < messageCount; i++) {
    messages[i] = decodeSerializedError(r);
  }

  return { owner, file, messages };
}
