import type { IncomingMessage, Server, ServerResponse } from "node:http";
import net, { type AddressInfo, type Socket } from "node:net";
import { RawHttpConnection, get } from "../raw-http-client.ts";

// A stream of bytes waits at 16 KiB on Windows and at 64 KiB elsewhere, as in Node.js. What is recorded is recorded with 64 KiB.
if (process.platform === "win32") require("node:stream").setDefaultHighWaterMark(false, 64 * 1024);

export type Log = (...parts: unknown[]) => void;

export function formatValue(value: unknown, depth = 0): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value.length > 80 ? value.slice(0, 80) + ".." : value);
    case "number":
      return Object.is(value, -0) ? "-0" : String(value);
    case "function":
      return "function " + value.name;
    case "object":
      break;
    default:
      return String(value);
  }
  if (Array.isArray(value)) return depth > 1 ? "[..]" : "[" + value.map(item => formatValue(item, depth + 1)) + "]";
  const prototype = Object.getPrototypeOf(value);
  const className = prototype === null ? "null-prototype" : (prototype.constructor?.name ?? "?");
  if (depth > 0 || (className !== "Object" && className !== "null-prototype")) return "{" + className + "}";
  const entries = Reflect.ownKeys(value).map(key => String(key) + ":" + formatValue((value as any)[key], depth + 1));
  return className + "{" + entries + "}";
}

export function formatError(error: any) {
  return `${error?.name}${error?.code ? " " + error.code : ""}`;
}

export function attempt(run: () => unknown): string {
  try {
    const result = run();
    return typeof result === "string" ? result : formatValue(result);
  } catch (error) {
    return "throws " + formatError(error);
  }
}

export function formatResponse(response: string) {
  const bodyStart = response.indexOf("\r\n\r\n") + 4;
  if (bodyStart < 4 || response.length - bodyStart <= 200) return JSON.stringify(response);
  let checksum = 0x811c9dc5;
  for (let i = bodyStart; i < response.length; i++) checksum = Math.imul(checksum ^ response.charCodeAt(i), 0x01000193);
  return `${JSON.stringify(response.slice(0, bodyStart))} + ${response.length - bodyStart} bytes, checksum ${checksum >>> 0}`;
}

export function createRandom(seed: number) {
  let state = seed | 0;
  return () => {
    state = (Math.imul(state ^ (state >>> 15), 2246822519) + 0x9e3779b9) | 0;
    return ((state ^ (state >>> 13)) >>> 0) / 4294967296;
  };
}

export function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

