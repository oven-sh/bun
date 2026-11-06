// What `fetch()` and `ws` make of a response for every verdict and quirk of the parser, as recorded with the last Bun
// that read responses with picohttpparser. See record.ts.
import { http1Internals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import {
  clients,
  observed,
  recordedPath,
  responses,
  type Client,
  type Delivery,
  type Part,
  type Recorded,
} from "./observe";

const recorded: Recorded = await Bun.file(recordedPath).json();

// Not concurrent, and a few dozen responses per test: a connection takes 20 ms in a debug build.
describe.each<[Client, Part, Delivery]>([
  ["fetch", "heads", "in one write"],
  ["fetch", "heads", "in small pieces"],
  ["fetch", "bodies", "in one write"],
  ["fetch", "bodies", "in small pieces"],
  ["ws", "heads", "in one write"],
  ["ws", "heads", "in small pieces"],
  ["ws", "bodies", "in one write"],
  ["ws", "bodies", "in small pieces"],
])("%s: %s %s", (client, part, delivery) => {
  const perTest = 48;
  const starts = Array.from({ length: Math.ceil(responses[part].length / perTest) }, (_, i) => i * perTest);

  test("there is a recorded result for every response and no other", () => {
    expect(responses[part].length).toBeGreaterThan(90);
    expect(Object.keys(recorded[client][part])).toEqual(responses[part].map(([label]) => label));
  });

  test.each(starts)("from %d", async start => {
    const cases = responses[part].slice(start, start + perTest);
    const expected = Object.fromEntries(cases.map(([label]) => [label, recorded[client][part][label]]));
    expect(await observed(client, cases, delivery)).toEqual(expected);
  });
});

// Parsing all that has come after each of the 40 reads would read every byte 20 times.
test.each<[Client, number]>([
  ["fetch", 400_000],
  ["ws", 16_000],
])("%s does not start over with every read of a head of %d bytes", async (client, length) => {
  const head = `HTTP/1.1 200 OK\r\nContent-Length: 0\r\nx: ${Buffer.alloc(length, "v")}\r\n\r\n`;
  const inOneWrite = await observed(client, [["long", head]], "in one write");

  const before = http1Internals.headBytesRead();
  let last = before;
  // Every read counts, because none leaves `fetch` with the fewer than 16 bytes that it does not look at.
  const isRead = () => last !== (last = http1Internals.headBytesRead());
  expect(await observed(client, [["long", head]], "in small pieces", isRead)).toEqual(inOneWrite);
  expect(inOneWrite.long).toStartWith(client === "fetch" ? "200 " : "1.1 200 ");
  expect((http1Internals.headBytesRead() - before) / head.length).toBeLessThan(3);
});

test("fetch reads a head that comes whole once", async () => {
  const head = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n";
  const before = http1Internals.headBytesRead();
  expect(await observed("fetch", [["whole", head + "ok"]], "in one write")).toEqual({
    whole: '200 "OK" [["connection","close"],["content-length","2"]] 6f6b',
  });
  expect(http1Internals.headBytesRead() - before).toBe(head.length);
});

// The server sends neither the end of the head nor anything else after the bad byte, and leaves the connection open.
test.each<[Client, string]>([
  ["fetch", "Malformed_HTTP_Response"],
  ["ws", "Parse Error: Expected HTTP/, RTSP/ or ICE/"],
])("%s refuses a malformed head at the read that brings the bad byte", async (client, error) => {
  let closed = false;
  using server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      async data(socket) {
        for (const piece of ["HTTP/1.1 200 OK\r\nname: value", " goes on", " and \0n"]) {
          const before = http1Internals.headBytesRead();
          socket.write(piece);
          while (!closed && http1Internals.headBytesRead() === before) await new Promise(setImmediate);
        }
      },
      close() {
        closed = true;
      },
    },
  });
  expect(await clients[client](`${client === "ws" ? "ws" : "http"}://127.0.0.1:${server.port}/`)).toBe(error);
});
