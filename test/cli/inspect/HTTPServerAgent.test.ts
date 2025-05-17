import { Subprocess, spawn } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "fs";
import { bunExe, bunEnv as env, isPosix, tmpdirSync } from "harness";
import { join } from "node:path";
import { InspectorSession, connect } from "./junit-reporter";
import { SocketFramer } from "./socket-framer";

const bunEnv = { ...env, NODE_ENV: "development" };

class HTTPServerInspectorSession extends InspectorSession {
  constructor() {
    super();
  }

  async enable(): Promise<void> {
    this.send("Inspector.enable");
    this.send("Console.enable");
    this.send("Runtime.enable");
    this.send("HTTPServer.enable");
  }

  async initialize(): Promise<void> {
    await this.send("Inspector.initialized");
  }

  async disable(): Promise<void> {
    await this.sendAndWait("HTTPServer.disable");
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

  startListening(serverId: number): Promise<any> {
    return this.sendAndWait("HTTPServer.startListening", { serverId });
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

describe.if(isPosix)("HTTPServer inspector protocol", () => {
  let serverProcess: Subprocess;
  let serverUrl: URL;
  let session: HTTPServerInspectorSession;
  let tempdir: string;
  let socketPath: string;
  let serverFilePath: string;

  const initialFile = /* js */ `
import html from "./index.html";
import { serve } from "bun";

var server = serve({
  port: 0, // Use a random available port
  development: true,
  routes: {
    "/html": html,
    "/": () => new Response("Home page"),
    "/api/users": () => Response.json([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" }
    ]),
    "/api/posts": () => Response.json([
      { id: 1, title: "Hello World" },
      { id: 2, title: "Test Post" }
    ]),
    "/stop": (req, server) => {
      console.log("Stopping server");
      server.stop();
      return new Response("Stopping server");
    },
  },
});
`;

  const updatedFile = /* js */ `
import html from "./index.html";
import { serve } from "bun";

var server = serve({
  port: 0, // Use a random available port
  development: true,
  routes: {
    "/html": html,
    "/": () => new Response("Home page"),
    "/api/users": () => Response.json([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" }
    ]),
    "/api/posts": () => Response.json([
      { id: 1, title: "Hello World" },
      { id: 2, title: "Test Post" }
    ]),
    "/api/posts/updated": () => Response.json([
      { id: 1, title: "Hello World Updated" },
      { id: 2, title: "Test Post Updated" }
    ]),
    "/stop": (req, server) => {
      console.log("Stopping server");
      server.stop();
    },
  },
});
`;

  beforeAll(async () => {
    tempdir = tmpdirSync("http-server-inspector-test");

    // Create a simple HTTP server for testing
    fs.writeFileSync(join(tempdir, "first.server.ts"), initialFile);
    fs.writeFileSync(join(tempdir, "second.server.ts"), updatedFile);
    fs.copyFileSync(join(tempdir, "first.server.ts"), (serverFilePath = join(tempdir, "server.ts")));
    fs.writeFileSync(join(tempdir, "index.html"), "<html><body>Hello World</body></html>");
    const cwd = process.cwd();
    process.chdir(tempdir);

    // Create socket for inspector protocol
    socketPath = `inspector-${Math.random().toString(36).substring(2)}.sock`;

    try {
      const socketPromise = connect(`unix://${socketPath}`);
      // Connect to the inspector socket using Unix domain socket
      session = new HTTPServerInspectorSession();

      // Start the server with inspector enabled (Unix socket only)
      serverProcess = spawn({
        cmd: [bunExe(), "--hot", `--inspect-wait=unix:${socketPath}`, join(tempdir, "server.ts")],
        env: {
          ...bunEnv,

          ASAN_OPTIONS: "detect_leaks=0:abort_on_error=0:sleep_before_dying=10000000",
          BUN_WAIT_FOR_DEBUGGER: "1",
        },
        cwd: tempdir,
        stdout: "inherit",
        stderr: "inherit",
      });

      const socket = await socketPromise;
      const framer = new SocketFramer((message: string) => {
        console.log(message);
        session.onMessage(message);
      });
      session.socket = socket;
      session.framer = framer;
      socket.data = {
        onData: framer.onData.bind(framer),
      };

      session.enable();
    } finally {
      if (serverProcess) {
        serverProcess.unref();
      }

      process.chdir(cwd);
    }
  });

  afterAll(() => {
    session?.disable().catch(() => {});
    serverProcess?.kill();

    if (tempdir) {
      fs.rmSync(tempdir, { recursive: true, force: true });
    }
  });

  test("should receive serverRoutesUpdated event with route information", async () => {
    const startEnabled = session.initialize();

    // Listen for the serverRoutesUpdated event
    const routesUpdatedPromise = session.waitForEvent("HTTPServer.serverRoutesUpdated");

    // Listen for the listen event
    const listenPromise = session.waitForEvent("HTTPServer.listen");

    await startEnabled;
    const { serverId, url, startTime } = await listenPromise;
    expect(serverId).toBeDefined();

    // Make a request to trigger route initialization if needed
    await fetch(new URL("/api/users", url).href).then(r => r.blob());

    // Verify we received the serverRoutesUpdated event
    const routesUpdatedEvent = await routesUpdatedPromise;

    const routes = routesUpdatedEvent.routes;
    for (const route of routes) {
      if (route.filePath) {
        route.filePath = route.filePath.replaceAll(tempdir, "");
      }
    }

    // Check for our defined routes
    expect(routes).toMatchInlineSnapshot(`
      [
        {
          "path": "/",
          "routeId": 0,
          "scriptLine": -1,
          "type": "api",
        },
        {
          "path": "/api/users",
          "routeId": 1,
          "scriptLine": -1,
          "type": "api",
        },
        {
          "path": "/api/posts",
          "routeId": 2,
          "scriptLine": -1,
          "type": "api",
        },
        {
          "path": "/stop",
          "routeId": 3,
          "scriptLine": -1,
          "type": "api",
        },
        {
          "filePath": "/index.html",
          "path": "/html",
          "routeId": 4,
          "scriptLine": -1,
          "type": "html",
        },
      ]
    `);

    const anotherRoutePromise = session.waitForEvent("HTTPServer.serverRoutesUpdated");
    fs.writeFileSync(serverFilePath, updatedFile);
    const anotherRouteEvent = await anotherRoutePromise;
    anotherRouteEvent.routes.forEach(route => {
      if (route.filePath) {
        route.filePath = route.filePath.replaceAll(tempdir, "");
      }
    });
    expect(anotherRouteEvent.routes).toMatchInlineSnapshot(`
      [
        {
          "path": "/",
          "routeId": 0,
          "scriptLine": -1,
          "type": "api",
        },
        {
          "path": "/api/users",
          "routeId": 1,
          "scriptLine": -1,
          "type": "api",
        },
        {
          "path": "/api/posts",
          "routeId": 2,
          "scriptLine": -1,
          "type": "api",
        },
        {
          "path": "/api/posts/updated",
          "routeId": 3,
          "scriptLine": -1,
          "type": "api",
        },
        {
          "path": "/stop",
          "routeId": 4,
          "scriptLine": -1,
          "type": "api",
        },
        {
          "filePath": "/index.html",
          "path": "/html",
          "routeId": 5,
          "scriptLine": -1,
          "type": "html",
        },
      ]
    `);

    const stopEventPromise = session.waitForEvent("HTTPServer.close");
    await fetch(new URL("/stop", url).href);

    const stopEvent = await stopEventPromise;
    stopEvent.timestamp = 123456;
    expect(stopEvent).toMatchInlineSnapshot(`
      {
        "serverId": 1,
        "timestamp": 123456,
      }
    `);
    console.log({ tempdir });
    expect(serverId).toBe(stopEvent.serverId);
  });
});
