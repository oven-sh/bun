// Inspector frontends for tests that attach more than one client to one process.
import { spawn, type Socket, type Subprocess } from "bun";
import { bunEnv, bunExe } from "harness";
import { SocketFramer } from "./socket-framer";

export type InspectorMessage = { id?: number | null; method?: string; result?: any; error?: any; params?: any };

/** The value a response carries: the value of a primitive, the description of an object, or the error code. */
export function valueOf({ result, error }: InspectorMessage): unknown {
  if (error) return `error ${error.code}`;
  const remote = result?.result;
  return remote ? (remote.value ?? remote.description ?? remote.type) : JSON.stringify(result);
}

/**
 * One attached frontend. It keeps every message it receives, in arrival order.
 * It numbers its commands from 1, as a real frontend does, so two clients use the same ids.
 */
export class InspectorClient {
  readonly received: InspectorMessage[] = [];
  #settled = new Set<InspectorMessage>();
  #nextId = 1;
  #waiters: (() => void)[] = [];
  #failure: Error | undefined;

  constructor(
    readonly name: string,
    readonly sendRaw: (text: string) => void,
    /** Closes the connection. Resolves when the inspectee has closed it too. */
    readonly close: () => Promise<void>,
  ) {}

  deliver(text: string): void {
    this.received.push(JSON.parse(text));
    for (const waiter of this.#waiters.splice(0)) waiter();
  }

  fail(error: Error): void {
    this.#failure ??= error;
    for (const waiter of this.#waiters.splice(0)) waiter();
  }

  /** Sends a command and returns its id. It does not wait for the response. */
  send(method: string, params?: object): number {
    const id = this.#nextId++;
    this.sendRaw(JSON.stringify({ id, method, params }));
    return id;
  }

  /** The first message at index `from` or later that matches. Rejects when the connection is gone. */
  async waitFor(match: (message: InspectorMessage) => boolean, from = 0): Promise<InspectorMessage> {
    for (let index = from; ; index++) {
      while (index >= this.received.length) {
        if (this.#failure) throw this.#failure;
        await new Promise<void>(resolve => this.#waiters.push(resolve));
      }
      if (match(this.received[index])) return this.received[index];
    }
  }

  /** Sends a command and returns the first response that has its id, as a real frontend does. */
  call(method: string, params?: object): Promise<InspectorMessage> {
    const from = this.received.length;
    const id = this.send(method, params);
    return this.waitFor(message => message.id === id, from);
  }

  /** Runtime.evaluate, then `valueOf()` the response. */
  async evaluate(expression: string, params?: object): Promise<unknown> {
    return valueOf(await this.call("Runtime.evaluate", { expression, ...params }));
  }

  /**
   * A round trip on this client. The inspectee sends the responses and the events for one
   * client through one ordered queue. So when this returns, every message that the inspected
   * thread sent to this client before it ran this command has arrived. Use it in place of a
   * sleep before an assertion that a message did not arrive.
   */
  async settle(): Promise<void> {
    const from = this.received.length;
    const token = `settled:${this.name}:${this.#nextId}`;
    this.send("Runtime.evaluate", { expression: JSON.stringify(token) });
    this.#settled.add(await this.waitFor(message => message.result?.result?.value === token, from));
  }

  /** Every response received so far, in arrival order, as "id:value". No events, and not the responses to settle(). */
  responses(): string[] {
    return this.received
      .filter(message => "id" in message && !this.#settled.has(message))
      .map(message => `${message.id}:${valueOf(message)}`);
  }
}

const prelude = `
const { readSync, writeSync } = require("node:fs");
// Blocks the inspected thread until the test calls release().
globalThis.hold = () => {
  writeSync(2, "HOLDING\\n");
  readSync(0, Buffer.alloc(1));
  return "released";
};
`;

/** A `bun` process with an inspector server that accepts WebSocket clients. */
export class Inspectee implements AsyncDisposable {
  url = "";
  #stderr = "";
  #stderrCursor = 0;
  #stderrEnded = false;
  #stderrWaiters: (() => void)[] = [];
  #sockets: WebSocket[] = [];

  constructor(readonly process: Subprocess<"pipe", "ignore", "pipe">) {
    (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of process.stderr) {
        this.#stderr += decoder.decode(chunk, { stream: true });
        for (const waiter of this.#stderrWaiters.splice(0)) waiter();
      }
      this.#stderrEnded = true;
      for (const waiter of this.#stderrWaiters.splice(0)) waiter();
    })();
  }

  /** The next match in stderr after the match of the previous call. */
  async stderr(pattern: RegExp): Promise<RegExpExecArray> {
    for (;;) {
      const match = pattern.exec(this.#stderr.slice(this.#stderrCursor));
      if (match) {
        this.#stderrCursor += match.index + match[0].length;
        return match;
      }
      if (this.#stderrEnded) throw new Error(`the inspectee exited before ${pattern} in its stderr:\n${this.#stderr}`);
      await new Promise<void>(resolve => this.#stderrWaiters.push(resolve));
    }
  }

  /** Attaches one more WebSocket client to the server at `url`. */
  async attach(name: string): Promise<InspectorClient> {
    const socket = new WebSocket(this.url);
    this.#sockets.push(socket);
    const opened = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    const client = new InspectorClient(
      name,
      text => socket.send(text),
      () => (socket.close(), closed.promise),
    );
    const gone = (what: string) => {
      const error = new Error(`client ${name}: WebSocket ${what}. stderr of the inspectee:\n${this.#stderr}`);
      opened.reject(error);
      client.fail(error);
    };
    socket.onopen = () => opened.resolve();
    socket.onmessage = event => client.deliver(String(event.data));
    socket.onerror = () => gone("error");
    socket.onclose = () => (gone("closed"), closed.resolve());
    await opened.promise;
    return client;
  }

  /** Lets one `hold()` in the inspectee return. */
  release(): void {
    this.process.stdin.write("x");
    this.process.stdin.flush();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    for (const socket of this.#sockets) socket.close();
    this.process.kill();
    await this.process.exited;
  }
}

/**
 * Spawns `bun -e` with an inspector server on a free port.
 *   "jsc": `bun --inspect`, JavaScriptCore's protocol.
 *   "cdp": `inspector.open()` from node:inspector, the Chrome DevTools Protocol.
 * `script` runs after the server is up. It can call `hold()`.
 */
export async function spawnInspectee(
  protocol: "jsc" | "cdp",
  { script = "", env = {} }: { script?: string; env?: Record<string, string> } = {},
): Promise<Inspectee> {
  const open =
    protocol === "cdp" ? `globalThis.inspector = require("node:inspector"); inspector.open(0, "127.0.0.1");` : "";
  const inspectee = new Inspectee(
    spawn({
      cmd: [
        bunExe(),
        ...(protocol === "jsc" ? ["--inspect=127.0.0.1:0"] : []),
        "-e",
        `${prelude}${open}${script}\nsetInterval(() => {}, 60_000);`,
      ],
      env: { ...bunEnv, ...env },
      stdin: "pipe",
      stdout: "ignore",
      stderr: "pipe",
    }),
  );
  const listening = protocol === "jsc" ? /Listening:\s+(ws:\/\/\S+)/ : /Debugger listening on (ws:\/\/\S+)/;
  inspectee.url = (await inspectee.stderr(listening))[1];
  return inspectee;
}

/**
 * Listens on a unix socket for an inspectee started with `BUN_INSPECT=unix://path`. That
 * inspectee connects to the socket, and each message is framed with its length (SocketFramer).
 */
export function listenForInspectee(path: string, name: string) {
  const connected = Promise.withResolvers<InspectorClient>();
  const closed = Promise.withResolvers<void>();
  let client: InspectorClient | undefined;
  const framer = new SocketFramer(message => client!.deliver(message));
  const listener = Bun.listen({
    unix: path,
    socket: {
      open(socket: Socket) {
        client = new InspectorClient(
          name,
          text => framer.send(socket, text),
          () => (socket.end(), closed.promise),
        );
        connected.resolve(client);
      },
      data(socket: Socket, bytes: Buffer) {
        framer.onData(socket, bytes);
      },
      close() {
        client?.fail(new Error(`client ${name}: the inspectee closed the unix socket`));
        closed.resolve();
      },
      error(_socket: Socket, error: Error) {
        connected.reject(error);
        client?.fail(error);
      },
    },
  });
  return { client: connected.promise, [Symbol.dispose]: () => listener.stop(true) };
}
