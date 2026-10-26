// A client of the language server that `bun fmt --no-script --lsp` and `bun lint --no-script --lsp` start, for the tests of
// both: frames over the server's standard input and output, requests, notifications and the helpers the tests share.
import { bunEnv } from "harness";
import { join } from "node:path";
import { spawn } from "./children";

export type Message = {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string };
};

export type Position = { line: number; character: number };
export type TextEdit = { range: { start: Position; end: Position }; newText: string };

/** Splits what the server writes into messages: `Content-Length: <bytes>`, an empty line, the JSON. */
export class Framer {
  private buffered = Buffer.alloc(0);
  /** What is no frame: text before a header, a header without a length, a body that is not JSON. */
  readonly garbage: string[] = [];

  constructor(private onMessage: (message: Message) => void) {}

  push(chunk: Uint8Array) {
    this.buffered = this.buffered.length ? Buffer.concat([this.buffered, chunk]) : Buffer.from(chunk);
    for (;;) {
      const end = this.buffered.indexOf("\r\n\r\n");
      if (end < 0) return;
      const header = this.buffered.toString("utf8", 0, end);
      const length = /(^|\r\n)Content-Length: (\d+)$/.exec(header);
      if (!length) {
        this.garbage.push(header);
        this.buffered = this.buffered.subarray(end + 4);
        continue;
      }
      if (length.index > 0) this.garbage.push(header.slice(0, length.index));
      const size = Number(length[2]);
      if (this.buffered.length < end + 4 + size) return;
      const body = this.buffered.toString("utf8", end + 4, end + 4 + size);
      this.buffered = this.buffered.subarray(end + 4 + size);
      try {
        this.onMessage(JSON.parse(body));
      } catch {
        this.garbage.push(body);
      }
    }
  }

  /** What follows the last frame. */
  get rest() {
    return this.buffered.toString();
  }
}

/** A client of the server: sends requests and notifications, awaits answers and notifications. */
export class Client {
  readonly proc;
  private readonly framer: Framer;
  private next = 0;
  private readonly waiting = new Map<number, { resolve: (message: Message) => void; reject: (why: Error) => void }>();
  /** Notifications and requests of the server that nothing has awaited yet. */
  private readonly unclaimed: Message[] = [];
  private readonly watchers: {
    test: (message: Message) => boolean;
    resolve: (message: Message) => void;
    reject: (why: Error) => void;
  }[] = [];
  /** Everything the server has sent, in order. */
  readonly received: Message[] = [];
  private readonly stderr: Promise<string>;
  /** Resolves when the server has closed its standard output. */
  private readonly done: Promise<void>;
  /** Why nothing can be awaited any more, once the server has closed its standard output. */
  private ended: Error | undefined;

  /** Starts `cmd` in `cwd` with pipes for the three standard streams. */
  constructor(cmd: string[], cwd: string) {
    this.proc = spawn({ cmd, env: bunEnv, cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    this.framer = new Framer(message => this.take(message));
    this.stderr = this.proc.stderr.text();
    this.done = this.read();
  }

  private async read() {
    for await (const chunk of this.proc.stdout) this.framer.push(chunk);
    const why = new Error("The server ended before it answered");
    this.ended = why;
    for (const { reject } of this.waiting.values()) reject(why);
    this.waiting.clear();
    for (const { reject } of this.watchers) reject(why);
    this.watchers.length = 0;
  }

  private take(message: Message) {
    this.received.push(message);
    if (message.method === undefined && typeof message.id === "number") {
      const waiting = this.waiting.get(message.id);
      this.waiting.delete(message.id);
      waiting?.resolve(message);
      return;
    }
    const at = this.watchers.findIndex(it => it.test(message));
    if (at < 0) return void this.unclaimed.push(message);
    const [watcher] = this.watchers.splice(at, 1);
    watcher.resolve(message);
  }

  /** What `send` has not written yet, while `together` runs. */
  private held: string[] | undefined;

  private send(message: object) {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    const frame = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    if (this.held) return void this.held.push(frame);
    this.proc.stdin.write(frame);
    this.proc.stdin.flush();
  }

  /** Sends what `send` is called with in `run` as one write. */
  together(run: () => void) {
    this.held = [];
    run();
    const frames = this.held.join("");
    this.held = undefined;
    this.proc.stdin.write(frames);
    this.proc.stdin.flush();
  }

  /** The id of the last request sent. */
  get lastId() {
    return this.next;
  }

  request(method: string, params: unknown = {}): Promise<Message> {
    if (this.ended) return Promise.reject(this.ended);
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.send({ id, method, params });
    });
  }

  notify(method: string, params: unknown = {}) {
    this.send({ method, params });
  }

  /** The next message of the server that `test` accepts, among those that came already or the ones to come. */
  notification(test: (message: Message) => boolean): Promise<Message> {
    const at = this.unclaimed.findIndex(test);
    if (at >= 0) return Promise.resolve(this.unclaimed.splice(at, 1)[0]);
    if (this.ended) return Promise.reject(this.ended);
    return new Promise((resolve, reject) => this.watchers.push({ test, resolve, reject }));
  }

  /** The next `textDocument/publishDiagnostics` about `path`. */
  diagnostics(path: string) {
    const uri = uriOf(path);
    return this.notification(it => it.method === "textDocument/publishDiagnostics" && it.params.uri === uri);
  }

  /** Closes the client's side and waits for the server to end. */
  async end() {
    this.proc.stdin.end();
    const [exitCode, stderr] = await Promise.all([this.proc.exited, this.stderr]);
    await this.done;
    return { exitCode, stderr, garbage: this.framer.garbage, rest: this.framer.rest };
  }

  [Symbol.asyncDispose]() {
    this.proc.kill("SIGKILL");
    return this.done;
  }
}

export const uriOf = (...parts: string[]) => Bun.pathToFileURL(join(...parts)).href;

export const initialize = (client: Client, folders: string[], more: object = {}) =>
  client.request("initialize", {
    processId: process.pid,
    capabilities: {},
    workspaceFolders: folders.map(it => ({ uri: uriOf(it), name: it })),
    ...more,
  });

export const open = (client: Client, path: string, text: string, languageId = "javascript") =>
  client.notify("textDocument/didOpen", { textDocument: { uri: uriOf(path), languageId, version: 1, text } });

export const format = (client: Client, path: string) =>
  client.request("textDocument/formatting", {
    textDocument: { uri: uriOf(path) },
    options: { tabSize: 2, insertSpaces: true },
  });

/** `text` with the `TextEdit`s applied. Positions count UTF-16 code units, which are bytes in these tests. */
export function applyEdits(text: string, edits: TextEdit[]) {
  const starts = [0];
  for (let at = 0; at < text.length; at++) if (text[at] === "\n") starts.push(at + 1);
  const offset = ({ line, character }: Position) => (line < starts.length ? starts[line] + character : text.length);
  const ordered = [...edits].sort((a, b) => offset(b.range.start) - offset(a.range.start));
  for (const edit of ordered) {
    text = text.slice(0, offset(edit.range.start)) + edit.newText + text.slice(offset(edit.range.end));
  }
  return text;
}
