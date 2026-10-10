// Collect Http2Stream#sentInfoHeaders at each point of a stream's life, on the client and on the
// server. Run as a script it prints the result as JSON: Node.js and Bun must agree on it.
const http2 = require("node:http2");

// Each row is the list of header blocks the server passes to additionalHeaders(), one call each.
const rows = {
  "/plain": [],
  "/invalid": [{ ":status": 103, "inv alid": "x" }],
  "/info-then-invalid": [{ ":status": 102 }, { ":status": 103, "inv alid": "x" }],
};

// JSON drops undefined, so spell it out. The copy keeps a later push out of an earlier snapshot.
const snapshot = value => (value === undefined ? "undefined" : JSON.parse(JSON.stringify(value)));

async function collect() {
  let serverSeen;
  let onServerStreamClose;
  const server = http2.createServer();
  server.on("stream", (stream, headers) => {
    const seen = (serverSeen = { onStream: snapshot(stream.sentInfoHeaders), additionalHeaders: [] });
    for (const block of rows[headers[":path"]]) {
      let result = "sent";
      try {
        stream.additionalHeaders(block);
      } catch (err) {
        result = err.code;
      }
      seen.additionalHeaders.push({ result, sentInfoHeaders: snapshot(stream.sentInfoHeaders) });
    }
    stream.respond({ ":status": 200 });
    seen.afterRespond = snapshot(stream.sentInfoHeaders);
    stream.on("close", () => {
      seen.atClose = snapshot(stream.sentInfoHeaders);
      onServerStreamClose();
    });
    stream.end("ok");
  });

  // One request on its own session. Resolves once the stream is closed on both sides.
  async function run(path) {
    const serverStreamClosed = new Promise(resolve => (onServerStreamClose = resolve));
    const { promise: clientStreamClosed, resolve, reject } = Promise.withResolvers();
    const client = http2.connect(`http://127.0.0.1:${server.address().port}`);
    try {
      client.on("error", reject);
      const req = client.request({ ":path": path });
      const clientSeen = { afterRequest: snapshot(req.sentInfoHeaders) };
      req.on("error", reject);
      req.on("close", () => {
        clientSeen.atClose = snapshot(req.sentInfoHeaders);
        resolve();
      });
      req.resume();
      req.end();
      await Promise.all([clientStreamClosed, serverStreamClosed]);
      return { path, client: clientSeen, server: serverSeen };
    } finally {
      client.close();
    }
  }

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const results = [];
    for (const path of Object.keys(rows)) results.push(await run(path));
    return results;
  } finally {
    server.close();
  }
}

module.exports = { collect };

if (require.main === module) {
  collect().then(results => console.log(JSON.stringify(results)));
}
