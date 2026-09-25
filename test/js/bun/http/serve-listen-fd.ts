// Shared by the `fd` tests in serve-listen.test.ts and node-http.test.ts.
import { bunEnv, bunExe, tempDir, tls as certificate } from "harness";
import { randomUUID } from "node:crypto";
import { renameSync } from "node:fs";
import { join } from "node:path";

export type InheritOptions = {
  /** The script that each child runs. It serves on descriptor LISTEN_FD. */
  fixture: string;
  /** What the parent binds: 127.0.0.1, 0.0.0.0, ::1, a unix path, or an abstract name (Linux only). */
  kind: "tcp" | "wildcard" | "tcp6" | "unix" | "abstract";
  tls?: boolean;
  /** The descriptor number in the child. 0 makes the socket the stdin of the child. */
  fd?: 0 | 3;
  /** More options for the server in the child, where `{dir}` is a fresh directory. */
  options?: Record<string, unknown>;
  /** More environment variables for the child. */
  env?: Record<string, string>;
  /** Arguments for bun, before the script. */
  args?: string[];
  /** The number of children that serve on the one socket. */
  children?: number;
};

const hosts = { tcp: "127.0.0.1", wildcard: "0.0.0.0", tcp6: "::1" };

/**
 * Binds a socket, as a supervisor does, and starts children that inherit it.
 * The parent closes its own copy, so only a child can accept on the socket.
 * Resolves when each child printed its first line.
 */
export async function inheritListener({
  fixture,
  kind,
  tls = false,
  fd = 3,
  options = {},
  env = {},
  args = [],
  children = 1,
}: InheritOptions) {
  const dir = tempDir("fd", {});
  const nonce = randomUUID();
  // `getsockname` in the child reports the path that the socket was bound to.
  const boundPath = kind === "abstract" ? "\0" + nonce : join(String(dir), "a.sock");
  const isTcp = kind === "tcp" || kind === "wildcard" || kind === "tcp6";

  const donor = Bun.listen({
    ...(isTcp ? { hostname: hosts[kind], port: 0 } : { unix: boundPath }),
    socket: {
      // Only a child may answer.
      open(socket) {
        socket.end("HTTP/1.1 500 Answered By The Parent\r\nContent-Length: 0\r\n\r\n");
      },
      data() {},
    },
  });
  const port = donor.port;
  // `stop()` of the donor unlinks the path that the donor bound. The socket
  // file moves away for that time, and then it comes back.
  const asidePath = join(String(dir), "b.sock");

  const stdio: any[] = ["ignore", "pipe", "inherit"];
  stdio[fd] = donor.fd;
  const spawned = Array.from({ length: children }, () => {
    const process = Bun.spawn({
      cmd: [bunExe(), ...args, fixture],
      env: {
        ...bunEnv,
        LISTEN_FD: String(fd),
        LISTEN_NONCE: nonce,
        LISTEN_TLS: tls ? JSON.stringify(certificate) : "",
        LISTEN_OPTIONS: JSON.stringify(options).replaceAll("{dir}", String(dir)),
        LISTEN_PATH: kind === "unix" ? boundPath : "",
        ...env,
      },
      stdio: stdio as any,
    });
    const reader = process.stdout.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    return {
      process,
      async line(): Promise<any> {
        while (!buffered.includes("\n")) {
          const { value, done } = await reader.read();
          if (done) throw new Error("the child exited. stdout: " + JSON.stringify(buffered));
          buffered += decoder.decode(value, { stream: true });
        }
        const end = buffered.indexOf("\n");
        const text = buffered.slice(0, end);
        buffered = buffered.slice(end + 1);
        return JSON.parse(text);
      },
    };
  });
  if (kind === "unix") renameSync(boundPath, asidePath);
  donor.stop(true);
  if (kind === "unix") renameSync(asidePath, boundPath);

  async function dispose() {
    for (const { process } of spawned) process.kill("SIGKILL");
    await Promise.all(spawned.map(({ process }) => process.exited));
    dir[Symbol.dispose]();
  }

  const scheme = tls ? "https" : "http";
  const host = kind === "tcp6" ? "[::1]" : "127.0.0.1";
  try {
    const ready = await Promise.all(spawned.map(child => child.line()));
    return {
      /** The first line of the first child. */
      ready: ready[0],
      /** The first line of each child. */
      allReady: ready,
      nonce,
      port,
      boundPath,
      dir: String(dir),
      /** One request on the address that the parent bound. */
      async request(pathname = "/") {
        const response = await fetch(
          isTcp ? `${scheme}://${host}:${port}${pathname}` : `${scheme}://localhost${pathname}`,
          {
            ...(isTcp ? {} : { unix: boundPath }),
            tls: { rejectUnauthorized: false },
          },
        );
        const body = await response.text();
        return { status: response.status, body: pathname === "/" ? body : JSON.parse(body) };
      },
      /** One message over a WebSocket. Resolves to the answer. */
      async echo(message: string) {
        const socket = new WebSocket(`ws://${host}:${port}/ws`);
        const { promise, resolve, reject } = Promise.withResolvers<string>();
        socket.onopen = () => socket.send(message);
        socket.onmessage = event => resolve(String(event.data));
        socket.onerror = socket.onclose = () => reject(new Error("the WebSocket closed"));
        try {
          return await promise;
        } finally {
          socket.close();
        }
      },
      /** Stops the server in a child. Resolves to the state of the descriptor and of the socket file. */
      async stop(child = 0): Promise<{ fd: string; unlinked?: boolean }> {
        // Not SIGTERM: the test runner ends the children of a test that timed out with it.
        spawned[child].process.kill("SIGHUP");
        const result = await spawned[child].line();
        await spawned[child].process.exited;
        return result;
      },
      /** Ends a child at once. */
      async kill(child: number) {
        spawned[child].process.kill("SIGKILL");
        await spawned[child].process.exited;
      },
      [Symbol.asyncDispose]: dispose,
    };
  } catch (e) {
    await dispose();
    throw e;
  }
}
