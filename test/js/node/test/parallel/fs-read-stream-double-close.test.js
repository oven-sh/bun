//#FILE: test-fs-read-stream-double-close.js
//#SHA1: 066b117ee2b44bedfdce77d06389406b2474eb2f
//-----------------
'use strict';

const fs = require('fs');

test('double close on ReadStream', (done) => {
  const s = fs.createReadStream(__filename);

  let closeCount = 0;
  const checkClose = () => {
    closeCount++;
    if (closeCount === 2) {
      done();
    }
  };

  s.close(checkClose);
  s.close(checkClose);
});

test('double destroy on ReadStream', (done) => {
  const s = fs.createReadStream(__filename);

  let destroyCount = 0;
  const checkDestroy = () => {
    destroyCount++;
    if (destroyCount === 2) {
      done();
    }
  };

  // This is a private API, but it is worth testing. close calls this
  s.destroy(null, checkDestroy);
  s.destroy(null, checkDestroy);
});

//<#END_FILE: test-fs-read-stream-double-close.js
