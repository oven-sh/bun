'use strict';

const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');
const fixtures = require('../common/fixtures');
const assert = require('assert');
const http2 = require('http2');
const fs = require('fs');

// Piping should work as expected with createWriteStream
// DEBUG BRANCH: instrumented with an event trail + stall watchdog to diagnose
// a darwin-aarch64 suite-context timeout. Logic is unchanged from upstream.

const t0 = Date.now();
const events = [];
const ev = m => events.push(`+${Date.now() - t0}ms ${m}`);
const state = {};

const watchdog = setTimeout(() => {
  console.error('WATCHDOG: stalled after 15s, event trail:');
  for (const e of events) console.error(`  ${e}`);
  const dump = (name, s) => {
    if (!s) return console.error(`  ${name}: <unset>`);
    const pick = {};
    for (const k of [
      'readable', 'readableEnded', 'readableFlowing', 'readableLength',
      'writable', 'writableEnded', 'writableFinished', 'writableLength', 'writableNeedDrain',
      'destroyed', 'closed', 'complete', 'aborted', 'rstCode', 'pending', 'bytesWritten',
    ]) {
      try {
        const v = s[k];
        if (v !== undefined) pick[k] = v;
      } catch {}
    }
    console.error(`  ${name}: ${JSON.stringify(pick)}`);
  };
  dump('serverSock', state.serverSock);
  dump('serverSession', state.serverSession);
  try { console.error(`  server._connections: ${server._connections}`); } catch {}
  dump('serverReq', state.serverReq);
  dump('serverRes', state.serverRes);
  dump('serverDest', state.serverDest);
  dump('clientReq', state.clientReq);
  dump('clientStr', state.clientStr);
  dump('clientSock', state.clientSock);
  dump('clientSession', state.clientSession);
  try {
    console.error(`  clientSession.state: ${JSON.stringify(state.clientSession?.state)}`);
  } catch {}
  process.exit(7);
}, 15000);
watchdog.unref();

const tmpdir = require('../common/tmpdir');
tmpdir.refresh();
const loc = fixtures.path('person-large.jpg');
const fn = tmpdir.resolve('http2-url-tests.js');

// Plain-net same-tick write+end EOF delivery probe (mirrors the h2 client's
// GOAWAY+GOAWAY+FIN burst at the socket level).
const net = require('net');
{
  const ns = net.createServer(sock => {
    sock.on('data', d => ev(`net-probe: server data ${d.length}`));
    sock.on('end', () => ev('net-probe: server end'));
    sock.on('close', () => { ev('net-probe: server close'); ns.close(); });
  });
  ns.listen(0, () => {
    const c = net.connect(ns.address().port, '127.0.0.1', () => {
      c.write(Buffer.alloc(17));
      c.write(Buffer.alloc(17));
      c.end();
    });
    c.on('close', () => ev('net-probe: client close'));
  });
}

const server = http2.createServer();

server.on('connection', sock => {
  state.serverSock = sock;
  ev('server: connection');
  sock.on('end', () => ev('server: socket end'));
  sock.on('close', () => ev('server: socket close'));
  sock.on('error', e => ev('server: socket error ' + e));
});
server.on('session', session => {
  state.serverSession = session;
  ev('server: session');
  session.on('close', () => ev('server: session close'));
  session.on('goaway', (c, l) => ev('server: session goaway code=' + c + ' last=' + l));
  session.on('error', e => ev('server: session error ' + e));
});

server.on('request', common.mustCall((req, res) => {
  state.serverReq = req;
  state.serverRes = res;
  ev('server: request');
  req.on('end', () => ev('server: req end'));
  req.on('error', e => ev(`server: req error ${e}`));
  const dest = (state.serverDest = req.pipe(fs.createWriteStream(fn)));
  dest.on('error', e => ev(`server: dest error ${e}`));
  dest.on('finish', common.mustCall(() => {
    ev('server: dest finish');
    assert.strictEqual(req.complete, true);
    assert.strictEqual(fs.readFileSync(loc).length, fs.readFileSync(fn).length);
    fs.unlinkSync(fn);
    res.end();
    ev('server: res.end()');
  }));
}));

server.listen(0, common.mustCall(() => {
  const port = server.address().port;
  const client = (state.clientSession = http2.connect(`http://localhost:${port}`));
  client.on('connect', () => {
    const cs = (state.clientSock = client.socket);
    ev('client: connected');
    cs.on('end', () => ev('client: socket end'));
    cs.on('close', () => ev('client: socket close'));
    cs.on('finish', () => ev('client: socket finish'));
  });
  client.on('error', e => ev(`client: session error ${e}`));
  client.on('goaway', (code, last) => ev(`client: goaway code=${code} last=${last}`));
  client.on('close', () => ev('client: session close'));

  let remaining = 2;
  function maybeClose() {
    ev(`maybeClose remaining=${remaining - 1}`);
    if (--remaining === 0) {
      server.close(() => ev('server.close() completed'));
      client.close(() => ev('client.close() completed'));
    }
  }

  const req = (state.clientReq = client.request({ ':method': 'POST' }));
  req.on('response', common.mustCall(() => ev('client: response')));
  req.resume();
  req.on('end', common.mustCall(() => { ev('client: req end'); maybeClose(); }));
  req.on('error', e => ev(`client: req error ${e}`));
  const str = (state.clientStr = fs.createReadStream(loc));
  str.on('end', common.mustCall(() => { ev('client: str end'); maybeClose(); }));
  str.on('error', e => ev(`client: str error ${e}`));
  str.pipe(req);
  ev('client: pipe started');
}));
