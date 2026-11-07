import http, { type ServerOptions, type ServerResponse } from "node:http";
import { RawHttpConnection, get } from "../raw-http-client.ts";
import {
  type Log,
  Report,
  attempt,
  createRandom,
  endAfterTwoTurns,
  formatResponse,
  formatValue,
  listen,
  pick,
  readOrGiveUp,
  readUntilCloseOrGiveUp,
  runProbe,
} from "./probe.ts";

const [seedText = "1", countText = "35", names = "all", optionsName = "default", listeners = "none"] =
  process.argv.slice(2);
const seed = Number(seedText);
const count = Number(countText);

const everyKnownName = [
  "content-length",
  "Content-Length",
  "connection",
  "Connection",
  "date",
  "Date",
  "keep-alive",
  "transfer-encoding",
  "Transfer-Encoding",
  "set-cookie",
  "Set-Cookie",
  "cookie",
  "vary",
  "Vary",
  "content-type",
  "Content-Type",
  "etag",
  "location",
  "cache-control",
  "trailer",
  "upgrade",
  "expect",
  "host",
  "age",
  "server",
  "link",
  "www-authenticate",
  "proxy-authenticate",
  "content-encoding",
  "x-powered-by",
];
const commonNames = [
  "content-type",
  "etag",
  "vary",
  "cache-control",
  "location",
  "set-cookie",
  "x-powered-by",
  "server",
  "link",
  "content-encoding",
];

function runScenario(index: number, res: ServerResponse & Record<string, any>, log: Log) {
  const random = createRandom(seed * 1000003 + index * 7919);
  const sharedArray = ["s1", "s2"];
  const nameCount = random() < 0.3 ? 40 : random() < 0.5 ? 12 : 5;
  const numbered = (prefix: string) => prefix + Math.floor(random() * nameCount);

  const drawName = () => {
    const x = random();
    if (names === "plain") return numbered("x-n");
    if (names === "common") return x < 0.2 ? pick(random, commonNames) : numbered("x-n");
    if (x < 0.25) return pick(random, everyKnownName);
    return numbered(x < 0.35 ? "X-N" : x < 0.4 ? "x-N" : "x-n");
  };

  const drawValue = (name: string): any => {
    const x = random();
    const lowerCaseName = name.toLowerCase();
    if (lowerCaseName === "content-length" && x < 0.8) return pick(random, ["2", 2, "0", 0, "5", 99]);
    if (lowerCaseName === "connection" && x < 0.8)
      return pick(random, ["keep-alive", "close", "Keep-Alive", "upgrade"]);
    if (lowerCaseName === "transfer-encoding" && x < 0.8) return pick(random, ["chunked", "identity", "gzip, chunked"]);
    if (x < 0.45) return "v" + Math.floor(random() * 9);
    if (x < 0.55) return Math.floor(random() * 1000);
    if (x < 0.65) return ["a" + Math.floor(random() * 9), "b"];
    if (x < 0.7) return sharedArray;
    if (x < 0.73) return [];
    if (x < 0.76) return [1, 2];
    if (x < 0.79) return "";
    if (x < 0.81) return true;
    if (x < 0.83) return 1.5;
    if (x < 0.85) return "café";
    if (x < 0.86) return { toString: () => "obj" };
    if (x < 0.87) return new Date(0);
    if (x < 0.88) return 10n;
    if (x < 0.89) return ["x", ["nested"]];
    if (x < 0.9) return Buffer.from("bf");
    return "w" + Math.floor(random() * 9);
  };

  const returnsResponse = (run: () => unknown) => attempt(() => (run() === res ? "ok" : "did not return res"));

  const steps = 1 + Math.floor(random() * (nameCount === 40 ? 60 : nameCount === 12 ? 24 : 9));
  for (let step = 0; step < steps; step++) {
    const x = random();
    const name = drawName();
    if (x < 0.42) {
      const value = drawValue(name);
      log(
        "setHeader",
        name,
        formatValue(value),
        returnsResponse(() => res.setHeader(name, value)),
      );
    } else if (x < 0.52) {
      const value = drawValue(name);
      log(
        "appendHeader",
        name,
        formatValue(value),
        returnsResponse(() => res.appendHeader(name, value)),
      );
    } else if (x < 0.66) {
      log(
        "removeHeader",
        name,
        attempt(() => res.removeHeader(name)),
      );
    } else if (x < 0.74) {
      log(
        "getHeader",
        name,
        attempt(() => res.getHeader(name)),
        "hasHeader",
        attempt(() => res.hasHeader(name)),
      );
    } else if (x < 0.79) {
      log(
        "getHeaderNames",
        attempt(() => res.getHeaderNames()),
        attempt(() => res.getRawHeaderNames()),
      );
    } else if (x < 0.84) {
      log(
        "getHeaders",
        attempt(() => res.getHeaders()),
      );
    } else if (x < 0.87) {
      sharedArray.push("p" + step);
      log("the shared array grows to", sharedArray.length);
    } else if (x < 0.89) {
      const value = res.getHeader(name);
      if (Array.isArray(value)) {
        value.push("pushed");
        log("pushed into the result of getHeader", name);
      }
    } else if (x < 0.91) {
      const headers = res.getHeaders();
      headers["x-written-into-the-copy"] = "1";
      delete headers[Object.keys(headers)[0]];
      log("changed the result of getHeaders");
    } else if (x < 0.93) {
      const map = new Map<string, any>([
        [drawName(), "m1"],
        [drawName(), ["m2", "m3"]],
      ]);
      log(
        "setHeaders(Map)",
        [...map.keys()],
        returnsResponse(() => res.setHeaders(map)),
      );
    } else if (x < 0.95) {
      const headers = new Headers();
      headers.append("x-h1", "1");
      headers.append("set-cookie", "a=1");
      headers.append("set-cookie", "b=2");
      log(
        "setHeaders(Headers)",
        returnsResponse(() => res.setHeaders(headers)),
      );
    } else if (x < 0.96) {
      if (names === "all")
        log(
          "_headers",
          attempt(() => res._headers),
          attempt(() => res._headerNames),
        );
      else
        log(
          "hasHeader",
          attempt(() => res.hasHeader(name)),
        );
    } else if (x < 0.97) {
      res.sendDate = random() < 0.5;
      log("sendDate", res.sendDate);
    } else if (x < 0.98) {
      res.statusCode = pick(random, names === "all" ? [200, 201, 204, 304, 404, 500] : [200, 201, 404, 500]);
      log("statusCode", res.statusCode);
    } else if (x < 0.99) {
      const array = ["id"];
      res.setHeader("x-same", array);
      log("getHeader returns the array that was set:", res.getHeader("x-same") === array);
    } else {
      log("flags", [res._removedConnection, res._removedContLen, res._removedTE, res.sendDate, res.headersSent]);
    }
  }

  const drawHeaderObject = () => {
    const headers: Record<string, any> = {};
    for (let i = Math.floor(random() * 5); i > 0; i--) {
      const name = drawName();
      headers[name] = drawValue(name);
    }
    return headers;
  };
  const drawHeaderArray = () => {
    const headers: string[] = [];
    for (let i = Math.floor(random() * 5); i > 0; i--) {
      const name = drawName();
      headers.push(name, String(drawValue(name)));
    }
    return headers;
  };

  const senders: [string, () => void][] = [
    ["end(body)", () => res.end("ok")],
    [
      "write(), end(body)",
      () => {
        res.write("o");
        res.end("k");
      },
    ],
    ["end()", () => res.end()],
    [
      "writeHead(status, object)",
      () => {
        const headers = drawHeaderObject();
        log("  headers", headers);
        res.writeHead(res.statusCode, headers);
        res.end("ok");
      },
    ],
    [
      "writeHead(status, array)",
      () => {
        const headers = drawHeaderArray();
        log("  headers", headers);
        res.writeHead(res.statusCode, headers);
        res.end("ok");
      },
    ],
    [
      "writeHead(status, message, object), write(), end()",
      () => {
        const headers = drawHeaderObject();
        log("  headers", headers);
        res.writeHead(200, "Fine", headers);
        res.write("ok");
        res.end(null);
      },
    ],
    [
      "flushHeaders()",
      () => {
        res.flushHeaders();
        log("  after flushHeaders", res.getHeaderNames());
        res.end("ok");
      },
    ],
    [
      "writeHead(status)",
      () => {
        res.writeHead(res.statusCode);
        sharedArray.push("after writeHead");
        log(
          "  after writeHead",
          res.getHeaders(),
          attempt(() => (res.setHeader("x-late", "1"), "set")),
          attempt(() => (res.removeHeader("x-n0"), "removed")),
        );
        res.end("ok");
      },
    ],
    [
      "end(Buffer)",
      () => {
        res.end(Buffer.from("ok"));
        log("  after end", res.getHeaders(), res.getHeaderNames(), typeof res._header);
      },
    ],
  ];
  const [senderName, send] = senders[Math.floor(random() * senders.length)];
  log(
    "send:",
    senderName,
    attempt(() => (send(), "done")),
  );
  if (!res.writableEnded)
    log(
      "ended afterwards:",
      attempt(() => (res.end(), "done")),
    );
}