export function shuffle<T>(random: () => number, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export class Report {
  #cases = new Map<string, string[][]>();
  #blocks: string[][] = [];
  current: Log = () => {};

  start(name: string): Log {
    const blocks: string[][] = [[]];
    this.#blocks = blocks;
    this.#cases.set(name, blocks);
    this.current = (...parts) =>
      void blocks.at(-1)!.push(parts.map(part => (typeof part === "string" ? part : formatValue(part))).join(" "));
    return this.current;
  }

  startBlock() {
    if (this.#blocks.at(-1)!.length > 0) this.#blocks.push([]);
  }

  recordUncaughtErrors() {
    const record = (kind: string) => (error: unknown) => {
      if (this.#cases.size > 0) return this.current(kind + " " + formatError(error));
      console.error(error);
      process.exit(1);
    };
    process.on("uncaughtException", record("uncaught"));
    process.on("unhandledRejection", record("unhandled rejection"));
  }

  print() {
    const groups = new Map<string, string[]>();
    for (const [name, blocks] of this.#cases) {
      const texts = blocks.map(lines => lines.map(line => "    " + line + "\n").join(""));
      const text = texts.map((block, i) => (i > 0 && block === texts[i - 1] ? "    again\n" : block)).join("");
      const names = groups.get(text);
      if (names) names.push(name);
      else groups.set(text, [name]);
    }
    let output = "";
    for (const [text, names] of groups) output += names.map(name => name + "\n").join("") + text;
    process.stdout.write(output);
  }
}

export function formatFlags(object: any, names: string[]) {
  const parts: string[] = [];
  for (const name of names) {
    const value = attempt(() => formatValue(object[name]));
    if (value === "true") parts.push(name);
    else if (value !== "false") parts.push(`${name}=${value}`);
  }
  return parts.join(" ");
}

const responseFlags = [
  "finished",
  "headersSent",
  "writableEnded",
  "writableFinished",
  "destroyed",
  "closed",
  "statusCode",
  "statusMessage",
  "shouldKeepAlive",
  "chunkedEncoding",
];
const requestFlags = ["complete", "destroyed", "readableEnded", "_dumped"];

export function exchangeState(req: IncomingMessage, res: ServerResponse) {
  return `res[${formatFlags(res, responseFlags)}] req[${formatFlags(req, requestFlags)}]`;
}

export function runProbe(run: () => Promise<void>) {
  process.noDeprecation = true;
  run().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

export function nextTurn() {
  return new Promise<void>(resolve => setImmediate(resolve));
}

async function connectToItself() {
  const accepted = Promise.withResolvers<Socket>();
  const listener = net.createServer(accepted.resolve);
  await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
  const near = net.connect((listener.address() as AddressInfo).port, "127.0.0.1");
  const far = await accepted.promise;
  listener.close();
  return { near: near.unref(), far: far.unref() };
}

let ownConnection: ReturnType<typeof connectToItself> | undefined;

// The loopback interface delivers in order, but not at once on every system: when a byte sent now has arrived, this
// event loop has heard of every connection that was closed before. One connection serves the whole process: a new one
// for each wait would use up the ports.
async function untilEarlierClosesWereHeard() {
  const { near, far } = await (ownConnection ??= connectToItself());
  const arrived = new Promise<void>(resolve => far.once("data", () => resolve()));
  near.write(".");
  await arrived;
  // The close and the byte may be heard in one turn of the event loop. What the close has put off to later in that turn, or to the next, comes first.
  await nextTurn();
  await nextTurn();
}

export async function untilDestroyed(socket: Socket | undefined) {
  if (socket) await untilEarlierClosesWereHeard();
  for (let turn = 0; socket && turn < 1000; turn++) {
    const destroyed = attempt(() => socket.destroyed);
    if (destroyed === "true" || (destroyed !== "false" && turn === 20)) return;
    await nextTurn();
  }
}

export async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

async function orGiveUp(response: Promise<string>) {
  let result: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const received = response.then(value => void (result = value));
  const expired = new Promise<void>(resolve => {
    timer = setTimeout(resolve, 30000);
  });
  await Promise.race([received, expired]);
  clearTimeout(timer);
  for (let turn = 0; result === undefined && turn < 5000; turn++) await nextTurn();
  return result ?? "no response";
}

export function readOrGiveUp(connection: RawHttpConnection, options?: { hasNoBody?: boolean }) {
  return orGiveUp(connection.readResponse(options));
}

export function readUntilCloseOrGiveUp(connection: RawHttpConnection) {
  return orGiveUp(connection.readUntilClose());
}

export class ReusedConnection {
  #port: number;
  #connection: RawHttpConnection | undefined;

  constructor(port: number) {
    this.#port = port;
  }

  async acquire() {
    if (!this.#connection) {
      this.#connection = await RawHttpConnection.connect(this.#port);
      await this.#connection.request(get("/warm-up"));
    }
    return this.#connection;
  }

  async release() {
    if (!this.#connection) return false;
    this.#connection.send(get("/warm-up"));
    const response = await readOrGiveUp(this.#connection);
    const isUsable = response.startsWith("HTTP/1.1 200 ") && response.endsWith("\r\n\r\nok");
    if (!isUsable) this.discard();
    return isUsable;
  }

  discard() {
    this.#connection?.[Symbol.dispose]();
    this.#connection = undefined;
  }
}

export function endAfterTwoTurns(socket: Socket) {
  setImmediate(() => setImmediate(() => socket.end()));
}
