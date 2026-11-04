import net from "node:net";

function chunkedBodyEnd(buffer: string, start: number): number | undefined {
  let position = start;
  while (true) {
    const lineEnd = buffer.indexOf("\r\n", position);
    if (lineEnd < 0) return undefined;
    const size = parseInt(buffer.slice(position, lineEnd), 16);
    if (size === 0) {
      const trailersEnd = buffer.indexOf("\r\n\r\n", position);
      return trailersEnd < 0 ? undefined : trailersEnd + 4;
    }
    position = lineEnd + 2 + size + 2;
    if (position > buffer.length) return undefined;
  }
}

function responseEnd(buffer: string, hasNoBody: boolean): number | undefined {
  const headEnd = buffer.indexOf("\r\n\r\n");
  if (headEnd < 0) return undefined;
  const head = buffer.slice(0, headEnd);
  const bodyStart = headEnd + 4;
  const status = Number(head.slice(9, 12));
  if (hasNoBody || status < 200 || status === 204 || status === 304) return bodyStart;
  const contentLength = /^content-length: *(\d+)/im.exec(head);
  if (contentLength) {
    const end = bodyStart + Number(contentLength[1]);
    return buffer.length >= end ? end : undefined;
  }
  if (/^transfer-encoding: *chunked/im.test(head)) return chunkedBodyEnd(buffer, bodyStart);
  return undefined;
}

export function maskDate(response: string) {
  return response.replace(/^Date: .*$/gim, "Date: <date>");
}

export class RawHttpConnection {
  #socket: net.Socket;
  #buffer = "";
  #isClosed = false;
  #change = Promise.withResolvers<void>();

  private constructor(socket: net.Socket) {
    this.#socket = socket;
    socket.setEncoding("latin1");
    socket.on("data", (chunk: string) => {
      this.#buffer += chunk;
      this.#notify();
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      this.#isClosed = true;
      this.#notify();
    });
  }

  static async connect(port: number) {
    const socket = net.connect(port, "127.0.0.1");
    const connected = Promise.withResolvers<void>();
    socket.once("connect", connected.resolve);
    socket.once("error", connected.reject);
    await connected.promise;
    return new RawHttpConnection(socket);
  }

  #notify() {
    const change = this.#change;
    this.#change = Promise.withResolvers<void>();
    change.resolve();
  }

  send(text: string) {
    this.#socket.write(text, "latin1");
  }

  async readResponse({ hasNoBody = false } = {}): Promise<string> {
    while (true) {
      const end = responseEnd(this.#buffer, hasNoBody);
      if (end !== undefined) {
        const response = this.#buffer.slice(0, end);
        this.#buffer = this.#buffer.slice(end);
        return maskDate(response);
      }
      if (this.#isClosed) return "closed" + (this.#buffer ? " after " + maskDate(this.#buffer) : "");
      await this.#change.promise;
    }
  }

  async untilClosed() {
    while (!this.#isClosed) await this.#change.promise;
  }

  async readUntilClose(): Promise<string> {
    await this.untilClosed();
    return maskDate(this.#buffer);
  }

  async request(text: string, options?: { hasNoBody?: boolean }) {
    this.send(text);
    return await this.readResponse(options);
  }

  [Symbol.dispose]() {
    this.#socket.destroy();
  }
}

export function get(path: string, headers = "") {
  return `GET ${path} HTTP/1.1\r\nHost: localhost\r\n${headers}\r\n`;
}

export function post(path: string, body: string, headers = "") {
  return `POST ${path} HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${body.length}\r\n${headers}\r\n${body}`;
}
