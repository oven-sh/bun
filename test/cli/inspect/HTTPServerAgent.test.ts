import { Subprocess, spawn } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv as env, bunExe, isPosix, tmpdirSync } from "harness";
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

  beforeAll(async () => {
    tempdir = tmpdirSync("http-server-inspector-test");

    // Create a simple HTTP server for testing
    fs.writeFileSync(
      join(tempdir, "server.ts"),
      /* js */ `
      import { serve } from "bun";

      const server = serve({
        port: 0, // Use a random available port
        development: true,
        routes: {
          "/": () => new Response("Home page"),
          "/api/users": () => Response.json([
            { id: 1, name: "Alice" },
            { id: 2, name: "Bob" }
          ]),
          "/api/posts": () => Response.json([
            { id: 1, title: "Hello World" },
            { id: 2, title: "Test Post" }
          ]),
        },
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
      // Connect to the inspector socket using Unix domain socket
      session = new HTTPServerInspectorSession();

      // Start the server with inspector enabled (Unix socket only)
      serverProcess = spawn({
        cmd: [bunExe(), "--hot", `--inspect-wait=unix:${socketPath}`, join(tempdir, "server.ts")],
        env: bunEnv,
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

  test.only("should receive listen event when server starts", async () => {
    // Enable the HTTPServer domain
    const startEnabled = session.initialize();

    // Listen for the listen event
    const listenPromise = session.waitForEvent("HTTPServer.listen");

    await startEnabled;
    const { serverId, url, startTime } = await listenPromise;
    expect(serverId).toBeDefined();
    expect(typeof serverId).toBe("number");
    expect(url).toBeDefined();
    expect(typeof url).toBe("string");
    expect(startTime).toBeDefined();
    expect(typeof startTime).toBe("number");

    expect(await fetch(url).then(r => r.text())).toBe("Home page");
  });

  test("should receive serverRoutesUpdated event with route information", async () => {
    // Listen for the serverRoutesUpdated event
    const routesUpdatedPromise = session.waitForEvent("HTTPServer.serverRoutesUpdated");

    // Make a request to trigger route initialization if needed
    await fetch(new URL("/api/users", serverUrl).href);

    // Verify we received the serverRoutesUpdated event
    const routesUpdatedEvent = await routesUpdatedPromise;
    expect(routesUpdatedEvent).toHaveProperty("serverId");
    expect(routesUpdatedEvent).toHaveProperty("hotReloadId");
    expect(routesUpdatedEvent).toHaveProperty("routes");
    expect(Array.isArray(routesUpdatedEvent.routes)).toBe(true);

    // Inspect the routes
    const routes = routesUpdatedEvent.routes;

    // Check for our defined routes
    expect(routes.some(route => route.path.includes("/"))).toBe(true);
    expect(routes.some(route => route.path.includes("/api/users"))).toBe(true);
    expect(routes.some(route => route.path.includes("/api/posts"))).toBe(true);

    // Each route should have necessary properties
    routes.forEach(route => {
      expect(route).toHaveProperty("routeId");
      expect(route).toHaveProperty("path");
      expect(route).toHaveProperty("type");
    });
  });

  test("should update routes when server routes change", async () => {
    // Create an updated server file with new routes
    fs.writeFileSync(
      join(tempdir, "server.ts"),
      /* js */ `
      import { serve } from "bun";

      const server = serve({
        port: ${serverUrl.port}, // Use same port to ensure we're updating the same server
        development: true,
        fetch(req) {
          const url = new URL(req.url);
          
          if (url.pathname === "/") {
            return new Response("Home page");
          }
          
          if (url.pathname === "/api/users") {
            return Response.json([
              { id: 1, name: "Alice" },
              { id: 2, name: "Bob" }
            ]);
          }
          
          if (url.pathname === "/api/posts") {
            return Response.json([
              { id: 1, title: "Hello World" },
              { id: 2, title: "Test Post" }
            ]);
          }
          
          // New route added
          if (url.pathname === "/api/comments") {
            return Response.json([
              { id: 1, text: "Great post!" },
              { id: 2, text: "Thanks for sharing" }
            ]);
          }
          
          return new Response("Not Found", { status: 404 });
        }
      });

      console.log("Server listening at " + server.url);
      `,
    );

    // Listen for the serverRoutesUpdated event
    const routesUpdatedPromise = session.waitForEvent("HTTPServer.serverRoutesUpdated");

    // Trigger a reload by making a request to the new route
    await fetch(new URL("/api/comments", serverUrl).href);

    // Verify we received the serverRoutesUpdated event again
    const routesUpdatedEvent = await routesUpdatedPromise;
    expect(routesUpdatedEvent).toHaveProperty("routes");

    // The routes array should now include our new route
    const routes = routesUpdatedEvent.routes;
    expect(routes.some(route => route.path.includes("/api/comments"))).toBe(true);
  });

  test("should receive close event when server stops", async () => {
    // Get server ID from a request
    const listenEvent = await session.waitForEvent("HTTPServer.listen");
    const serverId = listenEvent.serverInfo.serverId;

    // Listen for the close event
    const closePromise = session.waitForEvent("HTTPServer.close");

    // Create a new server file that will intentionally close the server
    fs.writeFileSync(
      join(tempdir, "stop-server.ts"),
      /* js */ `
      import { serve } from "bun";

      const server = serve({
        port: ${serverUrl.port}, // Use same port to trigger a conflict
        development: true,
        fetch() {
          return new Response("New server");
        }
      });

      // This will trigger close on the original server
      console.log("New server listening at " + server.url);
      `,
    );

    // Start the new server to force the old one to close
    const newServerProcess = spawn({
      cmd: [bunExe(), join(tempdir, "stop-server.ts")],
      env: bunEnv,
      cwd: tempdir,
      stdout: "pipe",
      stderr: "inherit",
    });

    try {
      // Verify we received the close event
      const closeEvent = await closePromise;
      expect(closeEvent).toHaveProperty("serverId");
      expect(closeEvent).toHaveProperty("timestamp");
      expect(typeof closeEvent.timestamp).toBe("number");

      // The stopped server ID should match our original server
      expect(closeEvent.serverId).toBe(serverId);
    } finally {
      // Cleanup
      newServerProcess.kill();
    }
  });

  test("should track multiple servers with unique IDs", async () => {
    // Create a second server file with a different port
    fs.writeFileSync(
      join(tempdir, "second-server.ts"),
      /* js */ `
      import { serve } from "bun";

      const server = serve({
        port: 0, // Use a different port
        development: true,
        fetch() {
          return new Response("Second server");
        }
      });

      console.log("Second server listening at " + server.url);
      `,
    );

    // Listen for the listen event for the second server
    const listenPromise = session.waitForEvent("HTTPServer.listen");

    // Start the second server
    const secondServerProcess = spawn({
      cmd: [bunExe(), join(tempdir, "second-server.ts")],
      env: bunEnv,
      cwd: tempdir,
      stdout: "pipe",
    });

    try {
      // Verify we received the listen event for the second server
      const listenEvent = await listenPromise;
      expect(listenEvent).toHaveProperty("serverInfo");

      // Make sure this is a different server ID from the first one
      const serverId = listenEvent.serverInfo.serverId;
      expect(serverId).not.toBe(undefined);

      // Start listening to the second server
      await session.startListening(serverId);

      // Listen for routesUpdated for this server
      const routesUpdatedPromise = session.waitForEvent("HTTPServer.serverRoutesUpdated");

      // Wait for routes to be updated
      const routesUpdatedEvent = await routesUpdatedPromise;
      expect(routesUpdatedEvent).toHaveProperty("serverId");
      expect(routesUpdatedEvent.serverId).toBe(serverId);

      // Finally, listen for close when we kill this process
      const closePromise = session.waitForEvent("HTTPServer.close");

      // Kill the second server
      secondServerProcess.kill();

      // Verify we get the close event with the right ID
      const closeEvent = await closePromise;
      expect(closeEvent).toHaveProperty("serverId");
      expect(closeEvent.serverId).toBe(serverId);
    } finally {
      secondServerProcess.kill();
    }
  });
});
