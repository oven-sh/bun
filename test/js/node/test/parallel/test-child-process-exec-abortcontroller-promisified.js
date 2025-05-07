// Modified to allow the abort error to have a 'stack' property

'use strict';
const common = require('../common');
const assert = require('assert');
const exec = require('child_process').exec;
const { promisify } = require('util');

const execPromisifed = promisify(exec);
const invalidArgTypeError = {
  code: 'ERR_INVALID_ARG_TYPE',
  name: 'TypeError'
};

const waitCommand = common.isWindows ?
  // `"` is forbidden for Windows paths, no need for escaping.
  `"${process.execPath}" -e "setInterval(()=>{}, 99)"` :
  'sleep 2m';

if(typeof Bun !== "undefined") {
  const ac = new AbortController();
  const signal = ac.signal;
  const promise = execPromisifed(waitCommand, { signal });
  promise.catch(common.mustCall(e => {
    assert.equal(e.name, 'AbortError');
    assert.ok(e.cause instanceof DOMException);
    assert.equal(e.cause.name, 'AbortError');
    assert.equal(e.cause.message, 'The operation was aborted.');
    assert.equal(e.cause.code, 20);
  }));
  ac.abort();
}else{
  const ac = new AbortController();
  const signal = ac.signal;
  const promise = execPromisifed(waitCommand, { signal });
  assert.rejects(promise, {
    name: 'AbortError',
    cause: new DOMException('This operation was aborted', 'AbortError'),
  }).then(common.mustCall());
  ac.abort();
}

{
  const err = new Error('boom');
  const ac = new AbortController();
  const signal = ac.signal;
  const promise = execPromisifed(waitCommand, { signal });
  assert.rejects(promise, {
    name: 'AbortError',
    cause: err
  }).then(common.mustCall());
  ac.abort(err);
}

{
  const ac = new AbortController();
  const signal = ac.signal;
  const promise = execPromisifed(waitCommand, { signal });
  assert.rejects(promise, {
    name: 'AbortError',
    cause: 'boom'
  }).then(common.mustCall());
  ac.abort('boom');
}

{
  assert.throws(() => {
    execPromisifed(waitCommand, { signal: {} });
  }, invalidArgTypeError);
}

{
  function signal() {}
  assert.throws(() => {
    execPromisifed(waitCommand, { signal });
  }, invalidArgTypeError);
}

{
  const signal = AbortSignal.abort(); // Abort in advance
  const promise = execPromisifed(waitCommand, { signal });

  assert.rejects(promise, { name: 'AbortError' })
        .then(common.mustCall());
}

{
  const err = new Error('boom');
  const signal = AbortSignal.abort(err); // Abort in advance
  const promise = execPromisifed(waitCommand, { signal });

  assert.rejects(promise, { name: 'AbortError', cause: err })
        .then(common.mustCall());
}

{
  const signal = AbortSignal.abort('boom'); // Abort in advance
  const promise = execPromisifed(waitCommand, { signal });

  assert.rejects(promise, { name: 'AbortError', cause: 'boom' })
        .then(common.mustCall());
}
