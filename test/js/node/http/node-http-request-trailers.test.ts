/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * The trailer fields that a request has at 'end' are the ones its HTTP parser
 * accepted, as the wire carried them. Node hands them over once, when the
 * message completes, and nothing parses or judges them a second time:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/_http_common.js#L143-L152
 * The expected values below were recorded from Node v26.3.0.
 */
import assert from "node:assert";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { connect, type AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import type { Duplex } from "node:stream";
import { describe, test } from "node:test";
import { connect as tlsConnect } from "node:tls";
import { fileURLToPath } from "node:url";

// Only in Bun: the environment that silences a debug build, and the path of Node.js for the last test.
const harness = typeof Bun !== "undefined" ? await import("harness") : undefined;

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const cert = readFileSync(join(fixtures, "cert.pem"), "utf8");
const key = readFileSync(join(fixtures, "cert.key"), "utf8");

// Node v26.3.0 and Bun have the httpValidation option. A Node without it ignores the option.
const validationTest = process.versions.bun || "httpValidation" in http.createServer() ? test : test.skip;
// Where Bun does not do what Node v26.3.0 does. Each case says what Node does.
const bunOnlyTest = process.versions.bun ? test : test.skip;

const relaxed = { httpValidation: "relaxed" } as http.ServerOptions;

async function withServer(server: http.Server | https.Server, run: (port: number) => Promise<void>) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await run((server.address() as AddressInfo).port);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

type Outcome = { trailers: Record<string, unknown>; raw: string[] } | { clientError: string | undefined };

// Sends `payload` on one connection. Answers what the request has at its 'end', or the code of the 'clientError'.
// `event` is "request", or "upgrade": its listener gets the socket where "request" gets the response.
async function outcomeOf(
  server: http.Server | https.Server,
  payload: string,
  { event = "request", secure = false } = {},
) {
  const { promise, resolve, reject } = Promise.withResolvers<Outcome>();
  const opened: { destroy(): unknown }[] = [];
  server.on(event, (req: http.IncomingMessage, resOrSocket: http.ServerResponse | Duplex) => {
    opened.push(resOrSocket.on("error", () => {}));
    req.resume();
    req.on("end", () => {
      resolve({ trailers: { ...req.trailers }, raw: [...req.rawTrailers] });
      resOrSocket.end();
    });
  });
  server.on("clientError", (err: NodeJS.ErrnoException, socket: Duplex) => {
    socket.destroy();
    resolve({ clientError: err.code });
  });
  await withServer(server, async port => {
    const socket = secure
      ? tlsConnect({ port, host: "127.0.0.1", rejectUnauthorized: false })
      : connect(port, "127.0.0.1");
    opened.push(socket);
    socket.on("error", reject);
    socket.on("close", () => reject(new Error("the connection closed with no 'end' and no 'clientError'")));
    socket.once(secure ? "secureConnect" : "connect", () => socket.write(payload, "latin1"));
    try {
      await promise;
    } finally {
      for (const each of opened) each.destroy();
    }
  });
  return promise;
}

// The parser of a lenient server accepts a control byte in a trailer value. The request then has every field of
// the section, whichever option or flag made the server lenient.
describe("a trailer value with a control byte on a lenient server", () => {
  const request =
    "POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n" +
    "3\r\nabc\r\n0\r\nT: a\x01b\r\nU: 1\r\n\r\n";
  const delivered = { trailers: { t: "a\x01b", u: "1" }, raw: ["T", "a\x01b", "U", "1"] };

  test("insecureHTTPParser: true", async () => {
    assert.deepStrictEqual(await outcomeOf(http.createServer({ insecureHTTPParser: true }), request), delivered);
  });

  test("server.insecureHTTPParser = 1 before listen()", async () => {
    const server = Object.assign(http.createServer(), { insecureHTTPParser: 1 });
    assert.deepStrictEqual(await outcomeOf(server, request), delivered);
  });

  // Node reads the option once, when it accepts the connection.
  test("insecureHTTPParser: true that the 'request' listener sets to false", async () => {
    const server = http.createServer({ insecureHTTPParser: true });
    server.on("request", () => {
      Object.assign(server, { insecureHTTPParser: false });
    });
    assert.deepStrictEqual(await outcomeOf(server, request), delivered);
  });

  validationTest('httpValidation: "relaxed"', async () => {
    assert.deepStrictEqual(await outcomeOf(http.createServer(relaxed), request), delivered);
  });

  validationTest('httpValidation: "insecure"', async () => {
    const server = http.createServer({ httpValidation: "insecure" } as http.ServerOptions);
    assert.deepStrictEqual(await outcomeOf(server, request), delivered);
  });

  validationTest('server.httpValidation = "relaxed" before listen()', async () => {
    const server = Object.assign(http.createServer(), { httpValidation: "relaxed" });
    assert.deepStrictEqual(await outcomeOf(server, request), delivered);
  });

  validationTest('https, httpValidation: "relaxed"', async () => {
    const server = https.createServer({ cert, key, ...relaxed } as https.ServerOptions);
    assert.deepStrictEqual(await outcomeOf(server, request, { secure: true }), delivered);
  });

  validationTest('an Upgrade request with a body, httpValidation: "relaxed"', async () => {
    const upgrade =
      "POST / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: custom\r\nTransfer-Encoding: chunked\r\n\r\n" +
      "3\r\nabc\r\n0\r\nT: a\x01b\r\nU: 1\r\n\r\n";
    assert.deepStrictEqual(await outcomeOf(http.createServer(relaxed), upgrade, { event: "upgrade" }), delivered);
  });

  // The flag is for the whole process, so its rows run in a child of this runtime. A strict option wins over it.
  validationTest("--insecure-http-parser", async () => {
    const script = `
      const { createServer } = require("node:http");
      const { connect } = require("node:net");
      const { once } = require("node:events");
      async function outcomeOf(options) {
        const { promise, resolve } = Promise.withResolvers();
        const server = createServer(options, (req, res) => {
          req.resume();
          req.on("end", () => {
            resolve(req.rawTrailers);
            res.end();
          });
        });
        server.on("clientError", (err, socket) => {
          socket.destroy();
          resolve(err.code);
        });
        await once(server.listen(0, "127.0.0.1"), "listening");
        const socket = connect(server.address().port, "127.0.0.1", () => socket.write(${JSON.stringify(request)}, "latin1"));
        socket.on("error", () => {});
        const outcome = await promise;
        socket.destroy();
        server.close();
        return outcome;
      }
      (async () => {
        console.log(JSON.stringify({
          flagAlone: await outcomeOf({}),
          insecureHTTPParserFalse: await outcomeOf({ insecureHTTPParser: false }),
          httpValidationStrict: await outcomeOf({ httpValidation: "strict" }),
        }));
      })();
    `;
    const child = spawn(process.execPath, ["--insecure-http-parser", "-e", script], {
      env: harness?.bunEnv ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", chunk => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", chunk => (stderr += chunk));
    const [exitCode] = await once(child, "close");
    assert.deepStrictEqual(
      { stdout: exitCode === 0 ? JSON.parse(stdout) : stdout + stderr, exitCode },
      {
        stdout: {
          flagAlone: delivered.raw,
          insecureHTTPParserFalse: "HPE_INVALID_HEADER_TOKEN",
          httpValidationStrict: "HPE_INVALID_HEADER_TOKEN",
        },
        exitCode: 0,
      },
    );
  });
});

// Sends `payload` on one connection and resolves when the server has closed it.
async function roundtrip(port: number, payload: string) {
  const socket = connect(port, "127.0.0.1");
  socket.resume();
  socket.write(payload, "latin1");
  await once(socket, "close");
}

test("trailers keep their wire names and bytes, and leave the headers of the next request alone", async () => {
  const seen: unknown[] = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      seen.push({
        url: req.url,
        host: req.headers.host,
        contentType: req.headers["content-type"],
        raw: [...req.rawTrailers],
        trailers: { ...req.trailers },
      });
      res.end();
    });
  });
  await withServer(server, port =>
    roundtrip(
      port,
      "POST /a HTTP/1.1\r\nHost: first\r\nContent-Type: text/a\r\nTransfer-Encoding: chunked\r\n\r\n" +
        "3\r\nabc\r\n0\r\n" +
        "X-Mixed-Case: one\r\n" +
        "x-mixed-case: two\r\n" +
        // Named like request headers whose last value Bun remembers from one request to the next.
        "Host: trailer-host\r\n" +
        "content-type: text/trailer\r\n" +
        "ETag: \xe9\xff\x80\r\n" +
        "X-Empty:\r\n" +
        "X-Ows: \t padded \t\r\n" +
        "Set-Cookie: a=1\r\n" +
        "set-cookie: b=2\r\n" +
        "\r\n" +
        "POST /b HTTP/1.1\r\nHost: second\r\nContent-Type: text/b\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n" +
        "0\r\nHost: second-trailer\r\n\r\n",
    ),
  );
  assert.deepStrictEqual(seen, [
    {
      url: "/a",
      host: "first",
      contentType: "text/a",
      raw: [
        ...["X-Mixed-Case", "one", "x-mixed-case", "two", "Host", "trailer-host", "content-type", "text/trailer"],
        ...["ETag", "\xe9\xff\x80", "X-Empty", "", "X-Ows", "padded", "Set-Cookie", "a=1", "set-cookie", "b=2"],
      ],
      trailers: {
        "x-mixed-case": "one, two",
        host: "trailer-host",
        "content-type": "text/trailer",
        etag: "\xe9\xff\x80",
        "x-empty": "",
        "x-ows": "padded",
        "set-cookie": ["a=1", "b=2"],
      },
    },
    {
      url: "/b",
      host: "second",
      contentType: "text/b",
      raw: ["Host", "second-trailer"],
      trailers: { host: "second-trailer" },
    },
  ]);
});

