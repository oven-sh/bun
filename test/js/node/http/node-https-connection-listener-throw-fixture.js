// An https server whose 'connection' listener throws, and one peer of it. Prints the events of
// that connection in order, and whether the peer read the response.
//
//   <runtime> node-https-connection-listener-throw-fixture.js <case>
//
// A case is a list of words that say what the listeners and the process do. Runs unchanged under
// Node.js. TLS_FIXTURE is the JSON of { cert, key }.
const http = require("node:http");
const https = require("node:https");
const tls = require("node:tls");
const { Worker, isMainThread, workerData } = require("node:worker_threads");

const kase = isMainThread ? (process.argv[2] ?? "") : workerData;
const has = word => kase.split("-").includes(word);

if (isMainThread && has("worker")) new Worker(__filename, { workerData: kase });
else run();

function run() {
  const options = JSON.parse(process.env.TLS_FIXTURE);
  const marks = [];
  let printed = false;
  const print = result => {
    if (printed) return;
    printed = true;
    console.log(JSON.stringify({ marks, ...result }));
  };
  const uncaught = error => {
    marks.push("uncaught:" + (error.code ?? error.message));
    if (has("exits")) process.exit(3);
  };
  if (has("monitor")) process.on("uncaughtExceptionMonitor", error => marks.push("monitor:" + error.message));
  if (has("handled")) process.on("uncaughtException", uncaught);
  if (has("captured")) process.setUncaughtExceptionCaptureCallback(uncaught);
  // Nothing takes the error, or the listener that takes it exits: the process ends before the peer closes.
  process.on("exit", exit => print({ exit }));

  const page = (req, res) => res.end("SECRET");
  // "listenTls" is a plain http.Server that gets its certificate in listen(). Only Bun has that.
  const server = has("listenTls")
    ? http.createServer(page)
    : https.createServer(has("fractionalHighWaterMark") ? { ...options, highWaterMark: 1.5 } : options, page);
  if (has("badTimeout")) server.timeout = -1;

  server.on("connection", socket => {
    marks.push("connection");
    if (has("ticks")) process.nextTick(() => marks.push("tick"));
    if (has("adds")) server.on("secureConnection", () => marks.push("secureConnection:added"));
    // "writes" is more than a TLS socket takes at once: the close of the socket waits for the rest.
    if (has("writes")) socket.write(Buffer.alloc(4 << 20, "-"));
    if (has("destroys")) socket.destroy();
    if (!has("quiet")) throw new Error("connection");
  });
  // An emit stops at the listener that throws.
  server.on("connection", () => marks.push("connection:second"));
  server.on("secureConnection", socket => {
    marks.push("secureConnection");
    if (has("secureThrows")) throw new Error("secureConnection");
    // The guard of this server: it refuses every peer, unless the case keeps them.
    if (!has("keeps")) socket.destroy();
  });

  const listening = () => {
    let read = "";
    const peer = tls.connect(
      { host: "127.0.0.1", port: server.address().port, ca: options.cert, servername: "localhost" },
      () => peer.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"),
    );
    peer.setEncoding("utf8").on("data", chunk => (read += chunk));
    // A refused peer can see a reset.
    peer.on("error", () => {});
    peer.on("close", () => {
      print({ served: read.includes("SECRET") });
      server.close();
    });
  };
  if (has("listenTls")) server.listen({ port: 0, host: "127.0.0.1", tls: options }, listening);
  else server.listen(0, "127.0.0.1", listening);
}
