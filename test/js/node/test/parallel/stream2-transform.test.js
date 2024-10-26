//#FILE: test-stream2-transform.js
//#SHA1: 1ad9a3df81c323d41063fa2e11fcac8acd7e1608
//-----------------
'use strict';
const { PassThrough, Transform } = require('stream');

test('Verify writable side consumption', () => {
  const tx = new Transform({
    highWaterMark: 10
  });

  let transformed = 0;
  tx._transform = function(chunk, encoding, cb) {
    transformed += chunk.length;
    tx.push(chunk);
    cb();
  };

  for (let i = 1; i <= 10; i++) {
    tx.write(Buffer.allocUnsafe(i));
  }
  tx.end();

  expect(tx.readableLength).toBe(10);
  expect(transformed).toBe(10);
  expect(tx.writableBuffer.map(c => c.chunk.length)).toEqual([5, 6, 7, 8, 9, 10]);
});

test('Verify passthrough behavior', () => {
  const pt = new PassThrough();

  pt.write(Buffer.from('foog'));
  pt.write(Buffer.from('bark'));
  pt.write(Buffer.from('bazy'));
  pt.write(Buffer.from('kuel'));
  pt.end();

  expect(pt.read(5).toString()).toBe('foogb');
  expect(pt.read(5).toString()).toBe('arkba');
  expect(pt.read(5).toString()).toBe('zykue');
  expect(pt.read(5).toString()).toBe('l');
});

test('Verify object passthrough behavior', () => {
  const pt = new PassThrough({ objectMode: true });

  pt.write(1);
  pt.write(true);
  pt.write(false);
  pt.write(0);
  pt.write('foo');
  pt.write('');
  pt.write({ a: 'b' });
  pt.end();

  expect(pt.read()).toBe(1);
  expect(pt.read()).toBe(true);
  expect(pt.read()).toBe(false);
  expect(pt.read()).toBe(0);
  expect(pt.read()).toBe('foo');
  expect(pt.read()).toBe('');
  expect(pt.read()).toEqual({ a: 'b' });
});

test('Verify passthrough constructor behavior', () => {
  const pt = PassThrough();
  expect(pt).toBeInstanceOf(PassThrough);
});

test('Verify transform constructor behavior', () => {
  const pt = Transform();
  expect(pt).toBeInstanceOf(Transform);
});

test('Perform a simple transform', () => {
  const pt = new Transform();
  pt._transform = function(c, e, cb) {
    const ret = Buffer.alloc(c.length, 'x');
    pt.push(ret);
    cb();
  };

  pt.write(Buffer.from('foog'));
  pt.write(Buffer.from('bark'));
  pt.write(Buffer.from('bazy'));
  pt.write(Buffer.from('kuel'));
  pt.end();

  expect(pt.read(5).toString()).toBe('xxxxx');
  expect(pt.read(5).toString()).toBe('xxxxx');
  expect(pt.read(5).toString()).toBe('xxxxx');
  expect(pt.read(5).toString()).toBe('x');
});

test('Verify simple object transform', () => {
  const pt = new Transform({ objectMode: true });
  pt._transform = function(c, e, cb) {
    pt.push(JSON.stringify(c));
    cb();
  };

  pt.write(1);
  pt.write(true);
  pt.write(false);
  pt.write(0);
  pt.write('foo');
  pt.write('');
  pt.write({ a: 'b' });
  pt.end();

  expect(pt.read()).toBe('1');
  expect(pt.read()).toBe('true');
  expect(pt.read()).toBe('false');
  expect(pt.read()).toBe('0');
  expect(pt.read()).toBe('"foo"');
  expect(pt.read()).toBe('""');
  expect(pt.read()).toBe('{"a":"b"}');
});

test('Verify async passthrough', (done) => {
  const pt = new Transform();
  pt._transform = function(chunk, encoding, cb) {
    setTimeout(function() {
      pt.push(chunk);
      cb();
    }, 10);
  };

  pt.write(Buffer.from('foog'));
  pt.write(Buffer.from('bark'));
  pt.write(Buffer.from('bazy'));
  pt.write(Buffer.from('kuel'));
  pt.end();

  pt.on('finish', () => {
    expect(pt.read(5).toString()).toBe('foogb');
    expect(pt.read(5).toString()).toBe('arkba');
    expect(pt.read(5).toString()).toBe('zykue');
    expect(pt.read(5).toString()).toBe('l');
    done();
  });
});

