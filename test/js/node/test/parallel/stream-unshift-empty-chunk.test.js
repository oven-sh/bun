//#FILE: test-stream-unshift-empty-chunk.js
//#SHA1: 7131be31655bc6edfc95deb5c5747f50e71cbc90
//-----------------
'use strict';

const { Readable } = require('stream');

test('stream.unshift with empty chunk does not set state.reading=false', (done) => {
  const r = new Readable();
  let nChunks = 10;
  const chunk = Buffer.alloc(10, 'x');

  r._read = function(n) {
    setImmediate(() => {
      r.push(--nChunks === 0 ? null : chunk);
    });
  };

  let readAll = false;
  const seen = [];
  r.on('readable', () => {
    let chunk;
    while ((chunk = r.read()) !== null) {
      seen.push(chunk.toString());
      const putBack = Buffer.alloc(readAll ? 0 : 5, 'y');
      readAll = !readAll;
      r.unshift(putBack);
    }
  });

  const expected = [
    'xxxxxxxxxx',
    'yyyyy',
    'xxxxxxxxxx',
    'yyyyy',
    'xxxxxxxxxx',
    'yyyyy',
    'xxxxxxxxxx',
    'yyyyy',
    'xxxxxxxxxx',
    'yyyyy',
    'xxxxxxxxxx',
    'yyyyy',
    'xxxxxxxxxx',
    'yyyyy',
    'xxxxxxxxxx',
    'yyyyy',
    'xxxxxxxxxx',
    'yyyyy'
  ];

  r.on('end', () => {
    expect(seen).toEqual(expected);
    done();
  });

  // Add a timeout to ensure the test doesn't hang
  setTimeout(() => {
    done(new Error('Test timed out'));
  }, 10000);
}, 15000); // Increase the timeout to 15 seconds

//<#END_FILE: test-stream-unshift-empty-chunk.js
