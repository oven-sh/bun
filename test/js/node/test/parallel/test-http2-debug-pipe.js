'use strict';

// Instrumented copy of test-http2-compat-serverrequest-pipe.js to diagnose a
// darwin-aarch64-only timeout. Logs every lifecycle event and dumps stream
// state from a watchdog before the runner's 20s kill.

const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');
const fixtures = require('../common/fixtures');
const assert = require('assert');
const http2 = require('http2');
const fs = require('fs');

const t0 = Date.now();
const log = m => console.error(`[+${Date.now() - t0}ms] ${m}`);

const tmpdir = require('../common/tmpdir');
tmpdir.refresh();
const loc = fixtures.path('person-large.jpg');
const fn = tmpdir.resolve('http2-url-tests.js');
log(`src size = ${fs.statSync(loc).size}`);

const server = http2.createServer();
let serverReq, serverRes, serverDest, clientReq, clientStr, clientSession;

server.on('request', (req, res) => {
  serverReq = req;
  serverRes = res;
  log('server: request received');
  let bytes = 0;
  req.on('data', c => { bytes += c.length; });
  req.on('end', () => log(`server: req end (bytes=${bytes})`));
  req.on('aborted', () => log('server: req aborted'));
  req.on('error', e => log(`server: req error ${e}`));
  req.on('close', () => log('server: req close'));
  res.on('close', () => log('server: res close'));
  const dest = (serverDest = req.pipe(fs.createWriteStream(fn)));
  dest.on('error', e => log(`server: dest error ${e}`));
  dest.on('finish', () => {
    log('server: dest finish');
    assert.strictEqual(req.complete, true);
    assert.strictEqual(fs.readFileSync(loc).length, fs.readFileSync(fn).length);
    fs.unlinkSync(fn);
    res.end();
    log('server: res.end() called');
  });
});

server.listen(0, () => {
  const port = server.address().port;
  log(`server listening on ${port}`);
  const client = (clientSession = http2.connect(`http://localhost:${port}`));
  client.on('error', e => log(`client: session error ${e}`));
  client.on('goaway', (code, last) => log(`client: session goaway code=${code} last=${last}`));
  client.on('close', () => log('client: session close'));

  let remaining = 2;
  function maybeClose() {
    log(`maybeClose remaining=${remaining - 1}`);
    if (--remaining === 0) {
      server.close(() => log('server.close() completed'));
      client.close(() => log('client.close() completed'));
      log('server.close() + client.close() called');
    }
  }

  const req = (clientReq = client.request({ ':method': 'POST' }));
  req.on('response', () => log('client: response'));
  req.resume();
  req.on('end', () => { log('client: req end'); maybeClose(); });
  req.on('close', () => log('client: req close'));
  req.on('error', e => log(`client: req error ${e}`));
  const str = (clientStr = fs.createReadStream(loc));
  str.on('end', () => { log('client: str end'); maybeClose(); });
  str.on('error', e => log(`client: str error ${e}`));
  str.pipe(req);
  log('client: str.pipe(req) started');
});

const watchdog = setTimeout(() => {
  log('WATCHDOG: still alive after 15s, dumping state');
  const dump = (name, s) => {
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
  };
  dump('serverReq', serverReq);
  dump('serverRes', serverRes);
  dump('serverDest', serverDest);
  dump('clientReq', clientReq);
  dump('clientStr', clientStr);
  dump('clientSession', clientSession);
  try {
    log(`  clientSession.state: ${JSON.stringify(clientSession?.state)}`);
  } catch {}
  process.exit(7);
}, 15000);
watchdog.unref();
