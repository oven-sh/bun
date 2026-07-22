"use strict";
// onconnection's post-emit resume() previously stomped a pause() made inside
// the 'connection' handler: flowing went back to true with no listener, bytes
// were discarded, and the writer saw 'drain' against a paused peer.
const net = require("node:net");
const { once } = require("node:events");

function waitFor(cond) {
  return new Promise(resolve => {
    const check = () => (cond() ? resolve() : setImmediate(check));
    check();
  });
}

(async () => {
  let acc;
  const server = net.createServer();
  server.on("connection", s => {
    acc = s;
    s.on("error", () => {});
    s.pause();
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const cli = net.connect(server.address().port, "127.0.0.1");
  cli.on("error", () => {});
  await once(cli, "connect");
  await waitFor(() => acc);
  // readableFlowing must be false (the handler's pause()) now that the
  // handler has returned; before the fix it was flipped back to true.
  console.log("flowing", acc.readableFlowing);

  const chunk = Buffer.alloc(64 * 1024, 0x61);
  let writes = 0;
  let drains = 0;
  cli.on("drain", () => drains++);
  // Write until backpressure or an upper bound: with a paused peer the kernel
  // buffers should fill long before 4000 chunks.
  while (writes < 4000) {
    writes++;
    if (!cli.write(chunk)) break;
  }
  // Wait until either a 'drain' fires (the bug) or enough turns for the
  // kernel buffers to have settled without one.
  let turns = 0;
  await waitFor(() => drains > 0 || ++turns > 200);
  console.log("drainsWhilePaused", drains, "backpressured", writes < 4000);

  let got = 0;
  acc.on("data", d => (got += d.length));
  acc.resume();
  const want = writes * chunk.length;
  // If the bytes were already discarded (the bug) nothing more is coming;
  // bound the wait so the broken build reports false instead of hanging.
  let dturns = 0;
  await waitFor(() => got >= want || acc.destroyed || ++dturns > 2000);
  console.log("delivered", got === want);

  cli.destroy();
  acc.destroy();
  server.close();
})().then(
  () => process.exit(0),
  err => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  },
);
