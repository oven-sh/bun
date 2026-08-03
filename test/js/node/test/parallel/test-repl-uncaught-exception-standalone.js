'use strict';
const common = require('../common');
const assert = require('assert');
const cp = require('child_process');
// bun: upstream uses '-i'; that short flag is --install=fallback in bun, so the
// REPL is reached through the long form.
const child = cp.spawn(process.execPath, ['--interactive']);
let output = '';

child.stdout.setEncoding('utf8');
child.stdout.on('data', (data) => {
  output += data;
});

child.on('exit', common.mustCall(() => {
  const results = output.split('\n');
  results.shift();
  assert.deepStrictEqual(
    results,
    [
      'Type ".help" for more information.',
      // x\n
      '> Uncaught ReferenceError: x is not defined',
      // Added `uncaughtException` listener.
      '> short',
      'undefined',
      // x\n
      '> Foobar',
      '> ',
    ]
  );
}));

child.stdin.write('x\n');
child.stdin.write(
  'process.on("uncaughtException", () => console.log("Foobar"));' +
  'console.log("short")\n');
child.stdin.write('x\n');
child.stdin.end();