test("a trailer value over 64 KiB keeps the field after it", async () => {
  const big = Buffer.alloc(70_000, "b").toString();
  let raw: string[] = [];
  const server = http.createServer({ maxHeaderSize: 128 * 1024 }, (req, res) => {
    req.resume();
    req.on("end", () => {
      raw = [...req.rawTrailers];
      res.end();
    });
  });
  await withServer(server, port =>
    roundtrip(
      port,
      "POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n" +
        `0\r\nX-Big: ${big}\r\nX-After: 1\r\n\r\n`,
    ),
  );
  // The long value by name, so that a failure does not print 70,000 characters.
  const named = raw.map(each => (each === big ? "big" : each.length > 100 ? `${each.length} other characters` : each));
  assert.deepStrictEqual(named, ["X-Big", "big", "X-After", "1"]);
});

// Bun keeps at most 199 trailer fields for a request. Node's limit is server.maxHeadersCount, 1000 when it is not set.
// MAX_HEADER_PAIRS = 2000 counts names and values: https://github.com/nodejs/node/blob/v26.3.0/lib/_http_common.js#L53
describe("a trailer section with many fields", () => {
  const request = (count: number, lastLine = "") =>
    "POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n0\r\n" +
    Array.from({ length: count }, (_, i) => `F${i}: ${i}\r\n`).join("") +
    lastLine +
    "\r\n";

  test("199 fields: the request has them all", async () => {
    const outcome = await outcomeOf(http.createServer(), request(199));
    const summary = "raw" in outcome ? { entries: outcome.raw.length, last: outcome.raw.slice(-2) } : outcome;
    assert.deepStrictEqual(summary, { entries: 398, last: ["F198", "198"] });
  });

  test("199 fields and a line that is not a field: the request fails", async () => {
    const outcome = await outcomeOf(http.createServer(), request(199, "not a field\r\n"));
    assert.deepStrictEqual(outcome, { clientError: "HPE_INVALID_HEADER_TOKEN" });
  });

  // Node v26.3.0 gives the request the 200 fields.
  bunOnlyTest("200 fields: the request fails", async () => {
    assert.deepStrictEqual(await outcomeOf(http.createServer(), request(200)), { clientError: "HPE_HEADER_OVERFLOW" });
  });
});

