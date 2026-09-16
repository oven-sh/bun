import type { Server, ServerWebSocket } from "bun";
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { connect as tcpConnect } from "node:net";
import { join } from "node:path";

type State = Bun.DurableObjectState;
type DOServer = Bun.DurableObjectServer;

const deadlineMs = 4000;

/** Polls `condition` until it is truthy. */
async function until<T>(condition: () => T, what: string, ms = deadlineMs): Promise<NonNullable<T>> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = condition();
    if (value) return value as NonNullable<T>;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}

type Closed = { code: number; reason: string; wasClean: boolean };

/** A WebSocket client that collects what it receives. */
function connect(server: Server<any>, path: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}${path}`);
  ws.binaryType = "arraybuffer";
  const messages: (string | ArrayBuffer)[] = [];
  let waiters: (() => void)[] = [];
  const wakeAll = () => {
    const woken = waiters;
    waiters = [];
    for (const wake of woken) wake();
  };
  let closedWith: Closed | undefined;
  ws.onmessage = event => {
    messages.push(event.data);
    wakeAll();
  };
  const opened = new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error(`WebSocket to ${path} failed`));
  });
  const closed = new Promise<Closed>(resolve => {
    ws.onclose = event => {
      closedWith = { code: event.code, reason: event.reason, wasClean: event.wasClean };
      resolve(closedWith);
      wakeAll();
    };
  });
  return {
    ws,
    messages,
    opened,
    closed,
    get closedWith() {
      return closedWith;
    },
    send: (data: string | ArrayBufferView | ArrayBuffer) => ws.send(data as string),
    /** Resolves when `n` messages have arrived in total. */
    async waitFor(n: number, ms = deadlineMs) {
      const deadline = Date.now() + ms;
      while (messages.length < n) {
        if (closedWith) throw new Error(`closed (${closedWith.code}) with ${messages.length} of ${n} messages`);
        const left = deadline - Date.now();
        if (left <= 0)
          throw new Error(`expected ${n} messages, got ${messages.length}: ${JSON.stringify(messages).slice(0, 300)}`);
        let timer: Timer | undefined;
        await new Promise<void>(resolve => {
          waiters.push(resolve);
          timer = setTimeout(resolve, left);
        });
        clearTimeout(timer);
      }
      return messages;
    },
    /** Sends `data` and waits for one more message. */
    async roundTrip(data: string) {
      const n = messages.length + 1;
      ws.send(data);
      await this.waitFor(n);
      return messages[n - 1];
    },
    async close(code = 1000, reason = "") {
      ws.close(code, reason);
      return await closed;
    },
  };
}

/** `Bun.serve` that routes `/<room>/...` to the object named `<room>`. */
function serve(ns: Bun.DurableObjectNamespace<any>) {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req, server) => ns.getByName(new URL(req.url).pathname.split("/")[1] || "lobby").fetch(req, server),
    error: (error: any) => new Response(`${error?.code}: ${error?.message}`, { status: 500 }),
    websocket: Bun.DurableObject.websocket,
  });
}

/** What the server answers to a WebSocket handshake, read from a plain TCP connection. */
function rawHandshake(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = tcpConnect(port, "127.0.0.1");
    let received = "";
    socket.on("connect", () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    socket.on("data", chunk => {
      received += chunk.toString("latin1");
      const end = received.indexOf("\r\n\r\n");
      if (end !== -1) {
        socket.destroy();
        resolve(received.slice(0, end));
      }
    });
    socket.on("error", reject);
    socket.on("close", () => reject(new Error("closed before the handshake was answered: " + received.slice(0, 200))));
  });
}

type Note = unknown[];
type RoomEnv = {
  notes: Note[];
  made: string[];
  /** Counts up while an instance is loaded (its interval is closed with its graph). */
  ticks?: { n: number };
  sockets?: Map<string, ServerWebSocket<any>>;
  /** Thrown by the next constructor, once. */
  failNextStart?: Error;
  /** What the next constructor's ctx.blockConcurrencyWhile() rejects with, once. */
  failNextBlock?: Error;
};

class Room extends Bun.DurableObject<RoomEnv> {
  constructor(ctx: State, env: RoomEnv) {
    super(ctx, env);
    env.made.push(ctx.id.name!);
    const failure = env.failNextStart;
    env.failNextStart = undefined;
    if (failure) throw failure;
    const blockFailure = env.failNextBlock;
    env.failNextBlock = undefined;
    // Ignoring the promise, as constructors do.
    if (blockFailure)
      ctx.blockConcurrencyWhile(async () => {
        await Bun.sleep(1);
        throw blockFailure;
      });
    if (env.ticks) setInterval(() => env.ticks!.n++, 1);
  }
  get room() {
    return this.ctx.id.name!;
  }
  async fetch(req: Request, server?: DOServer) {
    const url = new URL(req.url);
    const [, , action] = url.pathname.split("/");
    switch (action) {
      case "ws": {
        const who = url.searchParams.get("who") ?? "anonymous";
        const tags = url.searchParams.getAll("tag");
        const upgraded = server!.upgrade(req, {
          data: { who, count: 0 },
          tags: [who, ...tags],
          headers: { "X-Room": this.room, "X-Who": who },
        });
        this.env.notes.push(["upgrade", this.room, who, upgraded]);
        if (upgraded) return;
        return new Response("not a WebSocket request", { status: 426 });
      }
      case "server":
        return Response.json({
          hasServer: server !== undefined,
          requestIP: server?.requestIP(req) ?? null,
          port: server?.port ?? null,
          url: server ? String(server.url) : null,
          urlIsURL: server ? server.url instanceof URL : null,
          hostname: server?.hostname ?? null,
          development: server?.development ?? null,
          id: server?.id ?? null,
          subscribers: server?.subscriberCount("news") ?? null,
          timeout: server ? String(server.timeout(req, 30)) : null,
          address: server?.address ?? null,
          protocol: server?.protocol ?? null,
          pendingRequests: server?.pendingRequests ?? null,
          pendingWebSockets: server?.pendingWebSockets ?? null,
        });
      case "publish":
        return Response.json({ sent: server!.publish("news", "server says " + url.searchParams.get("text")) });
      case "bad-upgrade": {
        const attempts = {
          tagsNotArray: { tags: "admin" },
          tagNotString: { tags: ["ok", 1] },
          tagTooLong: { tags: ["x".repeat(257)] },
          tooManyTags: { tags: Array.from({ length: 11 }, (_, i) => `tag-${i}`) },
          optionsNotObject: "options",
        };
        const results: Record<string, unknown> = {};
        for (const [name, options] of Object.entries(attempts)) {
          try {
            results[name] = server!.upgrade(req, options as any);
          } catch (e: any) {
            results[name] = { name: e.name, code: e.code };
          }
        }
        return Response.json(results);
      }
      case "body":
        return new Response(`${req.method} ${url.pathname} ${await req.text()}`, { headers: { "x-room": this.room } });
      default:
        return new Response(`plain response from ${this.room}`, { status: 200 });
    }
  }
  webSocketOpen(ws: ServerWebSocket<any>) {
    this.env.sockets?.set(`${this.room}/${ws.data.who}`, ws);
    ws.subscribe("news");
    ws.send(`welcome ${ws.data.who} to ${this.room} (${this.ctx.getWebSockets().length} here)`);
  }
  async webSocketMessage(ws: ServerWebSocket<any>, message: string | Buffer) {
    ws.data.count++;
    if (typeof message !== "string") {
      this.env.notes.push(["binary", Buffer.isBuffer(message), message.length]);
      ws.send(Buffer.concat([Buffer.from([message.length]), message]));
      return;
    }
    const [command, ...rest] = message.split(" ");
    const text = rest.join(" ");
    switch (command) {
      case "say":
        for (const peer of this.ctx.getWebSockets()) peer.send(`${this.room}/${ws.data.who}: ${text}`);
        break;
      case "tagged":
        for (const peer of this.ctx.getWebSockets(rest[0]))
          peer.send(`[${rest[0]}] ${ws.data.who}: ${rest.slice(1).join(" ")}`);
        break;
      case "publish":
        // To the subscribers of the topic other than this socket.
        ws.publish("news", `${ws.data.who} says ${text}`);
        ws.send("published");
        break;
      case "state":
        ws.send(
          JSON.stringify({
            data: ws.data,
            tags: this.ctx.getTags(ws),
            sockets: this.ctx
              .getWebSockets()
              .map(peer => peer.data.who)
              .sort(),
            counts: this.ctx
              .getWebSockets()
              .map(peer => [peer.data.who, peer.data.count])
              .sort(),
            made: this.env.made.filter(name => name === this.room).length,
            autoResponse: this.ctx.getWebSocketAutoResponse(),
            autoResponseTimestamp: this.ctx.getWebSocketAutoResponseTimestamp(ws),
            autoResponseTimestampIsDate: this.ctx.getWebSocketAutoResponseTimestamp(ws) instanceof Date,
            stored: await this.ctx.storage.get("stored"),
          }),
        );
        break;
      case "store":
        await this.ctx.storage.put("stored", text);
        ws.send("stored");
        break;
      case "set":
        ws.data[rest[0]] = rest[1];
        ws.send("set");
        break;
      case "kick":
        for (const peer of this.ctx.getWebSockets(rest[0])) peer.close(4009, "kicked by " + ws.data.who);
        break;
      case "throw":
        throw new Error(`webSocketMessage failed in ${this.room}: ${text}`);
      case "abort":
        this.ctx.abort("the room was aborted");
      default:
        ws.send("echo " + message);
    }
  }
  webSocketClose(ws: ServerWebSocket<any>, code: number, reason: string, wasClean: boolean) {
    let tags: unknown;
    try {
      tags = this.ctx.getTags(ws);
    } catch (e: any) {
      tags = "getTags threw: " + e.message;
    }
    this.env.notes.push([
      "close",
      this.room,
      ws.data.who,
      code,
      reason,
      wasClean,
      tags,
      this.ctx
        .getWebSockets()
        .map(peer => peer.data.who)
        .sort(),
      ws.data.count,
    ]);
  }
  alarm() {
    for (const ws of this.ctx.getWebSockets()) ws.send(`alarm in ${this.room} for ${ws.data.who}`);
  }
  // RPC
  async setAlarmIn(ms: number) {
    await this.ctx.storage.setAlarm(Date.now() + ms);
  }
  announce(text: string, tag?: string) {
    const sockets = this.ctx.getWebSockets(tag);
    for (const ws of sockets) ws.send(`announcement: ${text}`);
    return sockets.length;
  }
  who(tag?: string) {
    return this.ctx
      .getWebSockets(tag)
      .map(ws => ws.data.who)
      .sort();
  }
  setAutoResponse(pair?: { request: string; response: string } | null) {
    this.ctx.setWebSocketAutoResponse(pair);
    return this.ctx.getWebSocketAutoResponse();
  }
  trySetAutoResponse(pair: unknown) {
    try {
      this.ctx.setWebSocketAutoResponse(pair as any);
    } catch (e: any) {
      return { name: e.name, code: e.code };
    }
    return this.ctx.getWebSocketAutoResponse();
  }
  getAutoResponse() {
    return this.ctx.getWebSocketAutoResponse();
  }
  autoResponseTimestamps() {
    return this.ctx
      .getWebSockets()
      .map(ws => [ws.data.who as string, this.ctx.getWebSocketAutoResponseTimestamp(ws)] as const)
      .sort(([a], [b]) => (a < b ? -1 : 1));
  }
  tryAccept(ws: unknown, tags?: unknown) {
    try {
      this.ctx.acceptWebSocket(ws as any, tags as any);
    } catch (e: any) {
      return { name: e.name, code: e.code, message: e.message };
    }
    return "accepted";
  }
  tryGetTags(ws: unknown) {
    try {
      return this.ctx.getTags(ws as any);
    } catch (e: any) {
      return { name: e.name, code: e.code };
    }
  }
  tryGetWebSockets(tag: unknown) {
    try {
      return this.ctx.getWebSockets(tag as any).length;
    } catch (e: any) {
      return { name: e.name, code: e.code };
    }
  }
  abort() {
    this.ctx.abort("the room was aborted");
  }
  graph() {
    return Bun.ModuleGraph.current;
  }
}

function open(options: Partial<Bun.DurableObjectNamespaceOptions<Room>> & { env?: Partial<RoomEnv> } = {}) {
  const env: RoomEnv = { notes: [], made: [], ...options.env };
  const errors: { error: any; id: Bun.DurableObjectId }[] = [];
  const ns = new Bun.DurableObjectNamespace<Room>({
    class: Room,
    onError: (error, id) => void errors.push({ error, id }),
    ...options,
    env,
  });
  return { ns, env, errors, notes: env.notes, made: env.made };
}

/** Waits until the (only) loaded instance has been evicted: its interval no longer runs. */
async function evicted(ticks: { n: number }) {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const before = ticks.n;
    await Bun.sleep(40);
    if (ticks.n === before) return;
    if (Date.now() > deadline) throw new Error("the object was not evicted");
  }
}

describe("Bun.DurableObject WebSockets", () => {
  test("server.upgrade() from inside the object: data, tags and response headers", async () => {
    const { ns, notes } = open();
    await using _ = ns;
    using server = serve(ns);

    const head = await rawHandshake(server.port!, "/lobby/ws?who=raw");
    const [status, ...headerLines] = head.split("\r\n");
    expect(status).toBe("HTTP/1.1 101 Switching Protocols");
    const headers = new Headers(headerLines.map(line => line.split(": ", 2) as [string, string]));
    expect(headers.get("x-room")).toBe("lobby");
    expect(headers.get("x-who")).toBe("raw");
    expect(headers.get("upgrade")?.toLowerCase()).toBe("websocket");
    await until(() => notes.some(note => note[0] === "close" && note[2] === "raw"), "the raw socket to close");

    const alice = connect(server, "/lobby/ws?who=alice&tag=admin&tag=admin&tag=early");
    await alice.opened;
    // webSocketOpen() can send.
    expect((await alice.waitFor(1))[0]).toBe("welcome alice to lobby (1 here)");
    expect(JSON.parse((await alice.roundTrip("state")) as string)).toMatchObject({
      data: { who: "alice", count: 1 },
      // Tags are kept in order, without duplicates.
      tags: ["alice", "admin", "early"],
      sockets: ["alice"],
    });
    expect(notes.filter(note => note[0] === "upgrade")).toEqual([
      ["upgrade", "lobby", "raw", true],
      ["upgrade", "lobby", "alice", true],
    ]);
    expect(await alice.close()).toMatchObject({ code: 1000 });
  });

  test("webSocketMessage: broadcast to ctx.getWebSockets(), tag filter, getTags", async () => {
    const { ns } = open();
    await using _ = ns;
    using server = serve(ns);
    const alice = connect(server, "/lobby/ws?who=alice&tag=admin");
    const bob = connect(server, "/lobby/ws?who=bob");
    const carol = connect(server, "/lobby/ws?who=carol&tag=admin");
    await Promise.all([alice.opened, bob.opened, carol.opened]);
    await Promise.all([alice.waitFor(1), bob.waitFor(1), carol.waitFor(1)]);

    const stub = ns.getByName("lobby");
    expect(await stub.who()).toEqual(["alice", "bob", "carol"]);
    expect(await stub.who("admin")).toEqual(["alice", "carol"]);
    expect(await stub.who("bob")).toEqual(["bob"]);
    expect(await stub.who("nobody")).toEqual([]);
    expect(await stub.who("")).toEqual([]);
    expect(await stub.tryGetWebSockets(1)).toEqual({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE" });

    bob.send("say hi all");
    await Promise.all([alice.waitFor(2), bob.waitFor(2), carol.waitFor(2)]);
    expect([alice.messages[1], bob.messages[1], carol.messages[1]]).toEqual([
      "lobby/bob: hi all",
      "lobby/bob: hi all",
      "lobby/bob: hi all",
    ]);

    bob.send("tagged admin for admins only");
    await Promise.all([alice.waitFor(3), carol.waitFor(3)]);
    expect([alice.messages[2], carol.messages[2]]).toEqual([
      "[admin] bob: for admins only",
      "[admin] bob: for admins only",
    ]);
    // bob has no "admin" tag: the next thing he gets is his own state.
    expect(JSON.parse((await bob.roundTrip("state")) as string)).toMatchObject({
      tags: ["bob"],
      sockets: ["alice", "bob", "carol"],
    });
    expect(bob.messages).toHaveLength(3);
    expect(JSON.parse((await carol.roundTrip("state")) as string)).toMatchObject({ tags: ["carol", "admin"] });

    // getTags() is about the sockets of this object.
    expect(await stub.tryGetTags({})).toEqual({ name: "TypeError", code: "ERR_INVALID_ARG_VALUE" });
    expect(await stub.tryGetTags(undefined)).toEqual({ name: "TypeError", code: "ERR_INVALID_ARG_VALUE" });

    await Promise.all([alice.close(), bob.close(), carol.close()]);
  });

  test("ws.data is the application's data: mutable, and kept from message to message", async () => {
    const { ns } = open();
    await using _ = ns;
    using server = serve(ns);
    const alice = connect(server, "/lobby/ws?who=alice");
    const bob = connect(server, "/lobby/ws?who=bob");
    await Promise.all([alice.opened, bob.opened]);
    await Promise.all([alice.waitFor(1), bob.waitFor(1)]);

    expect(await alice.roundTrip("set color green")).toBe("set");
    expect(await alice.roundTrip("echo 1")).toBe("echo echo 1");
    const state = JSON.parse((await alice.roundTrip("state")) as string);
    expect(state.data).toEqual({ who: "alice", count: 3, color: "green" });
    // What one socket's data holds is not another's.
    expect(state.counts).toEqual([
      ["alice", 3],
      ["bob", 0],
    ]);
    expect(JSON.parse((await bob.roundTrip("state")) as string).data).toEqual({ who: "bob", count: 1 });
    await Promise.all([alice.close(), bob.close()]);
  });

  test("binary messages arrive as a Buffer", async () => {
    const { ns, notes } = open();
    await using _ = ns;
    using server = serve(ns);
    const alice = connect(server, "/lobby/ws?who=alice");
    await alice.opened;
    await alice.waitFor(1);
    alice.send(new Uint8Array([9, 8, 7, 0, 255]));
    await alice.waitFor(2);
    expect(alice.messages[1]).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(alice.messages[1] as ArrayBuffer)]).toEqual([5, 9, 8, 7, 0, 255]);
    alice.send(new Uint8Array(0));
    await alice.waitFor(3);
    expect([...new Uint8Array(alice.messages[2] as ArrayBuffer)]).toEqual([0]);
    expect(notes.filter(note => note[0] === "binary")).toEqual([
      ["binary", true, 5],
      ["binary", true, 0],
    ]);
    await alice.close();
  });

  test("webSocketClose(ws, code, reason, wasClean): the client's code; the socket has left getWebSockets(); getTags(ws) still works", async () => {
    const { ns, notes } = open();
    await using _ = ns;
    using server = serve(ns);
    const alice = connect(server, "/lobby/ws?who=alice&tag=leaving");
    const bob = connect(server, "/lobby/ws?who=bob");
    await Promise.all([alice.opened, bob.opened]);
    await Promise.all([alice.waitFor(1), bob.waitFor(1)]);
    await alice.roundTrip("echo 1");

    expect(await alice.close(4001, "done here")).toEqual({ code: 4001, reason: "done here", wasClean: true });
    const closes = () => notes.filter(note => note[0] === "close");
    await until(() => closes().length === 1, "webSocketClose");
    expect(closes()).toEqual([["close", "lobby", "alice", 4001, "done here", true, ["alice", "leaving"], ["bob"], 1]]);
    expect(await ns.getByName("lobby").who()).toEqual(["bob"]);
    expect(await ns.getByName("lobby").who("leaving")).toEqual([]);

    // Closed by the object.
    const carol = connect(server, "/lobby/ws?who=carol&tag=unwanted");
    await carol.opened;
    await carol.waitFor(1);
    bob.send("kick unwanted");
    expect(await carol.closed).toEqual({ code: 4009, reason: "kicked by bob", wasClean: true });
    await until(() => closes().length === 2, "webSocketClose of the socket the object closed");
    expect(closes()[1]).toEqual([
      "close",
      "lobby",
      "carol",
      4009,
      "kicked by bob",
      true,
      ["carol", "unwanted"],
      ["bob"],
      0,
    ]);
    expect(bob.closedWith).toBeUndefined();

    // A connection that goes away without a close frame.
    bob.ws.terminate();
    await until(() => closes().length === 3, "webSocketClose of the terminated socket");
    expect(closes()[2]).toEqual(["close", "lobby", "bob", 1006, expect.any(String), false, ["bob"], [], 1]);
    expect(await ns.getByName("lobby").who()).toEqual([]);
  });

  test("requests that are not upgraded, server.upgrade() returning false, and the server's forwarders", async () => {
    const { ns, notes } = open();
    await using _ = ns;
    using server = serve(ns);

    const plain = await fetch(`${server.url}lobby/anything`);
    expect(await plain.text()).toBe("plain response from lobby");
    expect(plain.status).toBe(200);

    const posted = await fetch(`${server.url}kitchen/body`, { method: "POST", body: "soup" });
    expect(await posted.text()).toBe("POST /kitchen/body soup");
    expect(posted.headers.get("x-room")).toBe("kitchen");

    // Not a WebSocket handshake: upgrade() is false and the object answers itself.
    const refused = await fetch(`${server.url}lobby/ws?who=http`);
    expect(await refused.text()).toBe("not a WebSocket request");
    expect(refused.status).toBe(426);
    expect(notes).toEqual([["upgrade", "lobby", "http", false]]);
    expect(await ns.getByName("lobby").who()).toEqual([]);

    // Invalid options throw in the object, before anything is upgraded.
    expect(await (await fetch(`${server.url}lobby/bad-upgrade`)).json()).toEqual({
      tagsNotArray: { name: "TypeError", code: "ERR_INVALID_ARG_TYPE" },
      tagNotString: { name: "TypeError", code: "ERR_INVALID_ARG_TYPE" },
      tagTooLong: { name: "TypeError", code: "ERR_INVALID_ARG_VALUE" },
      tooManyTags: { name: "TypeError", code: "ERR_INVALID_ARG_VALUE" },
      optionsNotObject: { name: "TypeError", code: "ERR_INVALID_ARG_TYPE" },
    });
    expect(await ns.getByName("lobby").who()).toEqual([]);

    const info = await (await fetch(`${server.url}lobby/server`)).json();
    expect(info).toEqual({
      hasServer: true,
      requestIP: {
        address: expect.stringMatching(/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/),
        family: expect.stringMatching(/^IPv[46]$/),
        port: expect.any(Number),
      },
      port: server.port,
      url: String(server.url),
      urlIsURL: true,
      hostname: server.hostname,
      development: server.development,
      id: server.id,
      subscribers: 0,
      timeout: "undefined",
      address: server.address,
      protocol: "http",
      // This request.
      pendingRequests: 1,
      pendingWebSockets: 0,
    });
    expect(server.address).toEqual({ address: "127.0.0.1", family: "IPv4", port: server.port });
    // With a socket open.
    const alice = connect(server, "/lobby/ws?who=alice");
    await alice.opened;
    expect(await (await fetch(`${server.url}lobby/server`)).json()).toMatchObject({
      pendingRequests: 1,
      pendingWebSockets: 1,
    });
    await alice.close();
  });

  test("fetch() through the stub without a server: `server` is undefined", async () => {
    const { ns } = open();
    await using _ = ns;
    using server = serve(ns);
    const stub = ns.getByName("lobby");
    const withoutServer = {
      hasServer: false,
      requestIP: null,
      port: null,
      url: null,
      urlIsURL: null,
      hostname: null,
      development: null,
      id: null,
      subscribers: null,
      timeout: null,
      address: null,
      protocol: null,
      pendingRequests: null,
      pendingWebSockets: null,
    };
    expect(await (await stub.fetch(new Request("http://do/lobby/server")))!.json()).toEqual(withoutServer);
    expect(await (await stub.fetch("http://do/lobby/server"))!.json()).toEqual(withoutServer);
    expect(await (await stub.fetch(new URL("http://do/lobby/server")))!.json()).toEqual(withoutServer);
    expect(await (await stub.fetch("http://do/lobby/body", { method: "PUT", body: "x" }))!.text()).toBe(
      "PUT /lobby/body x",
    );
    // (input, init, server) and (request, server)
    expect(await (await stub.fetch("http://do/lobby/server", {}, server))!.json()).toMatchObject({
      hasServer: true,
      port: server.port,
    });
    expect(await (await stub.fetch(new Request("http://do/lobby/server"), server))!.json()).toMatchObject({
      hasServer: true,
      port: server.port,
    });
    // upgrade() of a request that did not come from the server is false.
    expect((await stub.fetch(new Request("http://do/lobby/ws"), server))!.status).toBe(426);
  });

  test("hibernation: sockets stay connected while the object is evicted; a message constructs a new instance that has them, with their data", async () => {
    const ticks = { n: 0 };
    const { ns, made, notes } = open({ idleTimeout: 20, env: { ticks } });
    await using _ = ns;
    using server = serve(ns);
    const alice = connect(server, "/lobby/ws?who=alice&tag=first");
    const bob = connect(server, "/lobby/ws?who=bob");
    await Promise.all([alice.opened, bob.opened]);
    await Promise.all([alice.waitFor(1), bob.waitFor(1)]);
    expect(await alice.roundTrip("set color green")).toBe("set");
    expect(await alice.roundTrip("store kept in storage")).toBe("stored");

    await evicted(ticks);
    let instances = made.length;
    expect(alice.closedWith).toBeUndefined();
    expect(bob.closedWith).toBeUndefined();
    expect(alice.ws.readyState).toBe(WebSocket.OPEN);
    expect(bob.ws.readyState).toBe(WebSocket.OPEN);
    expect(alice.messages).toHaveLength(3);
    expect(bob.messages).toHaveLength(1);

    const state = JSON.parse((await bob.roundTrip("state")) as string);
    // The message constructed a new instance.
    expect(made).toHaveLength(instances + 1);
    expect(state).toMatchObject({
      data: { who: "bob", count: 1 },
      tags: ["bob"],
      sockets: ["alice", "bob"],
      counts: [
        ["alice", 2],
        ["bob", 1],
      ],
      made: instances + 1,
      stored: "kept in storage",
    });
    expect(JSON.parse((await alice.roundTrip("state")) as string)).toMatchObject({
      data: { who: "alice", count: 3, color: "green" },
      tags: ["alice", "first"],
    });

    // A broadcast from the new instance reaches both.
    bob.send("say still here");
    await Promise.all([alice.waitFor(5), bob.waitFor(3)]);
    expect([alice.messages[4], bob.messages[2]]).toEqual(["lobby/bob: still here", "lobby/bob: still here"]);

    // Evicted again; this time it is a close that wakes it.
    await evicted(ticks);
    instances = made.length;
    expect(await alice.close(4002, "bye")).toMatchObject({ code: 4002 });
    await until(() => notes.some(note => note[0] === "close"), "webSocketClose");
    expect(made).toHaveLength(instances + 1);
    expect(notes.filter(note => note[0] === "close")).toEqual([
      ["close", "lobby", "alice", 4002, "bye", true, ["alice", "first"], ["bob"], 3],
    ]);
    expect(bob.closedWith).toBeUndefined();

    // A call through a stub wakes it as well, and it can send to the socket it did not see open.
    await evicted(ticks);
    instances = made.length;
    expect(await ns.getByName("lobby").announce("to whoever is left")).toBe(1);
    expect(made).toHaveLength(instances + 1);
    await bob.waitFor(4);
    expect(bob.messages[3]).toBe("announcement: to whoever is left");

    // The last socket leaves while the object is evicted.
    await evicted(ticks);
    expect(await bob.close(4005, "last")).toMatchObject({ code: 4005 });
    await until(() => notes.filter(note => note[0] === "close").length === 2, "the second webSocketClose");
    expect(notes.filter(note => note[0] === "close")[1]).toEqual([
      "close",
      "lobby",
      "bob",
      4005,
      "last",
      true,
      ["bob"],
      [],
      2,
    ]);
    expect(await ns.getByName("lobby").who()).toEqual([]);
  });

  test("an object that cannot be started for a message: onError gets what the constructor, or its blockConcurrencyWhile(), threw, and the sockets stay for the next message", async () => {
    const ticks = { n: 0 };
    const { ns, env, made, notes, errors } = open({ idleTimeout: 20, env: { ticks } });
    await using _ = ns;
    using server = serve(ns);
    const alice = connect(server, "/lobby/ws?who=alice");
    const bob = connect(server, "/lobby/ws?who=bob");
    const elsewhere = connect(server, "/garden/ws?who=carol");
    await Promise.all([alice.opened, bob.opened, elsewhere.opened]);
    await Promise.all([alice.waitFor(1), bob.waitFor(1), elsewhere.waitFor(1)]);
    await evicted(ticks);
    const instances = made.length;
    const failure = new Error("the constructor failed");
    env.failNextStart = failure;
    alice.send("say is anybody there");
    // Nobody is waiting for a message's handler: the namespace is told.
    await until(() => errors.length > 0, "onError");
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toBe(failure);
    expect(String(errors[0].id)).toBe(String(ns.idFromName("lobby")));
    expect(errors[0].id.name).toBe("lobby");
    expect(made).toEqual([...made.slice(0, instances), "lobby"]);
    // The message is gone and no handler ran, but nobody is disconnected: the next message starts the object.
    expect(alice.messages).toHaveLength(1);
    expect(bob.messages).toHaveLength(1);
    expect(notes.filter(note => note[0] === "close")).toEqual([]);
    expect(await bob.roundTrip("hello")).toBe("echo hello");
    expect(alice.closedWith).toBeUndefined();
    expect(bob.closedWith).toBeUndefined();
    expect(made).toEqual([...made.slice(0, instances), "lobby", "lobby"]);
    // Another object's are not.
    expect(await elsewhere.roundTrip("hello")).toBe("echo hello");
    expect(elsewhere.closedWith).toBeUndefined();
    // The next start is a start like any other.
    expect((await ns.getByName("lobby").who()).sort()).toEqual(["alice", "bob"]);
    const again = connect(server, "/lobby/ws?who=dave");
    await again.opened;
    expect((await again.waitFor(1))[0]).toBe("welcome dave to lobby (3 here)");
    expect(errors).toHaveLength(1);

    // The same when the constructor's blockConcurrencyWhile() is what fails, some time after the constructor returned.
    await evicted(ticks);
    const before = made.length;
    const received = { alice: alice.messages.length, bob: bob.messages.length, dave: again.messages.length };
    const blockFailure = new Error("could not load");
    env.failNextBlock = blockFailure;
    bob.send("say lost with the instance that could not load");
    await until(() => errors.length > 1, "onError for the failed blockConcurrencyWhile()");
    expect(errors).toHaveLength(2);
    expect(errors[1].error).toBe(blockFailure);
    expect(String(errors[1].id)).toBe(String(ns.idFromName("lobby")));
    expect(made).toEqual([...made.slice(0, before), "lobby"]);
    expect(await alice.roundTrip("still here")).toBe("echo still here");
    expect(made).toEqual([...made.slice(0, before), "lobby", "lobby"]);
    expect([alice.closedWith, bob.closedWith, again.closedWith]).toEqual([undefined, undefined, undefined]);
    expect((await ns.getByName("lobby").who()).sort()).toEqual(["alice", "bob", "dave"]);
    // Nobody got the message that was lost, and no webSocketClose() ran.
    expect({ alice: alice.messages.length - 1, bob: bob.messages.length, dave: again.messages.length }).toEqual(
      received,
    );
    expect(notes.filter(note => note[0] === "close")).toEqual([]);
    expect(errors).toHaveLength(2);
    await Promise.all([again.close(), elsewhere.close(), alice.close(), bob.close()]);
  });

  test("an alarm wakes an evicted object, which sends to its hibernated sockets", async () => {
    const ticks = { n: 0 };
    const { ns, made } = open({ idleTimeout: 20, env: { ticks } });
    await using _ = ns;
    using server = serve(ns);
    const alice = connect(server, "/lobby/ws?who=alice");
    const bob = connect(server, "/garden/ws?who=bob");
    await Promise.all([alice.opened, bob.opened]);
    await Promise.all([alice.waitFor(1), bob.waitFor(1)]);
    await ns.getByName("lobby").setAlarmIn(250);
    await evicted(ticks);
    const instances = made.filter(name => name === "lobby").length;
    await alice.waitFor(2);
    expect(alice.messages[1]).toBe("alarm in lobby for alice");
    expect(made.filter(name => name === "lobby")).toHaveLength(instances + 1);
    // The other room heard nothing.
    expect(await bob.roundTrip("echo x")).toBe("echo echo x");
    expect(bob.messages).toHaveLength(2);
    await Promise.all([alice.close(), bob.close()]);
  });

  test("pub/sub keeps working across eviction: ws.subscribe() in webSocketOpen, server.publish(), ws.publish()", async () => {
    const ticks = { n: 0 };
    const { ns, made } = open({ idleTimeout: 20, env: { ticks } });
    await using _ = ns;
    using server = serve(ns);
    const alice = connect(server, "/lobby/ws?who=alice");
    const bob = connect(server, "/lobby/ws?who=bob");
    await Promise.all([alice.opened, bob.opened]);
    await Promise.all([alice.waitFor(1), bob.waitFor(1)]);
    expect(server.subscriberCount("news")).toBe(2);

    // The `server` the object is given publishes to the same topics.
    expect(await (await fetch(`${server.url}lobby/publish?text=one`)).json()).toEqual({ sent: expect.any(Number) });
    await Promise.all([alice.waitFor(2), bob.waitFor(2)]);
    expect([alice.messages[1], bob.messages[1]]).toEqual(["server says one", "server says one"]);
    expect((await (await fetch(`${server.url}lobby/server`)).json()).subscribers).toBe(2);

    await evicted(ticks);
    const instances = made.length;
    expect(server.subscriberCount("news")).toBe(2);

    // The host publishes: nobody is woken.
    expect(server.publish("news", "host says two")).toBeGreaterThan(0);
    await Promise.all([alice.waitFor(3), bob.waitFor(3)]);
    expect([alice.messages[2], bob.messages[2]]).toEqual(["host says two", "host says two"]);
    expect(made).toHaveLength(instances);

    // ws.publish() from the woken instance reaches the other subscriber, not the sender.
    alice.send("publish three");
    await Promise.all([alice.waitFor(4), bob.waitFor(4)]);
    expect(alice.messages[3]).toBe("published");
    expect(bob.messages[3]).toBe("alice says three");
    expect(made).toHaveLength(instances + 1);

    await evicted(ticks);
    expect(await (await fetch(`${server.url}lobby/publish?text=four`)).json()).toEqual({ sent: expect.any(Number) });
    await Promise.all([alice.waitFor(5), bob.waitFor(5)]);
    expect([alice.messages[4], bob.messages[4]]).toEqual(["server says four", "server says four"]);
    await Promise.all([alice.close(), bob.close()]);
  });

  test("setWebSocketAutoResponse(): answered without constructing the evicted object", async () => {
    const ticks = { n: 0 };
    const { ns, made } = open({ idleTimeout: 20, env: { ticks } });
    await using _ = ns;
    using server = serve(ns);
    const stub = ns.getByName("lobby");
    const alice = connect(server, "/lobby/ws?who=alice");
    const bob = connect(server, "/lobby/ws?who=bob");
    await Promise.all([alice.opened, bob.opened]);
    await Promise.all([alice.waitFor(1), bob.waitFor(1)]);
    expect(await stub.getAutoResponse()).toBeNull();
    expect(await alice.roundTrip("ping")).toBe("echo ping");
    expect(await stub.setAutoResponse({ request: "ping", response: "pong" })).toEqual({
      request: "ping",
      response: "pong",
    });
    expect(await stub.autoResponseTimestamps()).toEqual([
      ["alice", null],
      ["bob", null],
    ]);

    await evicted(ticks);
    const madeBefore = made.length;
    const before = Date.now();
    expect(await alice.roundTrip("ping")).toBe("pong");
    expect(await alice.roundTrip("ping")).toBe("pong");
    expect(made).toHaveLength(madeBefore);
    // Only an exact match is answered.
    expect(await alice.roundTrip("ping ")).toBe("echo ping ");
    expect(made).toHaveLength(madeBefore + 1);

    const state = JSON.parse((await alice.roundTrip("state")) as string);
    // Auto-responses are not messages: webSocketMessage() saw the first "ping", "ping " and "state".
    expect(state.data.count).toBe(3);
    expect(state.autoResponse).toEqual({ request: "ping", response: "pong" });
    expect(state.autoResponseTimestampIsDate).toBe(true);
    expect(new Date(state.autoResponseTimestamp).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(state.autoResponseTimestamp).getTime()).toBeLessThanOrEqual(Date.now());
    const timestamps = new Map(await stub.autoResponseTimestamps());
    expect(timestamps.get("alice")).toBeInstanceOf(Date);
    expect(timestamps.get("bob")).toBeNull();

    // Binary messages are never auto-answered.
    alice.send(Buffer.from("ping"));
    await alice.waitFor(alice.messages.length + 1);
    expect(alice.messages.at(-1)).toBeInstanceOf(ArrayBuffer);

    // Replaced, then cleared with null and with undefined.
    expect(await stub.setAutoResponse({ request: "marco", response: "polo" })).toEqual({
      request: "marco",
      response: "polo",
    });
    expect(await bob.roundTrip("marco")).toBe("polo");
    expect(await bob.roundTrip("ping")).toBe("echo ping");
    expect(await stub.setAutoResponse(null)).toBeNull();
    expect(await bob.roundTrip("marco")).toBe("echo marco");
    expect(await stub.setAutoResponse({ request: "a", response: "b" })).toEqual({ request: "a", response: "b" });
    expect(await stub.setAutoResponse(undefined)).toBeNull();
    expect(await stub.setAutoResponse({ request: "a", response: "b" })).toEqual({ request: "a", response: "b" });
    expect(await stub.setAutoResponse()).toBeNull();
    expect(await bob.roundTrip("a")).toBe("echo a");

    await Promise.all([alice.close(), bob.close()]);
  });

  test("setWebSocketAutoResponse(): the pair is kept while an object that has no sockets yet is evicted", async () => {
    const ticks = { n: 0 };
    const { ns, made } = open({ idleTimeout: 20, env: { ticks } });
    await using _ = ns;
    using server = serve(ns);
    const stub = ns.getByName("lobby");
    expect(await stub.setAutoResponse({ request: "ping", response: "pong" })).toEqual({
      request: "ping",
      response: "pong",
    });
    await evicted(ticks);
    expect(made).toEqual(["lobby"]);
    expect(await stub.getAutoResponse()).toEqual({ request: "ping", response: "pong" });
    const alice = connect(server, "/lobby/ws?who=alice");
    await alice.opened;
    await alice.waitFor(1);
    expect(await alice.roundTrip("ping")).toBe("pong");
    await alice.close();
  });

  test("setWebSocketAutoResponse(): invalid arguments", async () => {
    const { ns } = open();
    await using _ = ns;
    const stub = ns.getByName("lobby");
    for (const pair of ["ping", 1, true, () => {}]) {
      expect(await stub.trySetAutoResponse(pair)).toEqual({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE" });
    }
    for (const pair of [
      {},
      { request: "ping" },
      { response: "pong" },
      { request: 1, response: "pong" },
      { request: "ping", response: 2 },
      { request: "ping", response: null },
    ]) {
      expect(await stub.trySetAutoResponse(pair)).toEqual({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE" });
    }
    expect(await stub.getAutoResponse()).toBeNull();
    // A failed call leaves the pair that was set.
    expect(await stub.setAutoResponse({ request: "ping", response: "pong" })).toEqual({
      request: "ping",
      response: "pong",
    });
    expect(await stub.trySetAutoResponse({ request: "ping" })).toEqual({
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
    });
    expect(await stub.getAutoResponse()).toEqual({ request: "ping", response: "pong" });
  });

  test("two rooms on one server do not see each other's sockets", async () => {
    const { ns } = open();
    await using _ = ns;
    using server = serve(ns);
    const alice = connect(server, "/kitchen/ws?who=alice&tag=shared");
    const bob = connect(server, "/garden/ws?who=bob&tag=shared");
    await Promise.all([alice.opened, bob.opened]);
    await Promise.all([alice.waitFor(1), bob.waitFor(1)]);
    expect(alice.messages[0]).toBe("welcome alice to kitchen (1 here)");
    expect(bob.messages[0]).toBe("welcome bob to garden (1 here)");
    expect(await ns.getByName("kitchen").who()).toEqual(["alice"]);
    expect(await ns.getByName("garden").who()).toEqual(["bob"]);
    expect(await ns.getByName("kitchen").who("shared")).toEqual(["alice"]);
    expect(await ns.getByName("hall").who()).toEqual([]);
    expect(await ns.getByName("kitchen").graph()).not.toBe(await ns.getByName("garden").graph());

    alice.send("say in the kitchen");
    await alice.waitFor(2);
    expect(alice.messages[1]).toBe("kitchen/alice: in the kitchen");
    // bob's next message is the answer to his own; nothing from the kitchen came before it.
    expect(await bob.roundTrip("echo x")).toBe("echo echo x");
    expect(bob.messages).toHaveLength(2);
    await Promise.all([alice.close(), bob.close()]);
  });

  test("20 clients in 4 rooms: every client receives exactly its room's messages", async () => {
    const { ns, made } = open();
    await using _ = ns;
    using server = serve(ns);
    const rooms = ["north", "south", "east", "west"];
    const clients = Array.from({ length: 20 }, (_, i) => {
      const room = rooms[i % 4];
      return { room, who: `c${i}`, client: connect(server, `/${room}/ws?who=c${i}`) };
    });
    await Promise.all(clients.map(({ client }) => client.opened));
    await Promise.all(clients.map(({ client }) => client.waitFor(1)));
    for (const { who, client } of clients) client.send(`say from ${who}`);
    // 1 welcome + 5 broadcasts
    await Promise.all(clients.map(({ client }) => client.waitFor(6)));
    // Anything misdelivered was sent before these answers.
    await Promise.all(clients.map(({ client }) => client.roundTrip("echo end")));
    for (const { room, client } of clients) {
      const expected = clients
        .filter(other => other.room === room)
        .map(other => `${room}/${other.who}: from ${other.who}`);
      expect(client.messages.slice(1, -1).sort()).toEqual(expected.sort());
      expect(client.messages.at(-1)).toBe("echo echo end");
      expect(client.messages).toHaveLength(7);
    }
    expect([...made].sort()).toEqual([...rooms].sort());
    for (const room of rooms) {
      expect(await ns.getByName(room).who()).toEqual(
        clients
          .filter(other => other.room === room)
          .map(other => other.who)
          .sort(),
      );
    }
    await Promise.all(clients.map(({ client }) => client.close()));
  });

  test("ctx.acceptWebSocket(): argument validation", async () => {
    const sockets = new Map<string, ServerWebSocket<any>>();
    const { ns, notes } = open({ env: { sockets } });
    await using _ = ns;
    using server = serve(ns);
    const stub = ns.getByName("lobby");
    for (const value of [
      undefined,
      null,
      {},
      "socket",
      1,
      new WebSocket(`ws://127.0.0.1:${server.port}/nowhere/plain`),
    ]) {
      expect(await stub.tryAccept(value)).toMatchObject({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE" });
      if (value instanceof WebSocket) value.close();
    }

    const alice = connect(server, "/lobby/ws?who=alice");
    await alice.opened;
    await alice.waitFor(1);
    const ws = sockets.get("lobby/alice")!;
    expect(ws).toBeDefined();
    // The socket is the lobby's: neither another object nor the lobby itself can accept it again.
    expect(await ns.getByName("other").tryAccept(ws)).toMatchObject({ name: "Error", code: "ERR_INVALID_STATE" });
    expect(await stub.tryAccept(ws, ["again"])).toMatchObject({ name: "Error", code: "ERR_INVALID_STATE" });
    expect(await ns.getByName("other").who()).toEqual([]);
    expect(await ns.getByName("other").tryGetTags(ws)).toEqual({ name: "TypeError", code: "ERR_INVALID_ARG_VALUE" });
    expect(await stub.tryGetTags(ws)).toEqual(["alice"]);

    await alice.close();
    await until(() => notes.some(note => note[0] === "close"), "webSocketClose");
    expect(ws.readyState).toBe(3);
    // A socket that has closed is nobody's to accept, and what the lobby knew about it is still there to read.
    const notOpen = { name: "Error", code: "ERR_INVALID_STATE", message: expect.stringContaining("not open") };
    expect(await ns.getByName("other").tryAccept(ws)).toMatchObject(notOpen);
    expect(await stub.tryAccept(ws)).toMatchObject(notOpen);
    expect(await ns.getByName("other").who()).toEqual([]);
    expect(await stub.who()).toEqual([]);
    expect(await stub.tryGetTags(ws)).toEqual(["alice"]);
    expect(await ns.getByName("other").tryGetTags(ws)).toEqual({ name: "TypeError", code: "ERR_INVALID_ARG_VALUE" });
  });

  test("ctx.acceptWebSocket(): a socket the host upgraded itself becomes the object's", async () => {
    const { ns, notes } = open();
    await using _ = ns;
    const accepted: unknown[] = [];
    const closedNotAccepted: string[] = [];
    // A server whose own sockets and Durable Objects' sockets live side by side.
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, server) {
        const url = new URL(req.url);
        if (server.upgrade(req, { data: { who: url.searchParams.get("who"), count: 0, room: url.pathname.slice(1) } }))
          return;
        return new Response("expected a WebSocket", { status: 426 });
      },
      websocket: {
        ...Bun.DurableObject.websocket,
        async open(ws: ServerWebSocket<any>) {
          if (ws.data.room === "host") return void ws.send("the host keeps this one");
          // Tags with a duplicate, and an invalid list first.
          accepted.push(await ns.getByName(ws.data.room).tryAccept(ws, "not-an-array"));
          accepted.push(await ns.getByName(ws.data.room).tryAccept(ws, [1]));
          accepted.push(await ns.getByName(ws.data.room).tryAccept(ws, ["x".repeat(257)]));
          accepted.push(
            await ns.getByName(ws.data.room).tryAccept(ws, ["host-upgraded", ws.data.who, "host-upgraded"]),
          );
          ws.send("accepted");
        },
        message(ws: ServerWebSocket<any>, message: string | Buffer) {
          if (ws.data.room === "host") return void ws.send("host echo " + message);
          return Bun.DurableObject.websocket.message!(ws, message);
        },
        close(ws: ServerWebSocket<any>, code: number, reason: string) {
          if (ws.data.room === "host") closedNotAccepted.push(ws.data.who);
          return Bun.DurableObject.websocket.close!(ws, code, reason);
        },
      },
    });

    const alice = connect(server, "/lobby?who=alice");
    const hosted = connect(server, "/host?who=harry");
    await Promise.all([alice.opened, hosted.opened]);
    await Promise.all([alice.waitFor(1), hosted.waitFor(1)]);
    expect(hosted.messages[0]).toBe("the host keeps this one");
    expect(alice.messages[0]).toBe("accepted");
    expect(accepted).toEqual([
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
      "accepted",
    ]);
    // No webSocketOpen() for a socket that was accepted: it was open already.
    expect(await ns.getByName("lobby").who()).toEqual(["alice"]);
    expect(await ns.getByName("lobby").who("host-upgraded")).toEqual(["alice"]);
    expect(await hosted.roundTrip("hello")).toBe("host echo hello");

    const state = JSON.parse((await alice.roundTrip("state")) as string);
    expect(state).toMatchObject({
      data: { who: "alice", count: 1, room: "lobby" },
      tags: ["host-upgraded", "alice"],
      sockets: ["alice"],
    });
    expect(await alice.close(4003, "ok")).toMatchObject({ code: 4003 });
    await until(() => notes.some(note => note[0] === "close"), "webSocketClose");
    expect(notes.filter(note => note[0] === "close")).toEqual([
      ["close", "lobby", "alice", 4003, "ok", true, ["host-upgraded", "alice"], [], 1],
    ]);
    await hosted.close();
    await until(() => closedNotAccepted.length === 1, "the host's own close handler");
    expect(closedNotAccepted).toEqual(["harry"]);
  });

  test("ctx.abort() closes the object's sockets with 1011; the next instance has none", async () => {
    const { ns, made, notes, errors } = open();
    await using _ = ns;
    using server = serve(ns);
    const alice = connect(server, "/lobby/ws?who=alice");
    const bob = connect(server, "/lobby/ws?who=bob");
    const carol = connect(server, "/garden/ws?who=carol");
    await Promise.all([alice.opened, bob.opened, carol.opened]);
    await Promise.all([alice.waitFor(1), bob.waitFor(1), carol.waitFor(1)]);

    const error = await ns
      .getByName("lobby")
      .abort()
      .then(
        () => undefined,
        e => e,
      );
    expect(error?.code).toBe("ERR_DURABLE_OBJECT_RESET");
    expect(await alice.closed).toMatchObject({ code: 1011 });
    expect(await bob.closed).toMatchObject({ code: 1011 });
    expect(await ns.getByName("lobby").who()).toEqual([]);
    expect(made.filter(name => name === "lobby")).toHaveLength(2);
    // Another object's sockets are not touched.
    expect(await carol.roundTrip("echo 1")).toBe("echo echo 1");
    expect(carol.closedWith).toBeUndefined();
    // Sockets that abort() closed get no webSocketClose().
    expect(notes.filter(note => note[0] === "close")).toEqual([]);
    expect(errors).toEqual([]);
    await carol.close();
  });

  test("ctx.abort() inside webSocketMessage() closes the sockets with 1011 and is nobody's uncaught error", async () => {
    const { ns, made, notes, errors } = open();
    await using _ = ns;
    using server = serve(ns);
    const carol = connect(server, "/garden/ws?who=carol");
    const dave = connect(server, "/garden/ws?who=dave");
    await Promise.all([carol.opened, dave.opened]);
    await Promise.all([carol.waitFor(1), dave.waitFor(1)]);
    dave.send("abort");
    expect(await dave.closed).toMatchObject({ code: 1011 });
    expect(await carol.closed).toMatchObject({ code: 1011 });
    expect(await ns.getByName("garden").who()).toEqual([]);
    expect(made).toEqual(["garden", "garden"]);
    expect(notes.filter(note => note[0] === "close")).toEqual([]);
    // The reset is what the handler asked for, not a failure of it.
    expect(errors.filter(({ error }) => error?.code !== "ERR_DURABLE_OBJECT_RESET")).toEqual([]);
  });

  test("ns.close() closes the sockets with 1001, those of evicted objects too", async () => {
    const ticks = { n: 0 };
    const { ns, made, notes } = open({ idleTimeout: 20, env: { ticks } });
    using server = serve(ns);
    const alice = connect(server, "/lobby/ws?who=alice");
    const bob = connect(server, "/garden/ws?who=bob");
    await Promise.all([alice.opened, bob.opened]);
    await Promise.all([alice.waitFor(1), bob.waitFor(1)]);
    await evicted(ticks);
    // The garden is loaded, the lobby is not.
    expect(await bob.roundTrip("echo x")).toBe("echo echo x");
    const instances = made.length;
    await ns.close();
    expect(made).toHaveLength(instances);
    expect(notes.filter(note => note[0] === "close")).toEqual([]);
    expect(await alice.closed).toMatchObject({ code: 1001 });
    expect(await bob.closed).toMatchObject({ code: 1001 });
    // Requests to a closed namespace fail; the server itself is still there.
    const response = await fetch(`${server.url}lobby/x`);
    expect(response.status).toBe(500);
    expect(await response.text()).toStartWith("ERR_INVALID_STATE");
  });

  test("on a server without `websocket: Bun.DurableObject.websocket`, server.upgrade() throws and the call rejects", async () => {
    const { ns, notes } = open();
    await using _ = ns;
    const failures: any[] = [];
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req, server) {
        try {
          return (await ns.getByName("lobby").fetch(req, server as any))!;
        } catch (e) {
          failures.push(e);
          return new Response("failed", { status: 500 });
        }
      },
    });
    const head = await rawHandshake(server.port!, "/lobby/ws?who=alice");
    expect(head.split("\r\n")[0]).toBe("HTTP/1.1 500 Internal Server Error");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toBeInstanceOf(Error);
    expect(failures[0].message).toMatch(/websocket/i);
    expect(notes).toEqual([]);
    // The object is fine.
    expect(await (await fetch(`${server.url}lobby/x`)).text()).toBe("plain response from lobby");
    expect(await ns.getByName("lobby").who()).toEqual([]);
  });

  test("errors thrown in webSocketMessage() go to onError with the object's id; the socket and the object go on", async () => {
    const { ns, errors, made } = open();
    await using _ = ns;
    using server = serve(ns);
    const alice = connect(server, "/lobby/ws?who=alice");
    const bob = connect(server, "/garden/ws?who=bob");
    await Promise.all([alice.opened, bob.opened]);
    await Promise.all([alice.waitFor(1), bob.waitFor(1)]);
    alice.send("throw first");
    bob.send("throw second");
    expect(await alice.roundTrip("echo after")).toBe("echo echo after");
    expect(await bob.roundTrip("echo after")).toBe("echo echo after");
    expect(errors).toHaveLength(2);
    const byRoom = new Map(errors.map(({ error, id }) => [id.name, { error, id }]));
    expect(byRoom.get("lobby")!.error).toBeInstanceOf(Error);
    expect(byRoom.get("lobby")!.error.message).toBe("webSocketMessage failed in lobby: first");
    expect(byRoom.get("lobby")!.id.equals(ns.idFromName("lobby"))).toBe(true);
    expect(byRoom.get("garden")!.error.message).toBe("webSocketMessage failed in garden: second");
    expect(String(byRoom.get("garden")!.id)).toBe(String(ns.idFromName("garden")));
    // Neither object was reset.
    expect([...made].sort()).toEqual(["garden", "lobby"]);
    expect(JSON.parse((await alice.roundTrip("state")) as string).data.count).toBe(3);
    await Promise.all([alice.close(), bob.close()]);
  });

  test("errors thrown in webSocketOpen() and webSocketClose() go to onError", async () => {
    const errors: [string, string | undefined][] = [];
    class Thrower extends Bun.DurableObject {
      fetch(req: Request, server: DOServer) {
        if (server.upgrade(req)) return;
        return new Response("no");
      }
      webSocketOpen(ws: ServerWebSocket<any>) {
        ws.send("data is " + ws.data);
        throw new Error("open failed");
      }
      async webSocketClose() {
        await Bun.sleep(1);
        throw new Error("close failed");
      }
    }
    await using ns = new Bun.DurableObjectNamespace({
      class: Thrower,
      onError: (error: any, id) => void errors.push([error.message, id.name]),
    });
    using server = serve(ns);
    const alice = connect(server, "/lobby/ws");
    await alice.opened;
    // upgrade() without options: ws.data is undefined.
    expect((await alice.waitFor(1))[0]).toBe("data is undefined");
    await alice.close();
    await until(() => errors.length === 2, "both errors");
    expect(errors).toEqual([
      ["open failed", "lobby"],
      ["close failed", "lobby"],
    ]);
  });

  test("messages sent in quick succession are delivered in order", async () => {
    const { ns } = open();
    await using _ = ns;
    using server = serve(ns);
    const alice = connect(server, "/lobby/ws?who=alice");
    await alice.opened;
    await alice.waitFor(1);
    const n = 200;
    for (let i = 0; i < n; i++) alice.send(`echo ${i}`);
    await alice.waitFor(n + 1);
    expect(alice.messages.slice(1)).toEqual(Array.from({ length: n }, (_, i) => `echo echo ${i}`));
    // Handlers that await storage in between are not interleaved either.
    for (let i = 0; i < 20; i++) alice.send(i % 2 ? `store ${i}` : `echo ${i}`);
    await alice.waitFor(n + 21);
    expect(alice.messages.slice(n + 1)).toEqual(
      Array.from({ length: 20 }, (_, i) => (i % 2 ? "stored" : `echo echo ${i}`)),
    );
    expect(JSON.parse((await alice.roundTrip("state")) as string)).toMatchObject({
      stored: "19",
      data: { count: n + 21 },
    });
    await alice.close();
  });

  test("module mode: messages that arrive while the object is starting are not lost", async () => {
    using dir = tempDir("do-websocket-module", {
      "slow-dependency.ts": `
        await Bun.sleep(30);
        export const ready = true;
      `,
      "room.ts": `
        import { ready } from "./slow-dependency.ts";
        let seen = 0; // module state: one per object, and gone with the instance
        export default class Room extends Bun.DurableObject {
          constructor(ctx, env) {
            super(ctx, env);
            env.made.push(ctx.id.name);
            setInterval(() => env.ticks.n++, 1);
          }
          fetch(req, server) {
            if (server.upgrade(req, { data: { received: [] } })) return;
            return new Response("no", { status: 426 });
          }
          webSocketOpen(ws) { ws.send("open " + ready); }
          async webSocketMessage(ws, message) {
            ws.data.received.push(message);
            await this.ctx.storage.put("last", message);
            ws.send(message + " #" + ++seen + ", " + ws.data.received.length + " on this socket");
          }
          webSocketClose(ws, code) { this.env.closed.push([code, ws.data.received.length]); }
        }
      `,
    });
    const ticks = { n: 0 };
    const made: string[] = [];
    const closed: unknown[] = [];
    await using ns = new Bun.DurableObjectNamespace({
      module: join(String(dir), "room.ts"),
      idleTimeout: 20,
      env: { made, ticks, closed },
    });
    using server = serve(ns);
    const alice = connect(server, "/lobby/ws");
    // Sent as soon as the connection is open, while nothing says the object has finished starting.
    alice.ws.addEventListener("open", () => {
      for (let i = 0; i < 5; i++) alice.send(`early-${i}`);
    });
    await alice.waitFor(6);
    // "#n" counts in module state, which starts over with every instance; "on this socket" is ws.data's.
    const withoutModuleState = (message: string | ArrayBuffer) => String(message).replace(/ #\d+,/, ",");
    expect(alice.messages.map(withoutModuleState)).toEqual([
      "open true",
      ...Array.from({ length: 5 }, (_, i) => `early-${i}, ${i + 1} on this socket`),
    ]);

    await evicted(ticks);
    const instances = made.length;
    // A burst at an evicted object: the first message starts it (an asynchronous import), the rest wait for it.
    for (let i = 0; i < 20; i++) alice.send(`late-${i}`);
    await alice.waitFor(26);
    expect(made.length).toBeGreaterThan(instances);
    expect(alice.messages.slice(6).map(withoutModuleState)).toEqual(
      Array.from({ length: 20 }, (_, i) => `late-${i}, ${i + 6} on this socket`),
    );
    // The first of them was the first message its instance saw.
    expect(alice.messages[6]).toBe("late-0 #1, 6 on this socket");
    await alice.close(4004);
    await until(() => closed.length === 1, "webSocketClose");
    expect(closed).toEqual([[4004, 25]]);
  });
});
