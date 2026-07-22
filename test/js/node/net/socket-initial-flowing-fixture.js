"use strict";
const net = require("node:net");

// Poll via setImmediate so nothing touches the stream's flowing state
// ('readable' listeners flip flowing to false, which would mask the bug).
function waitFor(cond) {
  return new Promise(resolve => {
    const check = () => (cond() ? resolve() : setImmediate(check));
    check();
  });
}
function collect(socket, n) {
  return new Promise(resolve => {
    let got = "";
    socket.on("data", d => {
      got += d;
      if (got.length >= n) resolve(got);
    });
  });
}
function onceListening(server) {
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}
function onceConnect(socket) {
  return new Promise(resolve => socket.once("connect", resolve));
}

(async () => {
  // A: accepted socket, 'data' listener attached after the first bytes arrive
  {
    let acc;
    const server = net.createServer(s => {
      acc = s;
      s.on("error", () => {});
    });
    const port = await onceListening(server);
    const c = net.connect(port, "127.0.0.1");
    await onceConnect(c);
    c.write("hello-first-bytes");
    // readableFlowing === true with no listener means the bytes were already
    // discarded (the bug); exit the wait there so the broken build fails fast.
    await waitFor(
      () => acc && (acc.readableLength >= 17 || acc.readableFlowing === true || acc.readableEnded || acc.destroyed),
    );
    console.log("A flowing", acc.readableFlowing, "len", acc.readableLength);
    const got = await collect(acc, 17);
    console.log("A got", JSON.stringify(got));
    c.destroy();
    acc.destroy();
    server.close();
  }

  // B: pause() inside the 'connection' handler is honored
  {
    let acc;
    const server = net.createServer(s => {
      acc = s;
      s.pause();
      s.on("error", () => {});
    });
    const port = await onceListening(server);
    const c = net.connect(port, "127.0.0.1");
    await onceConnect(c);
    c.write("paused-bytes");
    await waitFor(() => acc);
    await new Promise(r => setImmediate(r));
    console.log("B flowing", acc.readableFlowing);
    const p = collect(acc, 12);
    acc.resume();
    console.log("B got", JSON.stringify(await p));
    c.destroy();
    acc.destroy();
    server.close();
  }

  // C: client socket, server speaks first before a 'data' listener is attached
  {
    let srvSock;
    const server = net.createServer(s => {
      srvSock = s;
      s.write("server-greeting");
      s.on("error", () => {});
    });
    const port = await onceListening(server);
    const c = net.connect(port, "127.0.0.1");
    c.on("error", () => {});
    await onceConnect(c);
    await waitFor(() => c.readableLength >= 15 || c.readableFlowing === true || c.readableEnded || c.destroyed);
    console.log("C flowing", c.readableFlowing, "len", c.readableLength);
    const got = await collect(c, 15);
    console.log("C got", JSON.stringify(got));
    c.destroy();
    srvSock?.destroy();
    server.close();
  }

  // E: pause() before connect on an IP literal still reaches 'connect'.
  // The EINPROGRESS semi-socket is stored as Connected, not Connecting, so
  // the pending-connect loop hold must cover it too. With nothing else
  // ref'd, a broken build exits here and D never runs.
  {
    const server = net.createServer(s => {
      s.on("error", () => {});
      s.unref();
    });
    const port = await onceListening(server);
    server.unref();
    const c = net.connect(port, "127.0.0.1").pause();
    await new Promise(r => c.once("connect", r));
    console.log("E connect fired, paused", c.isPaused());
    c.destroy();
    server.close();
  }

  // D: peer FINs with an unread payload; late 'data' listener still gets it
  {
    let acc;
    const server = net.createServer(s => {
      acc = s;
      s.on("error", () => {});
    });
    const port = await onceListening(server);
    const c = net.connect(port, "127.0.0.1");
    await onceConnect(c);
    c.end("final-payload");
    await waitFor(
      () => acc && (acc.readableLength >= 13 || acc.readableFlowing === true || acc.readableEnded || acc.destroyed),
    );
    console.log("D readableEnded", acc.readableEnded, "len", acc.readableLength);
    let got = "";
    let ended = false;
    acc.on("data", d => (got += d));
    acc.on("end", () => (ended = true));
    await waitFor(() => ended);
    console.log("D got", JSON.stringify(got), "ended", ended);
    acc.destroy();
    server.close();
  }
})().then(
  () => process.exit(0),
  err => {
    console.error(err?.stack || String(err));
    process.exit(1);
  },
);