// The parser keeps a trailer section that is not complete from one read to the next, in the buffer where it also
// keeps a request head that is not complete. Each connection below cuts the same two requests into reads at
// other places.
validationTest("a request has the same trailers wherever its bytes are cut into reads", async () => {
  const post = "POST /a HTTP/1.1\r\nHost: a\r\nTransfer-Encoding: chunked\r\n\r\n";
  const body = "3\r\nabc\r\n";
  // The last chunk and its trailer section. A "|" is a place where one connection cuts them into two reads.
  const marked = "|0|\r\n|T|: a|\x01b\r|\n|U: 2\r\n|\r|\n|";
  const section = marked.replaceAll("|", "");
  const stream = post + body + section + "GET /b HTTP/1.1\r\nHost: b\r\nConnection: close\r\n\r\n";
  const sectionStart = post.length + body.length;
  const sectionEnd = sectionStart + section.length;

  // One cut in the first head, the cuts of the section, one cut in the second head.
  const plans: number[][] = [[20]];
  let at = sectionStart;
  for (const part of marked.split("|").slice(0, -1)) plans.push([(at += part.length)]);
  plans.push([sectionEnd + 16]);
  // A head from two reads, then its body from one more read or two.
  plans.push([20, sectionStart], [20, sectionStart + 9, sectionEnd + 16]);

  const seen: unknown[] = [];
  const server = http.createServer(relaxed, (req, res) => {
    if (req.url === "/barrier") {
      res.end();
      return;
    }
    let received = "";
    req.setEncoding("latin1");
    req.on("data", chunk => (received += chunk));
    // The first read of the headers is here, after the parser has used the block of a head from two reads again.
    req.on("end", () => {
      seen.push({ url: req.url, host: req.headers.host, rawHeaders: req.rawHeaders, received, raw: req.rawTrailers });
      res.end();
    });
  });

  const results: Record<string, unknown> = {};
  await withServer(server, async port => {
    for (const plan of plans) {
      const socket = connect(port, "127.0.0.1");
      socket.resume();
      const closed = once(socket, "close");
      let from = 0;
      for (const cut of plan) {
        socket.write(stream.slice(from, cut), "latin1");
        from = cut;
        // A part of a message emits nothing on the server, so a whole request on a second connection is the
        // barrier: when the server has answered and closed that connection, it has read the write above. The
        // next write then reaches the parser in a read of its own.
        await roundtrip(port, "GET /barrier HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
      }
      socket.write(stream.slice(from), "latin1");
      await closed;
      results[plan.join(",")] = seen.splice(0);
    }
  });

  const unsplit = [
    {
      url: "/a",
      host: "a",
      rawHeaders: ["Host", "a", "Transfer-Encoding", "chunked"],
      received: "abc",
      raw: ["T", "a\x01b", "U", "2"],
    },
    { url: "/b", host: "b", rawHeaders: ["Host", "b", "Connection", "close"], received: "", raw: [] },
  ];
  assert.deepStrictEqual(results, Object.fromEntries(plans.map(plan => [plan.join(","), unsplit])));
});

// The peer's FIN cuts off the body of an accepted Upgrade request. The parser gave no verdict on the trailer
// section then, or it rejected the section, so the request has no trailer field.
describe("an Upgrade request body that the peer's FIN cuts off has no trailer fields", () => {
  const head =
    "POST / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: custom\r\nTransfer-Encoding: chunked\r\n\r\n" +
    "3\r\nabc\r\n0\r\n";

  // What req.rawTrailers holds when the FIN reaches the socket of the 'upgrade' listener.
  async function rawTrailersAtFin(section: string, maxHeadersCount?: number) {
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();
    const opened: Duplex[] = [];
    const server = http.createServer();
    if (maxHeadersCount) server.maxHeadersCount = maxHeadersCount;
    server.on("upgrade", (req: http.IncomingMessage, socket: Duplex) => {
      opened.push(socket);
      req.resume();
      socket.on("end", () => resolve([...req.rawTrailers]));
      socket.on("error", reject);
      socket.on("close", () => reject(new Error("the upgraded socket closed before the FIN reached it")));
    });
    // A listener that leaves the socket open, so that the FIN reaches it.
    server.on("clientError", () => {});
    await withServer(server, async port => {
      const socket = connect({ port, host: "127.0.0.1", allowHalfOpen: true });
      opened.push(socket);
      socket.on("error", reject);
      socket.on("close", () => reject(new Error("the connection closed before the FIN reached the upgraded socket")));
      socket.end(head + section);
      try {
        await promise;
      } finally {
        for (const each of opened) each.destroy();
      }
    });
    return promise;
  }

  for (const [name, section] of [
    // The strict parser rejects a Content-Length or a Transfer-Encoding field in a trailer section.
    ["a section that the parser rejected", "Content-Length: 5\r\n\r\n"],
    ["a rejected section with a valid field in front of Content-Length", "X-Ok: 1\r\nContent-Length: 5\r\n\r\n"],
    [
      "a rejected section with a valid field in front of Transfer-Encoding",
      "X-Ok: 1\r\nTransfer-Encoding: chunked\r\n\r\n",
    ],
    ["a section that did not end", Buffer.alloc(199 * 6, "a: 1\r\n").toString()],
  ]) {
    test(name, async () => {
      assert.deepStrictEqual(await rawTrailersAtFin(section), []);
    });
  }

  // Node v26.3.0 gives the request the first 4 fields of this section. Node rejects the section from v26.5.1.
  bunOnlyTest("a rejected section with more fields than server.maxHeadersCount", async () => {
    assert.deepStrictEqual(await rawTrailersAtFin("A: 1\r\nB: 2\r\nC: 3\r\nD: 4\r\nE: 5\r\n\r\n", 4), []);
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (harness) {
  const node = harness.nodeExe();

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, "--v8-pool-size=1", fileURLToPath(import.meta.url)],
        env: { ...harness.bunEnv, UV_THREADPOOL_SIZE: "2" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
