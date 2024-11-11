//#FILE: test-stream-typedarray.js
//#SHA1: 193817a2eb1bc3c0fad053db7a57a73a41bba79d
//-----------------
'use strict';

const { Readable, Writable } = require('stream');

const buffer = Buffer.from('ABCD');

function getArrayBufferViews(buf) {
  return [
    buf,
    new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
    new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2),
    new Uint32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4),
    new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength),
    new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2),
    new Int32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4),
    new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4),
    new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8),
    new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  ];
}

const views = getArrayBufferViews(buffer);

function getBufferSources(buf) {
  return buf instanceof Buffer ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
}

test('Simple Writable test', (done) => {
  let n = 0;
  const writable = new Writable({
    write: (chunk, encoding, cb) => {
      expect(chunk).toBeInstanceOf(Buffer);
      expect(ArrayBuffer.isView(chunk)).toBe(true);
      expect(getBufferSources(chunk)).toEqual(getBufferSources(views[n]));
      n++;
      cb();
      if (n === views.length) done();
    },
  });

  views.forEach((msg) => writable.write(msg));
  writable.end();
});

test('Writable test with object mode True', (done) => {
  let n = 0;
  const writable = new Writable({
    objectMode: true,
    write: (chunk, encoding, cb) => {
      expect(ArrayBuffer.isView(chunk)).toBe(true);
      expect(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)).toEqual(getBufferSources(views[n]));
      n++;
      cb();
      if (n === views.length) done();
    },
  });

  views.forEach((msg) => writable.write(msg));
  writable.end();
});

test('Writable test, multiple writes carried out via writev', (done) => {
  let n = 0;
  let callback;
  const writable = new Writable({
    write: (chunk, encoding, cb) => {
      expect(chunk).toBeInstanceOf(Buffer);
      expect(ArrayBuffer.isView(chunk)).toBe(true);
      expect(getBufferSources(chunk)).toEqual(getBufferSources(views[n]));
      n++;
      callback = cb;
    },

    writev: (chunks, cb) => {
      expect(chunks.length).toBe(views.length);
      let res = '';
      for (const chunk of chunks) {
        expect(chunk.encoding).toBe('buffer');
        res += chunk.chunk.toString();
      }
      expect(res).toBe('ABCD'.repeat(9));
      done();
    },
  });
  views.forEach((msg) => writable.write(msg));
  writable.end(views[0]);
  callback();
});

test('Simple Readable test', () => {
  const readable = new Readable({
    read() {}
  });

  readable.push(views[1]);
  readable.push(views[2]);
  readable.unshift(views[0]);

  const buf = readable.read();
  expect(buf).toBeInstanceOf(Buffer);
  expect([...buf]).toEqual([...buffer, ...buffer, ...buffer]);
});

test('Readable test, setEncoding', () => {
  const readable = new Readable({
    read() {}
  });

  readable.setEncoding('utf8');

  readable.push(views[1]);
  readable.push(views[2]);
  readable.unshift(views[0]);

  const out = readable.read();
  expect(out).toBe('ABCD'.repeat(3));
});

//<#END_FILE: test-stream-typedarray.js
