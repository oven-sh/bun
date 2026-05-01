'use strict';
const common = require('../common');
const assert = require('assert');
const { Worker } = require('worker_threads');

const tmpdir = require('../common/tmpdir');
tmpdir.refresh();
const missing = tmpdir.resolve('does-not-exist.js');

const worker = new Worker(missing);

worker.on('error', common.mustCall((err) => {
  // eslint-disable-next-line node-core/no-unescaped-regexp-dot
  // BUN: this error comes from our bundler where it'd be impractical to rewrite all the errors to match Node
  assert.match(err.message, /(Cannot find module|ModuleNotFound) .+does-not-exist.js/);
}));