test('Verify asymmetric transform (expand)', (done) => {
  const pt = new Transform();

  // Emit each chunk 2 times.
  pt._transform = function(chunk, encoding, cb) {
    setTimeout(function() {
      pt.push(chunk);
      setTimeout(function() {
        pt.push(chunk);
        cb();
      }, 10);
    }, 10);
  };

  pt.write(Buffer.from('foog'));
  pt.write(Buffer.from('bark'));
  pt.write(Buffer.from('bazy'));
  pt.write(Buffer.from('kuel'));
  pt.end();

  pt.on('finish', () => {
    expect(pt.read(5).toString()).toBe('foogf');
    expect(pt.read(5).toString()).toBe('oogba');
    expect(pt.read(5).toString()).toBe('rkbar');
    expect(pt.read(5).toString()).toBe('kbazy');
    expect(pt.read(5).toString()).toBe('bazyk');
    expect(pt.read(5).toString()).toBe('uelku');
    expect(pt.read(5).toString()).toBe('el');
    done();
  });
});

test('Verify asymmetric transform (compress)', (done) => {
  const pt = new Transform();

  // Each output is the first char of 3 consecutive chunks,
  // or whatever's left.
  pt.state = '';

  pt._transform = function(chunk, encoding, cb) {
    const s = (chunk ||= '').toString();
    setTimeout(() => {
      this.state += s.charAt(0);
      if (this.state.length === 3) {
        pt.push(Buffer.from(this.state));
        this.state = '';
      }
      cb();
    }, 10);
  };

  pt._flush = function(cb) {
    // Just output whatever we have.
    pt.push(Buffer.from(this.state));
    this.state = '';
    cb();
  };

  pt.write(Buffer.from('aaaa'));
  pt.write(Buffer.from('bbbb'));
  pt.write(Buffer.from('cccc'));
  pt.write(Buffer.from('dddd'));
  pt.write(Buffer.from('eeee'));
  pt.write(Buffer.from('aaaa'));
  pt.write(Buffer.from('bbbb'));
  pt.write(Buffer.from('cccc'));
  pt.write(Buffer.from('dddd'));
  pt.write(Buffer.from('eeee'));
  pt.write(Buffer.from('aaaa'));
  pt.write(Buffer.from('bbbb'));
  pt.write(Buffer.from('cccc'));
  pt.write(Buffer.from('dddd'));
  pt.end();

  // 'abcdeabcdeabcd'
  pt.on('finish', () => {
    expect(pt.read(5).toString()).toBe('abcde');
    expect(pt.read(5).toString()).toBe('abcde');
    expect(pt.read(5).toString()).toBe('abcd');
    done();
  });
});

test('Verify complex transform behavior', (done) => {
  let count = 0;
  let saved = null;
  const pt = new Transform({ highWaterMark: 3 });
  pt._transform = function(c, e, cb) {
    if (count++ === 1)
      saved = c;
    else {
      if (saved) {
        pt.push(saved);
        saved = null;
      }
      pt.push(c);
    }

    cb();
  };

  pt.once('readable', function() {
    process.nextTick(function() {
      pt.write(Buffer.from('d'));
      pt.write(Buffer.from('ef'), () => {
        pt.end();
      });
      expect(pt.read().toString()).toBe('abcdef');
      expect(pt.read()).toBeNull();
      done();
    });
  });

  pt.write(Buffer.from('abc'));
});

test('Verify passthrough event emission', () => {
  const pt = new PassThrough();
  let emits = 0;
  pt.on('readable', function() {
    emits++;
  });

  pt.write(Buffer.from('foog'));
  pt.write(Buffer.from('bark'));

  expect(emits).toBe(0);
  expect(pt.read(5).toString()).toBe('foogb');
  expect(String(pt.read(5))).toBe('null');
  expect(emits).toBe(0);

  pt.write(Buffer.from('bazy'));
  pt.write(Buffer.from('kuel'));

  expect(emits).toBe(0);
  expect(pt.read(5).toString()).toBe('arkba');
  expect(pt.read(5).toString()).toBe('zykue');
  expect(pt.read(5)).toBeNull();

  pt.end();

  expect(emits).toBe(1);
  expect(pt.read(5).toString()).toBe('l');
  expect(pt.read(5)).toBeNull();
  expect(emits).toBe(1);
});

