'use strict';
const common = require('../common');
const tmpdir = require('../common/tmpdir');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { it, describe, jest } = require('bun:test');
const data = 'foo';
let cnt = 0;

function nextFile() {
  return tmpdir.resolve(`${cnt++}.out`);
}

tmpdir.refresh();

describe('synchronous version', () => {
  it('validation', () => {
    for (const v of ['true', '', 0, 1, [], {}, Symbol()]) {
      assert.throws(() => {
        fs.writeFileSync(nextFile(), data, { flush: v });
      }, { code: 'ERR_INVALID_ARG_TYPE' });
    }
  });

  // it('performs flush', () => {
  //   const spy = jest.spyOn(fs, 'fsyncSync');
  //   const file = nextFile();
  //   fs.writeFileSync(file, data, { flush: true });
  //   const calls = spy.mock.calls;
  //   assert.strictEqual(calls.length, 1);
  //   assert.strictEqual(calls[0].result, undefined);
  //   assert.strictEqual(calls[0].error, undefined);
  //   assert.strictEqual(calls[0].arguments.length, 1);
  //   assert.strictEqual(typeof calls[0].arguments[0], 'number');
  //   assert.strictEqual(fs.readFileSync(file, 'utf8'), data);
  // });

  it('does not perform flush', () => {
    const spy = jest.spyOn(fs, 'fsyncSync');

    for (const v of [undefined, null, false]) {
      const file = nextFile();
      fs.writeFileSync(file, data, { flush: v });
      assert.strictEqual(fs.readFileSync(file, 'utf8'), data);
    }

    assert.strictEqual(spy.mock.calls.length, 0);
  });
});

describe('callback version', () => {
  it('validation', () => {
    for (const v of ['true', '', 0, 1, [], {}, Symbol()]) {
      assert.throws(() => {
        fs.writeFileSync(nextFile(), data, { flush: v });
      }, { code: 'ERR_INVALID_ARG_TYPE' });
    }
  });

  // Bun: fsync is called in native code, so it is not possible to spy on it
  // it('performs flush', async() => {
  //   const { promise, resolve: done } = Promise.withResolvers();
  //   const spy = jest.spyOn(fs, 'fsync');
  //   const file = nextFile();
  //   fs.writeFile(file, data, { flush: true }, common.mustSucceed(() => {
  //     const calls = spy.mock.calls;
  //     assert.strictEqual(calls.length, 1);
  //     assert.strictEqual(calls[0].result, undefined);
  //     assert.strictEqual(calls[0].error, undefined);
  //     assert.strictEqual(calls[0].arguments.length, 2);
  //     assert.strictEqual(typeof calls[0].arguments[0], 'number');
  //     assert.strictEqual(typeof calls[0].arguments[1], 'function');
  //     assert.strictEqual(fs.readFileSync(file, 'utf8'), data);
  //     done();
  //   }));
  //   return promise;
  // });

  it('does not perform flush', async () => {
    const { promise, resolve: done } = Promise.withResolvers();
    const values = [undefined, null, false];
    const spy = jest.spyOn(fs, 'fsync');
    let cnt = 0;

    for (const v of values) {
      const file = nextFile();

      fs.writeFile(file, data, { flush: v }, common.mustSucceed(() => {
        assert.strictEqual(fs.readFileSync(file, 'utf8'), data);
        cnt++;

        if (cnt === values.length) {
          assert.strictEqual(spy.mock.calls.length, 0);
          done();
        }
      }));
    }
    return promise;
  });
});

describe('promise based version', () => {
  it('validation', () => {
    for (const v of ['true', '', 0, 1, [], {}, Symbol()]) {
      assert.rejects(() => {
        return fsp.writeFile(nextFile(), data, { flush: v });
      }, { code: 'ERR_INVALID_ARG_TYPE' });
    }
  });

  it('success path', async () => {
    for (const v of [undefined, null, false, true]) {
      const file = nextFile();
      await fsp.writeFile(file, data, { flush: v });
      assert.strictEqual(await fsp.readFile(file, 'utf8'), data);
    }
  });
});
