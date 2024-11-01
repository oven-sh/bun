//#FILE: test-fs-write-stream-encoding.js
//#SHA1: a2f61bd26151411263b933d254ec75a7ca4056fc
//-----------------
'use strict';
const fs = require('fs');
const stream = require('stream');
const path = require('path');
const os = require('os');

const fixturesPath = path.join(__dirname, '..', 'fixtures');
const tmpdir = path.join(os.tmpdir(), 'test-fs-write-stream-encoding');

const firstEncoding = 'base64';
const secondEncoding = 'latin1';

const examplePath = path.join(fixturesPath, 'x.txt');
const dummyPath = path.join(tmpdir, 'x.txt');

beforeAll(() => {
  if (fs.existsSync(tmpdir)) {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpdir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

test('write stream encoding', (done) => {
  const exampleReadStream = fs.createReadStream(examplePath, {
    encoding: firstEncoding
  });

  const dummyWriteStream = fs.createWriteStream(dummyPath, {
    encoding: firstEncoding
  });

  exampleReadStream.pipe(dummyWriteStream).on('finish', () => {
    const assertWriteStream = new stream.Writable({
      write: function(chunk, enc, next) {
        const expected = Buffer.from('xyz\n');
        expect(chunk).toEqual(expected);
        next();
      }
    });
    assertWriteStream.setDefaultEncoding(secondEncoding);
    
    fs.createReadStream(dummyPath, {
      encoding: secondEncoding
    }).pipe(assertWriteStream).on('finish', done);
  });
});

//<#END_FILE: test-fs-write-stream-encoding.js