test('Verify passthrough event emission reordering', (done) => {
  const pt = new PassThrough();
  let emits = 0;
  pt.on('readable', function() {
    emits++;
  });

  pt.write(Buffer.from('foog'));
  pt.write(Buffer.from('bark'));

  expect(emits).toBe(0);
  expect(pt.read(5).toString()).toBe('foogb');
  expect(pt.read(5)).toBeNull();

  pt.once('readable', () => {
    expect(pt.read(5).toString()).toBe('arkba');
    expect(pt.read(5)).toBeNull();

    pt.once('readable', () => {
      expect(pt.read(5).toString()).toBe('zykue');
      expect(pt.read(5)).toBeNull();
      pt.once('readable', () => {
        expect(pt.read(5).toString()).toBe('l');
        expect(pt.read(5)).toBeNull();
        expect(emits).toBe(3);
        done();
      });
      pt.end();
    });
    pt.write(Buffer.from('kuel'));
  });

  pt.write(Buffer.from('bazy'));
});

test('Verify passthrough facade', (done) => {
  const pt = new PassThrough();
  const datas = [];
  pt.on('data', function(chunk) {
    datas.push(chunk.toString());
  });

  pt.on('end', () => {
    expect(datas).toEqual(['foog', 'bark', 'bazy', 'kuel']);
    done();
  });

  pt.write(Buffer.from('foog'));
  setTimeout(function() {
    pt.write(Buffer.from('bark'));
    setTimeout(function() {
      pt.write(Buffer.from('bazy'));
      setTimeout(function() {
        pt.write(Buffer.from('kuel'));
        setTimeout(function() {
          pt.end();
        }, 10);
      }, 10);
    }, 10);
  }, 10);
});

test('Verify object transform (JSON parse)', (done) => {
  const jp = new Transform({ objectMode: true });
  jp._transform = function(data, encoding, cb) {
    try {
      jp.push(JSON.parse(data));
      cb();
    } catch (er) {
      cb(er);
    }
  };

  const objects = [
    { foo: 'bar' },
    100,
    'string',
    { nested: { things: [ { foo: 'bar' }, 100, 'string' ] } },
  ];

  let ended = false;
  jp.on('end', function() {
    ended = true;
  });

  for (const obj of objects) {
    jp.write(JSON.stringify(obj));
    const res = jp.read();
    expect(res).toEqual(obj);
  }

  jp.end();
  jp.read();

  process.nextTick(() => {
    expect(ended).toBe(true);
    done();
  });
});

test('Verify object transform (JSON stringify)', (done) => {
  const js = new Transform({ objectMode: true });
  js._transform = function(data, encoding, cb) {
    try {
      js.push(JSON.stringify(data));
      cb();
    } catch (er) {
      cb(er);
    }
  };

  const objects = [
    { foo: 'bar' },
    100,
    'string',
    { nested: { things: [ { foo: 'bar' }, 100, 'string' ] } },
  ];

  let ended = false;
  js.on('end', function() {
    ended = true;
  });

  for (const obj of objects) {
    js.write(obj);
    const res = js.read();
    expect(res).toBe(JSON.stringify(obj));
  }

  js.end();
  js.read();

  process.nextTick(() => {
    expect(ended).toBe(true);
    done();
  });
});

test('Verify transform with constructor', (done) => {
  const s = new Transform({
    objectMode: true,
    construct(callback) {
      this.push('header from constructor');
      callback();
    },
    transform: (row, encoding, callback) => {
      callback(null, row);
    },
  });

  const expected = [
    'header from constructor',
    'firstLine',
    'secondLine',
  ];
  s.on('data', (data) => {
    expect(data.toString()).toBe(expected.shift());
    if (expected.length === 0) {
      done();
    }
  });
  s.write('firstLine');
  process.nextTick(() => s.write('secondLine'));
});

//<#END_FILE: test-stream2-transform.js
