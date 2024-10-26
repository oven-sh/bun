//#FILE: test-stream2-set-encoding.js
//#SHA1: f3fb880c635bcee2cb32a346f6ca00266d10d43b
//-----------------
'use strict';
const { Readable } = require('stream');

class TestReader extends Readable {
  constructor(n, opts) {
    super(opts);
    this.pos = 0;
    this.len = n || 100;
  }

  _read(n) {
    setTimeout(() => {
      if (this.pos >= this.len) {
        // Double push(null) to test eos handling
        this.push(null);
        return this.push(null);
      }

      n = Math.min(n, this.len - this.pos);
      if (n <= 0) {
        // Double push(null) to test eos handling
        this.push(null);
        return this.push(null);
      }

      this.pos += n;
      const ret = Buffer.alloc(n, 'a');

      return this.push(ret);
    }, 1);
  }
}

describe('Stream2 Set Encoding', () => {
  test('Verify utf8 encoding', (done) => {
    const tr = new TestReader(100);
    tr.setEncoding('utf8');
    const out = [];
    const expectedOutput = Array(10).fill('aaaaaaaaaa');

    tr.on('readable', function flow() {
      let chunk;
      while (null !== (chunk = tr.read(10)))
        out.push(chunk);
    });

    tr.on('end', () => {
      expect(out).toEqual(expectedOutput);
      done();
    });
  }, 10000);

  test('Verify hex encoding', (done) => {
    const tr = new TestReader(100);
    tr.setEncoding('hex');
    const out = [];
    const expectedOutput = Array(20).fill('6161616161');

    tr.on('readable', function flow() {
      let chunk;
      while (null !== (chunk = tr.read(10)))
        out.push(chunk);
    });

    tr.on('end', () => {
      expect(out).toEqual(expectedOutput);
      done();
    });
  }, 10000);

  test('Verify hex encoding with read(13)', (done) => {
    const tr = new TestReader(100);
    tr.setEncoding('hex');
    const out = [];
    const expectedOutput = [
      '6161616161616',
      '1616161616161',
      '6161616161616',
      '1616161616161',
      '6161616161616',
      '1616161616161',
      '6161616161616',
      '1616161616161',
      '6161616161616',
      '1616161616161',
      '6161616161616',
      '1616161616161',
      '6161616161616',
      '1616161616161',
      '6161616161616',
      '16161'
    ];

    tr.on('readable', function flow() {
      let chunk;
      while (null !== (chunk = tr.read(13)))
        out.push(chunk);
    });

    tr.on('end', () => {
      expect(out).toEqual(expectedOutput);
      done();
    });
  }, 10000);

  test('Verify base64 encoding', (done) => {
    const tr = new TestReader(100);
    tr.setEncoding('base64');
    const out = [];
    const expectedOutput = [
      'YWFhYWFhYW',
      'FhYWFhYWFh',
      'YWFhYWFhYW',
      'FhYWFhYWFh',
      'YWFhYWFhYW',
      'FhYWFhYWFh',
      'YWFhYWFhYW',
      'FhYWFhYWFh',
      'YWFhYWFhYW',
      'FhYWFhYWFh',
      'YWFhYWFhYW',
      'FhYWFhYWFh',
      'YWFhYWFhYW',
      'FhYQ=='
    ];

    tr.on('readable', function flow() {
      let chunk;
      while (null !== (chunk = tr.read(10)))
        out.push(chunk);
    });

    tr.on('end', () => {
      expect(out).toEqual(expectedOutput);
      done();
    });
  }, 10000);

  test('Verify utf8 encoding with options', (done) => {
    const tr = new TestReader(100, { encoding: 'utf8' });
    const out = [];
    const expectedOutput = Array(10).fill('aaaaaaaaaa');

    tr.on('readable', function flow() {
      let chunk;
      while (null !== (chunk = tr.read(10)))
        out.push(chunk);
    });

    tr.on('end', () => {
      expect(out).toEqual(expectedOutput);
      done();
    });
  }, 10000);

  test('Verify hex encoding with options', (done) => {
    const tr = new TestReader(100, { encoding: 'hex' });
    const out = [];
    const expectedOutput = Array(20).fill('6161616161');

    tr.on('readable', function flow() {
      let chunk;
      while (null !== (chunk = tr.read(10)))
        out.push(chunk);
    });

    tr.on('end', () => {
      expect(out).toEqual(expectedOutput);
      done();
    });
  }, 10000);

  test('Verify hex encoding with read(13) and options', (done) => {
    const tr = new TestReader(100, { encoding: 'hex' });
    const out = [];
    const expectedOutput = [
      '6161616161616',
      '1616161616161',
      '6161616161616',
      '1616161616161',
      '6161616161616',
      '1616161616161',
      '6161616161616',
      '1616161616161',
      '6161616161616',
      '1616161616161',
      '6161616161616',
      '1616161616161',
      '6161616161616',
      '1616161616161',
      '6161616161616',
      '16161'
    ];

    tr.on('readable', function flow() {
      let chunk;
      while (null !== (chunk = tr.read(13)))
        out.push(chunk);
    });

    tr.on('end', () => {
      expect(out).toEqual(expectedOutput);
      done();
    });
  }, 10000);

  test('Verify base64 encoding with options', (done) => {
    const tr = new TestReader(100, { encoding: 'base64' });
    const out = [];
    const expectedOutput = [
      'YWFhYWFhYW',
      'FhYWFhYWFh',
      'YWFhYWFhYW',
      'FhYWFhYWFh',
      'YWFhYWFhYW',
      'FhYWFhYWFh',
      'YWFhYWFhYW',
      'FhYWFhYWFh',
      'YWFhYWFhYW',
      'FhYWFhYWFh',
      'YWFhYWFhYW',
      'FhYWFhYWFh',
      'YWFhYWFhYW',
      'FhYQ=='
    ];

    tr.on('readable', function flow() {
      let chunk;
      while (null !== (chunk = tr.read(10)))
        out.push(chunk);
    });

    tr.on('end', () => {
      expect(out).toEqual(expectedOutput);
      done();
    });
  }, 10000);

  test('Verify chaining behavior', () => {
    const tr = new TestReader(100);
    expect(tr.setEncoding('utf8')).toBe(tr);
  });
});

//<#END_FILE: test-stream2-set-encoding.js
