//#FILE: test-stream2-large-read-stall.js
//#SHA1: ae4b6163fd7a45ca9b917398e95361b2a3dabc9c
//-----------------
'use strict';

const { Readable } = require('stream');

const READSIZE = 100;
const PUSHSIZE = 20;
const PUSHCOUNT = 1000;
const HWM = 50;

test('large read stall', (done) => {
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

  const r = new Readable({
    highWaterMark: HWM
  });
  const rs = r._readableState;

  let pushes = 0;
  function push() {
    if (pushes > PUSHCOUNT)
      return;

    if (pushes++ === PUSHCOUNT) {
      console.error('   push(EOF)');
      return r.push(null);
    }

    console.error(`   push #${pushes}`);
    if (r.push(Buffer.allocUnsafe(PUSHSIZE)))
      setTimeout(push, 1);
  }

  r._read = push;

  r.on('end', () => {
    expect(pushes).toBe(PUSHCOUNT + 1);
    consoleErrorSpy.mockRestore();
    done();
  });

  r.on('readable', function() {
    console.error('>> readable');
    let ret;
    do {
      console.error(`  > read(${READSIZE})`);
      ret = r.read(READSIZE);
      console.error(`  < ${ret?.length} (${rs.length} remain)`);
    } while (ret && ret.length === READSIZE);

    console.error('<< after read()',
                  ret?.length,
                  rs.needReadable,
                  rs.length);
  });
}, 30000); // Increase timeout to 30 seconds

//<#END_FILE: test-stream2-large-read-stall.js
