// Runs under node:test, so the same file runs on node (`node --test`) and on bun (`bun test`).
import assert from "node:assert";
import fs from "node:fs";
import net from "node:net";
import { finished } from "node:stream";
import { test } from "node:test";
import tls from "node:tls";

const key = fs.readFileSync(new URL("./fixtures/agent1-key.pem", import.meta.url));
const cert = fs.readFileSync(new URL("./fixtures/agent1-cert.pem", import.meta.url));

// A server wraps an accepted socket in a TLSSocket, then calls raw.end() on the socket it wrapped, before the
// handshake can start. Returns the ordered events of both sockets and how finished() settled the TLS socket.
async function rawEnd(when) {
  const events = [];
  const { promise, resolve } = Promise.withResolvers();
  // The 'close' of both sockets, and finished().
  let pending = 3;
  const settle = () => --pending === 0 && resolve();
  const server = net.createServer(raw => {
    const wrap = new tls.TLSSocket(raw, { isServer: true, key, cert });
    for (const [name, socket] of [
      ["raw", raw],
      ["tls", wrap],
    ]) {
      socket.on("end", () => events.push(`${name} end`));
      socket.on("error", err => events.push(`${name} error ${err.code}`));
      socket.on("close", () => {
        events.push(`${name} close`);
        settle();
      });
    }
    finished(wrap, err => {
      events.push(err ? `finished ${err.code}` : "finished ok");
      settle();
    });
    wrap.resume();
    if (when === "nextTick") process.nextTick(() => raw.end());
    else setImmediate(() => raw.end());
  });
  await new Promise(listening => server.listen(0, "127.0.0.1", listening));
  const peer = net.connect(server.address().port, "127.0.0.1");
  peer.on("error", () => {});
  peer.on("end", () => peer.end());
  peer.resume();
  await promise;
  peer.destroy();
  server.close();
  return events;
}

for (const when of ["nextTick", "setImmediate"]) {
  // Regression from #39066 and #42265: bun 1.4.2 and node settle finished() with no error.
  test(`finished() reports no error when raw.end() closes the socket a TLSSocket wraps, from ${when}`, async () => {
    const events = await rawEnd(when);
    assert.ok(events.includes("finished ok"), events.join(", "));
  });

  // node: TLSWrap owns the reads of the wrapped socket, so only the TLS socket reports the end of the stream.
  // bun 1.4.2 also reports it on the wrapped socket.
  test(`only the TLS socket reports 'end' when raw.end() closes the socket it wraps, from ${when}`, async () => {
    const events = await rawEnd(when);
    assert.ok(events.includes("tls end"), events.join(", "));
    assert.ok(!events.includes("raw end"), events.join(", "));
  });
}
