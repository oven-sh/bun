import { expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";

const namesOf = (value: object) =>
  Reflect.ownKeys(value).map(key => (typeof key === "symbol" ? `Symbol(${key.description})` : key));

const beforeTheStream = ["_consuming", "_dumped", "complete", "_closed", "rawTrailers"];
const ofTheStream = ["_events", "_readableState", "_maxListeners"];
const ofAMessageWithoutAServer = [
  "socket",
  "httpVersionMajor",
  "httpVersionMinor",
  "httpVersion",
  "joinDuplicateHeaders",
  "upgrade",
  "url",
  "method",
  "statusCode",
  "statusMessage",
  "client",
];
const symbolsBeforeTheStream = [
  "Symbol(aborted)",
  "Symbol(eofInProgress)",
  "Symbol(kHeaders)",
  "Symbol(kReqShouldKeepAlive)",
  "Symbol(kRawHeaders)",
  "Symbol(kHeaderSource)",
  "Symbol(kHeadersCount)",
  "Symbol(kTrailers)",
  "Symbol(kTrailersCount)",
  "Symbol(kAbortController)",
];
const symbolsOfTheStream = ["Symbol(shapeMode)", "Symbol(kCapture)"];

test("own keys of a new http.IncomingMessage", () => {
  const expected = [
    ...beforeTheStream,
    ...ofTheStream,
    ...ofAMessageWithoutAServer,
    ...symbolsBeforeTheStream,
    ...symbolsOfTheStream,
    "Symbol(noBody)",
  ];
  expect(namesOf(new http.IncomingMessage(new net.Socket()))).toEqual(expected);
  // @ts-expect-error the socket is left out
  expect(namesOf(new http.IncomingMessage())).toEqual(expected);
});

test("own keys of a server's request and a client's response", async () => {
  const { promise, resolve } = Promise.withResolvers<string[]>();
  const server = http.createServer((request, response) => {
    resolve(namesOf(request));
    response.end("ok");
  });
  try {
    await once(server.listen(0), "listening");
    const [response] = (await once(http.get({ port: (server.address() as AddressInfo).port }), "response")) as [
      http.IncomingMessage,
    ];
    const ofTheResponse = namesOf(response);
    response.resume();
    await once(response, "end");

    expect(await promise).toEqual([
      ...beforeTheStream,
      "url",
      "method",
      "socket",
      "client",
      "upgrade",
      ...ofTheStream,
      ...symbolsBeforeTheStream,
      "Symbol(handle)",
      "Symbol(noBody)",
      ...symbolsOfTheStream,
    ]);
    expect(ofTheResponse).toEqual([
      ...beforeTheStream,
      ...ofTheStream,
      ...ofAMessageWithoutAServer,
      "req",
      "_eventsCount",
      ...symbolsBeforeTheStream,
      ...symbolsOfTheStream,
      "Symbol(noBody)",
    ]);
  } finally {
    server.close();
  }
});
