// Fetch spec: a network error rejects fetch() with a TypeError. Node (undici)
// rejects with TypeError("fetch failed") whose non-enumerable `cause` is the
// underlying error (an errno-style `code`, `syscall`, ...), and a body that
// fails after the headers arrived rejects with TypeError("terminated"). The
// ecosystem keys off that shape: is-network-error (under p-retry and ky) checks
// `name === "TypeError"` plus the message, and portable code reads
// `err.cause?.code`. Bun additionally mirrors `code` onto the TypeError so
// existing `err.code` checks keep working.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { once } from "node:events";
import net from "node:net";

function shape(e: any) {
  return {
    name: e?.name,
    isTypeError: e instanceof TypeError,
    message: e?.message,
    code: e?.code,
    causeIsEnumerable: e == null ? undefined : Object.getOwnPropertyDescriptor(e, "cause")?.enumerable,
    cause:
      e?.cause == null
        ? e?.cause
        : {
            name: e.cause.name,
            isError: e.cause instanceof Error,
            message: e.cause.message,
            code: e.cause.code,
            errno: e.cause.errno,
            syscall: e.cause.syscall,
            path: e.cause.path,
            hostname: e.cause.hostname,
          },
  };
}

async function rejectionOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("expected the promise to reject");
}

async function refusedPort() {
  const server = net.createServer();
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>(r => server.close(() => r()));
  return port;
}

// A raw TCP server; open sockets are destroyed on dispose so a failing
// assertion reports as such instead of hanging in server.close().
async function tcpServer(onConnection: (socket: net.Socket) => void) {
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    onConnection(socket);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    async [Symbol.asyncDispose]() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(r => server.close(() => r()));
    },
  };
}

// Inlined from sindresorhus/is-network-error v1.1.0 (MIT).
const networkErrorMessages = new Set([
  "network error",
  "Failed to fetch",
  "NetworkError when attempting to fetch resource.",
  "The Internet connection appears to be offline.",
  "Load failed",
  "Network request failed",
  "fetch failed",
  "terminated",
]);
const isNetworkError = (error: any) =>
  error instanceof Error && error.name === "TypeError" && networkErrorMessages.has(error.message);

describe("fetch network errors reject as TypeError('fetch failed') with a cause", () => {
  test("connection refused", async () => {
    const url = `http://127.0.0.1:${await refusedPort()}/`;
    const err = await rejectionOf(fetch(url));
    expect(shape(err)).toEqual({
      name: "TypeError",
      isTypeError: true,
      message: "fetch failed",
      code: "ECONNREFUSED",
      causeIsEnumerable: false,
      cause: {
        name: "Error",
        isError: true,
        message: expect.any(String),
        code: "ECONNREFUSED",
        errno: expect.any(Number),
        syscall: "connect",
        path: url,
        hostname: undefined,
      },
    });
    // libuv convention, as on node's own ECONNREFUSED errors.
    expect((err as any).cause.errno).toBeLessThan(0);
    expect(isNetworkError(err)).toBe(true);
  });

  test("socket closed before the response headers", async () => {
    await using server = await tcpServer(socket => socket.destroy());
    const err = await rejectionOf(fetch(server.url));
    expect(shape(err)).toEqual({
      name: "TypeError",
      isTypeError: true,
      message: "fetch failed",
      code: "ECONNRESET",
      causeIsEnumerable: false,
      cause: {
        name: "Error",
        isError: true,
        message: expect.any(String),
        code: "ECONNRESET",
        errno: expect.any(Number),
        syscall: undefined,
        path: server.url,
        hostname: undefined,
      },
    });
    expect((err as any).cause.errno).toBeLessThan(0);
  });

  test("malformed HTTP response keeps Bun's own code on both levels", async () => {
    await using server = await tcpServer(socket => socket.end("not http at all\r\n\r\n"));
    const err: any = await rejectionOf(fetch(server.url));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.message).toBe("fetch failed");
    expect(err.cause).toBeInstanceOf(Error);
    expect(err.cause.code).toEqual(expect.any(String));
    expect(err.code).toBe(err.cause.code);
  });

  test("body failing after the headers arrived rejects with 'terminated'", async () => {
    await using server = await tcpServer(socket => {
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 100000\r\n\r\n" + Buffer.alloc(1000, "x").toString());
    });
    const res = await fetch(server.url);
    expect(res.status).toBe(200);
    const err = await rejectionOf(res.text());
    expect(shape(err)).toEqual({
      name: "TypeError",
      isTypeError: true,
      message: "terminated",
      code: "ECONNRESET",
      causeIsEnumerable: false,
      cause: {
        name: "Error",
        isError: true,
        message: expect.any(String),
        code: "ECONNRESET",
        errno: expect.any(Number),
        syscall: undefined,
        path: server.url,
        hostname: undefined,
      },
    });
    expect(isNetworkError(err)).toBe(true);
  });

  test("the same error reaches a reader of the body stream", async () => {
    await using server = await tcpServer(socket => {
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 100000\r\n\r\n" + Buffer.alloc(1000, "x").toString());
    });
    const res = await fetch(server.url);
    const reader = res.body!.getReader();
    let err: any;
    try {
      while (!(await reader.read()).done) {}
    } catch (e) {
      err = e;
    }
    expect({ name: err?.name, message: err?.message, causeCode: err?.cause?.code }).toEqual({
      name: "TypeError",
      message: "terminated",
      causeCode: "ECONNRESET",
    });
  });

  test("DNS failure puts the resolver error on the cause", async () => {
    // A 64-character label violates RFC 1035, so the resolver rejects the name
    // locally on every platform without touching the network. Run in a child
    // with the proxy variables cleared so a configured proxy cannot take over
    // the lookup.
    const host = Buffer.alloc(64, "a").toString() + ".invalid";
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `fetch("http://" + process.env.BAD_HOST + "/").then(
           () => process.stdout.write("resolved"),
           e => process.stdout.write(JSON.stringify({
             name: e.name,
             message: e.message,
             code: e.code,
             cause: { code: e.cause?.code, syscall: e.cause?.syscall, hostname: e.cause?.hostname },
           })),
         );`,
      ],
      env: {
        ...bunEnv,
        BAD_HOST: host,
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        http_proxy: "",
        https_proxy: "",
        ALL_PROXY: "",
        all_proxy: "",
        NO_PROXY: "",
        no_proxy: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // The code depends on the resolver (ENOTFOUND, EAI_NONAME, ...); the
    // outer and inner codes must agree whatever it is.
    const out = JSON.parse(stdout);
    expect(out).toEqual({
      name: "TypeError",
      message: "fetch failed",
      code: out.cause.code,
      cause: { code: expect.any(String), syscall: "getaddrinfo", hostname: host },
    });
    expect(exitCode).toBe(0);
  });
});
