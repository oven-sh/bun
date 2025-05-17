'use strict';
require('../common');
const assert = require('assert');
const { Worker } = require('worker_threads');
const { test } = require('node:test');
const { once } = require('events');

const esmHelloWorld = `
    import worker from 'worker_threads';
    const foo: string = 'Hello, World!';
    worker.parentPort.postMessage(foo);
`;

const cjsHelloWorld = `
    const { parentPort } = require('worker_threads');
    const foo: string = 'Hello, World!';
    parentPort.postMessage(foo);
`;

const disableTypeScriptWarningFlag = '--disable-warning=ExperimentalWarning';

// Bun intentionally does not error on some cases this test expects to error (like CJS/ESM and TypeScript syntax)
const skipErrors = typeof Bun === 'object' ? { skip: true } : { skip: false };

test('Worker eval module typescript without input-type', async () => {
  const w = new Worker(esmHelloWorld, { eval: true, execArgv: [disableTypeScriptWarningFlag] });
  assert.deepStrictEqual(await once(w, 'message'), ['Hello, World!']);
});

test('Worker eval module typescript with --input-type=module-typescript', async () => {
  const w = new Worker(esmHelloWorld, { eval: true, execArgv: ['--input-type=module-typescript',
                                                               disableTypeScriptWarningFlag] });
  assert.deepStrictEqual(await once(w, 'message'), ['Hello, World!']);
});

test('Worker eval module typescript with --input-type=commonjs-typescript', skipErrors, async () => {
  const w = new Worker(esmHelloWorld, { eval: true, execArgv: ['--input-type=commonjs-typescript',
                                                               disableTypeScriptWarningFlag] });

  const [err] = await once(w, 'error');
  assert.strictEqual(err.name, 'SyntaxError');
  assert.match(err.message, /Cannot use import statement outside a module/);
});

test('Worker eval module typescript with --input-type=module', skipErrors, async () => {
  const w = new Worker(esmHelloWorld, { eval: true, execArgv: ['--input-type=module',
                                                               disableTypeScriptWarningFlag] });
  const [err] = await once(w, 'error');
  assert.strictEqual(err.name, 'SyntaxError');
  assert.match(err.message, /Missing initializer in const declaration/);
});

test('Worker eval commonjs typescript without input-type', async () => {
  const w = new Worker(cjsHelloWorld, { eval: true, execArgv: [disableTypeScriptWarningFlag] });
  assert.deepStrictEqual(await once(w, 'message'), ['Hello, World!']);
});

test('Worker eval commonjs typescript with --input-type=commonjs-typescript', async () => {
  const w = new Worker(cjsHelloWorld, { eval: true, execArgv: ['--input-type=commonjs-typescript',
                                                               disableTypeScriptWarningFlag] });
  assert.deepStrictEqual(await once(w, 'message'), ['Hello, World!']);
});

test('Worker eval commonjs typescript with --input-type=module-typescript', skipErrors, async () => {
  const w = new Worker(cjsHelloWorld, { eval: true, execArgv: ['--input-type=module-typescript',
                                                               disableTypeScriptWarningFlag] });
  const [err] = await once(w, 'error');
  assert.strictEqual(err.name, 'ReferenceError');
  assert.match(err.message, /require is not defined in ES module scope, you can use import instead/);
});
