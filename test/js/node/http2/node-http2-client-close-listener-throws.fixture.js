// Fixture of node-http2-client-close.test.ts. A listener that throws is an uncaught exception, in
// node too. This process handles it, and shows that the request queue of the session goes on.
// The server allows one stream, and "/hold" has it. Prints one line of JSON.
const http2 = require("node:http2");

const uncaught = [];
process.on("uncaughtException", err => uncaught.push(err.message));
// A queue that stops keeps this process alive. It must not outlive the test run by much.
setTimeout(() => process.exit(1), 60_000).unref();

const server = http2.createServer({ settings: { maxConcurrentStreams: 1 } });
const seen = [];
const { promise: holding, resolve: gotHold } = Promise.withResolvers();
server.on("stream", (stream, headers) => {
  stream.on("error", () => {});
  seen.push(headers[":path"]);
  if (headers[":path"] === "/hold") return gotHold(stream);
  stream.respond({ ":status": 200 });
  stream.end();
});

server.listen(0, "127.0.0.1", async () => {
  const client = http2.connect(`http://127.0.0.1:${server.address().port}`);
  client.on("error", () => {});
  await new Promise(resolve => client.once("remoteSettings", resolve));
  client
    .request({ ":path": "/hold" })
    .on("error", () => {})
    .resume();
  const held = await holding;

  // The request is reset while it waits. Its 'readable' listener runs when the request closes.
  const waiting = client.request({ ":path": "/waiting" });
  waiting.on("error", () => {});
  waiting.on("readable", () => {
    throw new Error("readable listener");
  });
  waiting.close();
  const last = client.request({ ":path": "/last" });
  last.on("error", () => {}).resume();
  const answered = new Promise(resolve => last.on("close", resolve));
  held.respond({ ":status": 200 });
  held.end();
  await answered;

  client.destroy();
  server.close();
  console.log(JSON.stringify({ seen, uncaught }));
});
