import { expect, test } from "bun:test";
import http from "node:http";
import util from "node:util";

// The own keys of a request, of a response and of a client's response, and the names util.inspect shows of them, as Node v25.6.0 lists them at the same places. A symbol is written "@" and its description.
// Bun keeps some of them elsewhere (on the prototype, behind an accessor) and has some of its own: the keys that both have come in Node's order.
const node = {
  request:
    "_events _readableState _maxListeners socket httpVersionMajor httpVersionMinor httpVersion complete rawHeaders rawTrailers joinDuplicateHeaders aborted upgrade url method statusCode statusMessage client _consuming _dumped @shapeMode @kCapture @kHeaders @kHeadersCount @kTrailers @kTrailersCount".split(
      " ",
    ),
  requestShown:
    "_events _readableState _maxListeners socket httpVersionMajor httpVersionMinor httpVersion complete rawHeaders rawTrailers joinDuplicateHeaders aborted upgrade url method statusCode statusMessage client _consuming _dumped".split(
      " ",
    ),
  response:
    "_events _eventsCount _maxListeners outputData outputSize writable destroyed _last chunkedEncoding shouldKeepAlive maxRequestsOnConnectionReached _defaultKeepAlive useChunkedEncodingByDefault sendDate _removedConnection _removedContLen _removedTE strictContentLength _contentLength _hasBody _trailer finished _headerSent _closed _header _keepAliveTimeout _onPendingData req _sent100 _expect_continue _maxRequestsPerSocket @shapeMode @kCapture @kBytesWritten @kNeedDrain @corked @kChunkedBuffer @kChunkedLength @kSocket @kOutHeaders @errored @kHighWaterMark @kRejectNonStandardBodyWrites @kUniqueHeaders".split(
      " ",
    ),
  responseShown:
    "_events _eventsCount _maxListeners outputData outputSize writable destroyed _last chunkedEncoding shouldKeepAlive maxRequestsOnConnectionReached _defaultKeepAlive useChunkedEncodingByDefault sendDate _removedConnection _removedContLen _removedTE strictContentLength _contentLength _hasBody _trailer finished _headerSent _closed _header _keepAliveTimeout _onPendingData req _sent100 _expect_continue _maxRequestsPerSocket".split(
      " ",
    ),
  answer:
    "_events _readableState _maxListeners socket httpVersionMajor httpVersionMinor httpVersion complete rawHeaders rawTrailers joinDuplicateHeaders aborted upgrade url method statusCode statusMessage client _consuming _dumped req _eventsCount @shapeMode @kCapture @kHeaders @kHeadersCount @kTrailers @kTrailersCount".split(
      " ",
    ),
  answerShown:
    "_events _readableState _maxListeners socket httpVersionMajor httpVersionMinor httpVersion complete rawHeaders rawTrailers joinDuplicateHeaders aborted upgrade url method statusCode statusMessage client _consuming _dumped req _eventsCount".split(
      " ",
    ),
};

const keysOf = (object: object) =>
  Reflect.ownKeys(object).map(key => (typeof key === "symbol" ? "@" + key.description : key));
const shownOf = (object: object) =>
  [...util.inspect(object, { depth: 0, breakLength: Infinity }).matchAll(/(?:\{ |, )([A-Za-z_$][\w$]*): /g)].map(
    match => match[1],
  );

test("the own keys of http messages come in Node's order", async () => {
  const ours: Record<string, string[]> = {};
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const server = http.createServer((request, response) => {
    ours.request = keysOf(request);
    ours.requestShown = shownOf(request);
    ours.response = keysOf(response);
    ours.responseShown = shownOf(response);
    response.end("ok");
  });
  server.listen(0, "127.0.0.1", () => {
    http
      .get({ port: (server.address() as { port: number }).port, host: "127.0.0.1", agent: false }, answer => {
        ours.answer = keysOf(answer);
        ours.answerShown = shownOf(answer);
        answer.resume();
        answer.on("end", () => server.close(() => resolve()));
      })
      .on("error", reject);
  });
  await promise;
  for (const [what, theirs] of Object.entries(node)) {
    expect({ what, keys: ours[what].filter(key => theirs.includes(key)) }).toEqual({
      what,
      keys: theirs.filter(key => ours[what].includes(key)),
    });
  }
});
