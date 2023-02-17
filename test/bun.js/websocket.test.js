import { describe, it, expect } from "bun:test";
import { unsafe, spawn, readableStreamToText } from "bun";
import { bunExe } from "bunExe";

import { gc } from "./gc";
import { bunEnv } from "bunEnv";

const TEST_WEBSOCKET_HOST = process.env.TEST_WEBSOCKET_HOST || "wss://ws.postman-echo.com/raw";

describe("WebSocket", () => {
  it("should connect", async () => {
    const ws = new WebSocket(TEST_WEBSOCKET_HOST);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    var closed = new Promise((resolve, reject) => {
      ws.onclose = resolve;
    });
    ws.close();
    await closed;
  });

  it("should connect over https", async () => {
    const ws = new WebSocket(TEST_WEBSOCKET_HOST.replaceAll("wss:", "https:"));
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    var closed = new Promise((resolve, reject) => {
      ws.onclose = resolve;
    });
    ws.close();
    await closed;
  });

  it("supports headers", done => {
    const server = Bun.serve({
      port: 8024,
      fetch(req, server) {
        expect(req.headers.get("X-Hello")).toBe("World");
        expect(req.headers.get("content-type")).toBe("lolwut");
        server.stop();
        done();
        return new Response();
      },
      websocket: {
        open(ws) {
          ws.close();
        },
      },
    });
    const ws = new WebSocket(`ws://${server.hostname}:${server.port}`, {
      headers: {
        "X-Hello": "World",
        "content-type": "lolwut",
      },
    });
  });

  it("should connect over http", done => {
    const server = Bun.serve({
      port: 8025,
      fetch(req, server) {
        server.stop();
        done();
        return new Response();
      },
      websocket: {
        open(ws) {
          ws.close();
        },
      },
    });
    const ws = new WebSocket(`http://${server.hostname}:${server.port}`, {});
  });

  it("should send and receive messages", async () => {
    const ws = new WebSocket(TEST_WEBSOCKET_HOST);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
      ws.onclose = () => {
        reject("WebSocket closed");
      };
    });
    const count = 10;

    // 10 messages in burst
    var promise = new Promise((resolve, reject) => {
      var remain = count;
      ws.onmessage = event => {
        gc(true);
        expect(event.data).toBe("Hello World!");
        remain--;

        if (remain <= 0) {
          ws.onmessage = () => {};
          resolve();
        }
      };
      ws.onerror = reject;
    });

    for (let i = 0; i < count; i++) {
      ws.send("Hello World!");
      gc(true);
    }

    await promise;
    var echo = 0;

    // 10 messages one at a time
    function waitForEcho() {
      return new Promise((resolve, reject) => {
        gc(true);
        const msg = `Hello World! ${echo++}`;
        ws.onmessage = event => {
          expect(event.data).toBe(msg);
          resolve();
        };
        ws.onerror = reject;
        ws.onclose = reject;
        ws.send(msg);
        gc(true);
      });
    }
    gc(true);
    for (let i = 0; i < count; i++) await waitForEcho();
    ws.onclose = () => {};
    ws.onerror = () => {};
    ws.close();
    gc(true);
  });
});

describe("websocket in subprocess", () => {
  var port = 8765;
  it("should exit", async () => {
    let messageReceived = false;
    const server = Bun.serve({
      port: port++,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }

        return new Response("http response");
      },
      websocket: {
        open(ws) {
          ws.send("hello websocket");
        },
        message(ws) {
          messageReceived = true;
          ws.close();
        },
        close(ws) {},
      },
    });
    const subprocess = Bun.spawn({
      cmd: [bunExe(), import.meta.dir + "/websocket-subprocess.ts", `http://${server.hostname}:${server.port}`],
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
      env: bunEnv,
    });

    expect(await subprocess.exited).toBe(0);
    expect(messageReceived).toBe(true);
    server.stop(true);
  });

  it("should exit after killed", async () => {
    const subprocess = Bun.spawn({
      cmd: [bunExe(), import.meta.dir + "/websocket-subprocess.ts", TEST_WEBSOCKET_HOST],
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
      env: bunEnv,
    });

    subprocess.kill();

    expect(await subprocess.exited).toBe("SIGHUP");
  });

  it("should exit with invalid url", async () => {
    const subprocess = Bun.spawn({
      cmd: [bunExe(), import.meta.dir + "/websocket-subprocess.ts", "invalid url"],
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
      env: bunEnv,
    });

    expect(await subprocess.exited).toBe(1);
  });

  it("should exit after timeout", async () => {
    let messageReceived = false;
    let start = 0;
    const server = Bun.serve({
      port: port++,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }

        return new Response("http response");
      },
      websocket: {
        open(ws) {
          start = performance.now();
          ws.send("timeout");
        },
        message(ws, message) {
          messageReceived = true;
          expect(performance.now() - start >= 300).toBe(true);
          ws.close();
        },
        close(ws) {},
      },
    });
    const subprocess = Bun.spawn({
      cmd: [bunExe(), import.meta.dir + "/websocket-subprocess.ts", `http://${server.hostname}:${server.port}`],
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
      env: bunEnv,
    });

    expect(await subprocess.exited).toBe(0);
    expect(messageReceived).toBe(true);
    server.stop(true);
  });

  it("should exit after server stop and 0 messages", async () => {
    const server = Bun.serve({
      port: port++,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }

        return new Response("http response");
      },
      websocket: {
        open(ws) {},
        message(ws, message) {},
        close(ws) {},
      },
    });

    const subprocess = Bun.spawn({
      cmd: [bunExe(), import.meta.dir + "/websocket-subprocess.ts", `http://${server.hostname}:${server.port}`],
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
      env: bunEnv,
    });

    server.stop(true);
    expect(await subprocess.exited).toBe(0);
  });
});
