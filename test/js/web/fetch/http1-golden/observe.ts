// What the tests and record.ts look at, as text.
// The whole module, so that a Bun without `http1Internals` can still record what its clients do.
import * as internals from "bun:internal-for-testing";
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import WebSocket from "ws";
import { bodies, chunkedHead, heads, type Case } from "./cases";

/** Inputs in hex, and what `http1Internals` reports about them. */
export interface ParserCases {
  heads: [slots: number, data: string, expected: string][];
  bodies: [cuts: number[], data: string, expected: string][];
}
export const parserCasesPath = join(import.meta.dir, "parser.json.gz");
const parserCasesJson = async () => Buffer.from(Bun.gunzipSync(await Bun.file(parserCasesPath).bytes()));
export const loadParserCases = async (): Promise<ParserCases> => JSON.parse((await parserCasesJson()).toString());
export const parserCasesHash = async () =>
  createHash("sha256")
    .update(await parserCasesJson())
    .digest("hex");

export const parsed = (slots: number, data: string) =>
  internals.http1Internals.parseResponse(Buffer.from(data, "hex"), slots);
export const decoded = (cuts: number[], data: string) =>
  internals.http1Internals.decodeChunked(Buffer.from(data, "hex"), cuts);

const sha1 = (data: Buffer | string) => createHash("sha1").update(data).digest("hex");
const short = (data: Buffer) => (data.length <= 64 ? data.toString("hex") : `${data.length} bytes, sha1 ${sha1(data)}`);
const brief = (text: string) =>
  text.length <= 400 ? text : `${text.slice(0, 100)}... ${text.length} characters, sha1 ${sha1(text)}`;

/** How a response reaches the client. The results do not depend on it. */
export const deliveries = {
  "in one write": (data: Buffer) => [data],
  "in small pieces": (data: Buffer) => {
    const size = Math.ceil(data.length / 40) || 1;
    return Array.from({ length: Math.ceil(data.length / size) }, (_, i) => data.subarray(i * size, (i + 1) * size));
  },
};
export type Delivery = keyof typeof deliveries;

const turn = () => new Promise<void>(resolve => setImmediate(resolve));

/**
 * Answers `GET /<n>` with `responses[n]` and closes the connection. A piece is written once the event loop has
 * polled its sockets, so the client mostly reads them one at a time. Nothing depends on that.
 */
function rawServer(responses: Buffer[], delivery: Delivery) {
  return Bun.listen<{ request: string }>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = { request: "" };
      },
      async data(socket, data) {
        if (socket.data.request.endsWith("\r\n\r\n")) return;
        socket.data.request += data.toString("latin1");
        if (!socket.data.request.endsWith("\r\n\r\n")) return;
        const index = +/^GET \/(\d+) /.exec(socket.data.request)![1];
        for (let piece of deliveries[delivery](responses[index])) {
          while (piece.length > 0) {
            const written = socket.write(piece);
            if (written < 0) return;
            piece = piece.subarray(written);
            socket.flush();
            await turn();
          }
        }
        socket.end();
      },
      error() {},
    },
  });
}

async function fetched(url: string) {
  let response: Response;
  try {
    response = await fetch(url, { redirect: "manual", keepalive: false });
  } catch (error: any) {
    return `${error.code}`;
  }
  const head = brief(
    `${response.status} ${JSON.stringify(response.statusText)} ${JSON.stringify([...response.headers])}`,
  );
  try {
    return `${head} ${short(Buffer.from(await response.arrayBuffer()))}`;
  } catch (error: any) {
    return `${head} ${error.code}`;
  }
}

/** None of the responses is an upgrade, so `ws` hands over those that it can read. */
function refusedUpgrade(url: string) {
  const { promise, resolve } = Promise.withResolvers<string>();
  const ws = new WebSocket(url);
  ws.on("error", error => resolve(error.message.replace(url, "<url>")));
  ws.on("open", () => resolve("open"));
  ws.on("close", code => resolve(`close ${code}`));
  ws.on("unexpected-response", (_, response: IncomingMessage) => {
    const head = brief(
      `${response.httpVersion} ${response.statusCode} ${JSON.stringify(response.statusMessage)} ${JSON.stringify(response.rawHeaders)}`,
    );
    const parts: Buffer[] = [];
    response.on("data", part => parts.push(part));
    const ended = (body: string) => {
      resolve(`${head} ${body}`);
      ws.terminate();
    };
    response.once("end", () => ended(short(Buffer.concat(parts))));
    // How much of it came before depends on how it was delivered.
    response.once("aborted", () => ended("cut short"));
    response.once("error", () => ended("error"));
    response.once("close", () => ended("close"));
  });
  return promise;
}

export const clients = { fetch: fetched, ws: refusedUpgrade };
export type Client = keyof typeof clients;

export const responses = {
  heads,
  bodies: bodies.map(([label, body]): Case => [label, chunkedHead + body]),
};
export type Part = keyof typeof responses;

/** What `client` makes of each of `cases`, by label. */
export async function observed(client: Client, cases: Case[], delivery: Delivery) {
  using server = rawServer(
    cases.map(([, text]) => Buffer.from(text, "latin1")),
    delivery,
  );
  const results: Record<string, string> = {};
  let next = 0;
  const worker = async () => {
    while (next < cases.length) {
      const index = next++;
      const url = `${client === "ws" ? "ws" : "http"}://127.0.0.1:${server.port}/${index}`;
      results[cases[index][0]] = await clients[client](url);
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
  return results;
}

export type Recorded = Record<Client, Record<Part, Record<string, string>>>;
export const recordedPath = join(import.meta.dir, "clients.json");
