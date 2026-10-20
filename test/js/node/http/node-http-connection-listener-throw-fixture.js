// A node:http server whose 'connection' or 'secureConnection' listener fails, and the peers of
// that server. The peers live in this process (the driver), which outlives the server: it prints
// what each peer read, how often the request listener ran and how the server ended.
//
//   <runtime> node-http-connection-listener-throw-fixture.js [worker:|hot:|watch:]<server case>
//
// A server case is a list of words: http or https, then what the listener and the process do.
// Runs unchanged under Node.js, except with --hot and --watch. The https cases read TLS_FIXTURE,
// the JSON of { cert, key }.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

// Neither process outlives a test that gave up on it.
let onDeadline = () => process.exit(124);
setTimeout(() => onDeadline(), 60_000).unref();

const REQUEST = "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n";
const REFUSAL = "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n";
const [mode, serverCase] = splitCase(process.env.LISTENER_THROW_SERVER ?? "");

if (!isMainThread) server(workerData, port => parentPort.postMessage(port));
else if (mode === "worker") serverInWorker(serverCase);
else if (serverCase) server(serverCase, port => console.log("PORT " + port));
else driver(process.argv[2]);

function splitCase(name) {
  return name.includes(":") ? name.split(":") : ["run", name];
}

function server(kase, announce) {
  const has = word => kase.split("-").includes(word);
  const handled = has("handled") || has("captured");
  const page = (req, res) => {
    console.log("REQUEST");
    res.end("SECRET", () => handled && srv.close());
  };
  const secure = has("https") && {
    ...JSON.parse(process.env.TLS_FIXTURE),
    // With TLS 1.2 the request is not in the read that ends the handshake.
    ...(has("tls12") && { maxVersion: "TLSv1.2" }),
  };
  const srv = secure ? https.createServer(secure, page) : http.createServer(page);

  const fail = () => {
    throw new Error("PEER REFUSED");
  };
  srv.on(has("secureConnection") ? "secureConnection" : "connection", socket => {
    // With --hot and --watch the process goes on after the error. It says so, and the driver stops it.
    if (process.env.LISTENER_THROW_ALIVE) setImmediate(() => console.log("ALIVE"));
    if (has("destroys")) return socket.on("close", () => srv.close()).destroy();
    // "big" is more than the socket takes at once. The "unread" peer takes nothing of it, and
    // the close of a TLS socket then waits for what is not sent, with the request behind it.
    if (has("writes")) socket.write(has("big") ? Buffer.alloc(4 << 20, "-") : REFUSAL);
    if (has("destroyed")) socket.destroy();
    if (has("ends")) socket.end(REFUSAL);
    // An immediate keeps the loop turning after the error.
    if (has("immediate")) setImmediate(() => {});
    if (has("nextTick")) return process.nextTick(fail);
    if (has("queueMicrotask")) return queueMicrotask(fail);
    fail();
  });

  if (has("monitor")) process.on("uncaughtExceptionMonitor", () => {});
  if (has("handled")) process.on("uncaughtException", () => {});
  if (has("captured")) process.setUncaughtExceptionCaptureCallback(() => {});
  if (has("exits")) process.on("uncaughtException", () => process.exit(3));

  srv.listen(0, "127.0.0.1", () => {
    announce(srv.address().port);
    // Hold this turn of the loop until the driver has its peers in the accept queue: the next
    // turn finds all of them. The read ends with nothing when the driver is gone.
    if (fs.readSync(0, Buffer.alloc(1)) === 0) process.exit(125);
  });
}

function serverInWorker(kase) {
  const worker = new Worker(__filename, { workerData: kase });
  worker.on("message", port => console.log("PORT " + port));
  // The error that ends the Worker. The process ends behind it, with 0.
  worker.on("error", () => {});
}

async function driver(name) {
  const [mode, kase] = splitCase(name);
  const has = word => kase.split("-").includes(word);
  const watching = mode === "hot" || mode === "watch";
  const child = spawn(process.execPath, watching ? ["--" + mode, __filename] : [__filename], {
    env: { ...process.env, LISTENER_THROW_SERVER: name, ...(watching && { LISTENER_THROW_ALIVE: "1" }) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  process.on("exit", () => child.kill());
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", chunk => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", chunk => (stderr += chunk));
  const exited = new Promise(resolve => child.on("close", (code, signal) => resolve(signal ?? code)));
  // When the driver cannot go on, the test gets what the server printed.
  const giveUp = why => {
    process.stderr.write(`${name}: ${why}\n--- stdout of the server\n${stdout}\n--- stderr of the server\n${stderr}\n`);
    process.exit(1);
  };
  onDeadline = () => giveUp("the case did not finish");
  const printed = async line => {
    while (!line.test(stdout)) {
      const more = new Promise(resolve => child.stdout.once("data", resolve));
      const ended = await Promise.race([more, exited.then(() => true)]);
      if (ended === true && !line.test(stdout)) giveUp(`the server ended before it printed ${line}`);
    }
    return line.exec(stdout);
  };
  const port = +(await printed(/^PORT (\d+)$/m))[1];

  const secure = has("https");
  // "unread": the peer reads nothing until the server is done with it. Only a socket with
  // onread stops its reads at once when it is paused.
  const unread = has("unread");
  const peers = Array.from({ length: name === "http" ? 2 : 1 }, () => {
    const peer = { read: "" };
    const onread = {
      buffer: Buffer.alloc(1 << 16),
      callback: (length, buffer) => {
        peer.read += buffer.latin1Slice(0, length);
        return true;
      },
    };
    const socket = secure
      ? tls.connect(
          {
            host: "127.0.0.1",
            port,
            ca: JSON.parse(process.env.TLS_FIXTURE).cert,
            servername: "localhost",
            ...(unread && { onread }),
          },
          () => {
            if (unread) socket.pause();
            socket.write(REQUEST);
          },
        )
      : net.connect(port, "127.0.0.1");
    // In the accept queue: the TCP handshake is done and, without TLS, the request is sent.
    peer.queued = new Promise(resolve =>
      socket.once("connect", () => {
        peer.connected = true;
        if (secure) resolve();
        else socket.write(REQUEST, resolve);
      }),
    );
    peer.closed = new Promise(resolve => socket.on("close", resolve));
    if (!unread) socket.setEncoding("utf8").on("data", chunk => (peer.read += chunk));
    // After the connect, an error is how a refused peer sees the close of the server.
    socket.on("error", error => peer.connected || giveUp("a peer did not connect: " + error.code));
    peer.socket = socket;
    return peer;
  });
  await Promise.all(peers.map(peer => peer.queued));
  child.stdin.end("go");
  if (unread) {
    await (watching ? printed(/^ALIVE$/m) : exited);
    for (const peer of peers) peer.socket.resume();
  }
  await Promise.all(peers.map(peer => peer.closed));
  if (watching) {
    await printed(/^ALIVE$/m);
    child.kill();
  }

  const exit = await exited;
  console.log(
    JSON.stringify({
      requests: stdout.split("\n").filter(line => line === "REQUEST").length,
      served: peers.filter(peer => peer.read.includes("SECRET")).length,
      read: peers.map(peer => peer.read.length),
      exit,
    }),
  );
}
