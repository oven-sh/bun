'use strict';
const common = require('../common');
const tmpdir = require('../common/tmpdir');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { test, describe, jest } = require('bun:test');
const data = 'foo';
let cnt = 0;

function nextFile() {
  return tmpdir.resolve(`${cnt++}.out`);
}

tmpdir.refresh();

test('validation', () => {
  for (const flush of ['true', '', 0, 1, [], {}, Symbol()]) {
    assert.throws(() => {
      fs.createWriteStream(nextFile(), { flush });
    }, { code: 'ERR_INVALID_ARG_TYPE' });
  }
});

test('performs flush', () => {
  jest.restoreAllMocks();
  const { promise, resolve: done } = Promise.withResolvers();
  const spy = jest.spyOn(fs, 'fsync');
  const file = nextFile();
  const stream = fs.createWriteStream(file, { flush: true });

  stream.write(data, common.mustSucceed(() => {
    stream.close(common.mustSucceed(() => {
      const calls = spy.mock.calls;
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].length, 2);
      assert.strictEqual(typeof calls[0][0], 'number');
      assert.strictEqual(typeof calls[0][1], 'function');
      assert.strictEqual(fs.readFileSync(file, 'utf8'), data);
      done();
    }));
  }));
  return promise;
});

test('does not perform flush', () => {
  jest.restoreAllMocks();
  const { promise, resolve: done } = Promise.withResolvers();
  const values = [undefined, null, false];
  const spy = jest.spyOn(fs, 'fsync');
  let cnt = 0;

  for (const flush of values) {
    const file = nextFile();
    const stream = fs.createWriteStream(file, { flush });

    stream.write(data, common.mustSucceed(() => {
      stream.close(common.mustSucceed(() => {
        assert.strictEqual(fs.readFileSync(file, 'utf8'), data);
        cnt++;

        if (cnt === values.length) {
          assert.strictEqual(spy.mock.calls.length, 0);
          done();
        }
      }));
    }));
  }
  return promise;
});

test('works with file handles', async () => {
  const file = nextFile();
  const handle = await fsp.open(file, 'w');
  const stream = handle.createWriteStream({ flush: true });

  return new Promise((resolve) => {
    stream.write(data, common.mustSucceed(() => {
      stream.close(common.mustSucceed(() => {
        assert.strictEqual(fs.readFileSync(file, 'utf8'), data);
        resolve();
      }));
    }));
  });
});
