import http, { type ServerResponse } from "node:http";
import { get } from "../raw-http-client.ts";
import {
  type Log,
  Report,
  ReusedConnection,
  attempt,
  formatResponse,
  formatValue,
  listen,
  readOrGiveUp,
  runProbe,
} from "./probe.ts";

const repeated = (text: string, count: number) => Buffer.alloc(Buffer.byteLength(text) * count, text).toString();

const strings: Record<string, string> = {
  "an empty string": "",
  "one ASCII character": "a",
  "a two-byte character": "é",
  "a three-byte character": "€",
  "a four-byte character": "\u{1f600}",
  "a lone surrogate": "x\ud800y",
  "a NUL character": "a\0b",
  "characters of every width": "aé€\u{1f600}",
  "hex digits": "68690a",
  "base64 text": "aGk=",
  "three ASCII characters": "abc",
  "1000 two-byte characters": repeated("é", 1000),
  "5000 four-byte characters": repeated("\u{1f600}", 5000),
  "70000 ASCII characters": repeated("x", 70000),
};
const encodings = [
  undefined,
  "utf8",
  "utf-8",
  "UTF8",
  "latin1",
  "binary",
  "ascii",
  "hex",
  "base64",
  "base64url",
  "utf16le",
  "ucs2",
  "ucs-2",
  "bogus",
];

const bytes = Buffer.from("0123456789abcdef");
const binaries: Record<string, ArrayBufferView> = {
  "a Buffer": Buffer.from("bytes"),
  "an empty Buffer": Buffer.alloc(0),
  "a Buffer slice": bytes.subarray(3, 9),
  "a Uint8Array": new Uint8Array([111, 107]),
  "a Uint8Array with an offset": new Uint8Array(bytes.buffer, bytes.byteOffset + 2, 4),
  "a Uint16Array": new Uint16Array([0x6b6f, 0x2121]),
  "a Float64Array": new Float64Array([1]),
  "a DataView": new DataView(bytes.buffer, bytes.byteOffset + 1, 3),
  "a 70000-byte Buffer": Buffer.alloc(70000, 120),
};

type Sender = (res: ServerResponse, body: any, encoding: any, log: Log) => void;

const senders: Record<string, Sender> = {
  "end(body)": (res, body, encoding) => void res.end(body, encoding),
  "write(body), end()": (res, body, encoding, log) => {
    log("write() returns", res.write(body, encoding), "writableLength", res.writableLength);
    res.end();
  },
  "write(body), write(body), end(body)": (res, body, encoding, log) => {
    log("write() returns", res.write(body, encoding), res.write(body, encoding), "writableLength", res.writableLength);
    res.end(body, encoding);
  },
  "Content-Length, end(body)": (res, body, encoding) => {
    const length =
      typeof body === "string"
        ? Buffer.from(body, Buffer.isEncoding(encoding) ? encoding : "utf8").length
        : body.byteLength;
    res.setHeader("Content-Length", length);
    res.end(body, encoding);
  },
  "writeHead(), write(body), end()": (res, body, encoding) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write(body, encoding);
    res.end();
  },
};

const [listeners = "none"] = process.argv.slice(2);

const report = new Report();
report.recordUncaughtErrors();
let send: (res: ServerResponse, log: Log) => void;

const server = http.createServer((req, res: ServerResponse & Record<string, any>) => {
  if (req.url === "/warm-up") return void res.end("ok");
  const log = report.current;
  if (listeners !== "none") res.on("finish", () => {});
  const outcome = attempt(() => (send(res, log), "done"));
  log(outcome, "_contentLength", formatValue(res._contentLength), "chunkedEncoding", res.chunkedEncoding);
  if (outcome !== "done") req.socket.destroy();
});

runProbe(async () => {
  const reused = new ReusedConnection(await listen(server));
  const bodies: [string, unknown, unknown][] = [
    ...Object.entries(strings).flatMap(([name, text]) =>
      encodings.map((encoding): [string, unknown, unknown] => [`${name}, ${encoding}`, text, encoding]),
    ),
    ...Object.entries(binaries).flatMap(([name, view]) =>
      [undefined, "utf8"].map((encoding): [string, unknown, unknown] => [`${name}, ${encoding}`, view, encoding]),
    ),
  ];

  for (const [name, body, encoding] of bodies) {
    for (const [senderName, sender] of Object.entries(senders)) {
      send = (res, log) => sender(res, body, encoding, log);
      const log = report.start(`${name}, ${senderName}`);
      const connection = await reused.acquire();
      for (let i = 0; i < 3; i++) {
        report.startBlock();
        connection.send(get("/"));
        const response = await readOrGiveUp(connection);
        log("response:", formatResponse(response));
        if (response.startsWith("closed") || response === "no response") break;
      }
      report.startBlock();
      log("the connection serves another request:", await reused.release());
    }
  }

  reused.discard();
  server.close();
  server.closeAllConnections();
  report.print();
});
