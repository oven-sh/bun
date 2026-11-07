'use strict';
const common = require('../common');
const assert = require('assert');
const child_process = require('child_process');
const fixtures = require('../common/fixtures');

const wrong_script = fixtures.path('keys/rsa_cert.crt');

const p = child_process.spawn(process.execPath, [
  '-e',
  'require(process.argv[1]);',
  wrong_script,
]);

p.stdout.on('data', common.mustNotCall());

let output = '';

p.stderr.on('data', (data) => output += data);

p.stderr.on('end', common.mustCall(() => {
  // Bun colorizes its error dump when FORCE_COLOR is set even though stderr
  // is a pipe (Node's caret dump stays plain); strip ANSI escapes so the
  // line-shape assertions below hold in colored environments too.
  output = output.replace(/\u001b\[[0-9;]*m/g, '');
  assert.match(output, /BEGIN CERT/);
  assert.match(output, /^\s+\^/m);
  // V8 fails parsing `-----BEGIN` with "Invalid left-hand side expression in
  // prefix operation"; Bun's transpiler reports its own parse error for the
  // same source.
  const syntaxErrorRE = typeof Bun === 'undefined'
    ? /Invalid left-hand side expression in prefix operation/
    : /Expected ";" but found "CERTIFICATE"/;
  assert.match(output, syntaxErrorRE);
}));
