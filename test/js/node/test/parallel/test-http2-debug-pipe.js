'use strict';

// Instrumented, looped copy of test-http2-compat-serverrequest-pipe.js to
// diagnose a darwin-aarch64-only timeout that reproduces under full-suite
// load but not in single runs. Repeats the scenario until a soft deadline;
// any iteration stalling >4s dumps state and exits 7.

const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');
const fixtures = require('../common/fixtures');
const assert = require('assert');
const http2 = require('http2');
const fs = require('fs');

const tmpdir = require('../common/tmpdir');
tmpdir.refresh();
const loc = fixtures.path('person-large.jpg');
const SOFT_DEADLINE_MS = 14_000;
const STALL_MS = 4_000;
const start = Date.now();
let iteration = 0;

function log(m) {
  console.error(`[iter ${iteration} +${Date.now() - start}ms] ${m}`);
}

function dump(name, s) {
  if (!s) return log(`  ${name}: <unset>`);
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
  log(`  ${name}: ${JSON.stringify(pick)}`);
}

function runOnce() {
  iteration++;
  const fn = tmpdir.resolve(`http2-pipe-${iteration}.bin`);
  const events = [];
  const ev = m => events.push(`+${Date.now() - start}ms ${m}`);

  const state = {};
  const server = http2.createServer();

  server.on('request', (req, res) => {
    state.serverReq = req;
    state.serverRes = res;
    ev('server: request');
    req.on('end', () => ev('server: req end'));
    req.on('error', e => ev(`server: req error ${e}`));
    const dest = (state.serverDest = req.pipe(fs.createWriteStream(fn)));
    dest.on('error', e => ev(`server: dest error ${e}`));
    dest.on('finish', () => {
      ev('server: dest finish');
      assert.strictEqual(req.complete, true);
      assert.strictEqual(fs.readFileSync(loc).length, fs.readFileSync(fn).length);
      fs.unlinkSync(fn);
      res.end();
      ev('server: res.end()');
    });
  });

  return new Promise(resolve => {
    const stall = setTimeout(() => {
      log('STALL detected, event trail:');
      for (const e of events) log(`  ${e}`);
      dump('serverReq', state.serverReq);
      dump('serverRes', state.serverRes);
      dump('serverDest', state.serverDest);
      dump('clientReq', state.clientReq);
      dump('clientStr', state.clientStr);
      dump('clientSession', state.clientSession);
      try {
        log(`  clientSession.state: ${JSON.stringify(state.clientSession?.state)}`);
      } catch {}
      process.exit(7);
    }, STALL_MS);
    stall.unref();

    server.listen(0, () => {
      const port = server.address().port;
      const client = (state.clientSession = http2.connect(`http://localhost:${port}`));
      client.on('error', e => ev(`client: session error ${e}`));
      client.on('goaway', (code, last) => ev(`client: goaway code=${code} last=${last}`));
      client.on('close', () => ev('client: session close'));

      let remaining = 2;
      let closesPending = 2;
      function closed() {
        if (--closesPending === 0) {
          clearTimeout(stall);
          resolve();
        }
      }
      function maybeClose() {
        ev(`maybeClose remaining=${remaining - 1}`);
        if (--remaining === 0) {
          server.close(() => { ev('server.close() completed'); closed(); });
          client.close(() => { ev('client.close() completed'); closed(); });
        }
      }

      const req = (state.clientReq = client.request({ ':method': 'POST' }));
      req.on('response', () => ev('client: response'));
      req.resume();
      req.on('end', () => { ev('client: req end'); maybeClose(); });
      req.on('error', e => ev(`client: req error ${e}`));
      const str = (state.clientStr = fs.createReadStream(loc));
      str.on('end', () => { ev('client: str end'); maybeClose(); });
      str.on('error', e => ev(`client: str error ${e}`));
      str.pipe(req);
      ev('client: pipe started');
    });
  });
}

(async () => {
  while (Date.now() - start < SOFT_DEADLINE_MS) {
    await Promise.all([runOnce(), runOnce(), runOnce()]);
  }
  console.error(`completed ${iteration} iterations without a stall`);
})();