const serverOptions: Record<string, ServerOptions> = {
  "default": {},
  "unique-headers": { uniqueHeaders: ["x-n1", "set-cookie", "x-n2", "vary"] },
  "join-duplicate-headers": { joinDuplicateHeaders: true },
  "insecure-parser": { insecureHTTPParser: true },
  "reject-non-standard-body-writes": { rejectNonStandardBodyWrites: true },
};

const report = new Report();
report.recordUncaughtErrors();
const closesAfterResponse = names === "all";

const server = http.createServer(serverOptions[optionsName], (req, res) => {
  if (req.url === "/warm-up") return void res.end("ok");
  if (closesAfterResponse) endAfterTwoTurns(req.socket);
  if (listeners !== "none") res.on("finish", () => {});
  runScenario(Number(req.url!.slice(1)), res, report.current);
});

runProbe(async () => {
  const port = await listen(server);

  for (let index = 0; index < count; index++) {
    const log = report.start(`seed ${seed}, scenario ${index}`);
    const isHead = index % 11 === 10;
    const request = get("/" + index).replace(/^GET/, isHead ? "HEAD" : "GET");
    if (closesAfterResponse) {
      for (let round = 0; round < 2; round++) {
        using connection = await RawHttpConnection.connect(port);
        report.startBlock();
        await connection.request(get("/warm-up"));
        connection.send(request);
        log("until the connection closed:", formatResponse(await readUntilCloseOrGiveUp(connection)));
      }
      continue;
    }
    using connection = await RawHttpConnection.connect(port);
    for (let i = 0; i < 3; i++) {
      report.startBlock();
      connection.send(request);
      const response = await readOrGiveUp(connection, { hasNoBody: isHead });
      log("response:", formatResponse(response));
      if (response.startsWith("closed") || response === "no response") break;
    }
  }

  server.close();
  server.closeAllConnections();
  report.print();
});
