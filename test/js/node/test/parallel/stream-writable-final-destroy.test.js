//#FILE: test-stream-writable-final-destroy.js
//#SHA1: 4213d1382f0e5b950211e183a94adc5f3e7a1468
//-----------------
'use strict';

const { Writable } = require('stream');

test('Writable stream final and destroy', (done) => {
  const w = new Writable({
    write(chunk, encoding, callback) {
      callback(null);
    },
    final(callback) {
      queueMicrotask(callback);
    }
  });

  const prefinishSpy = jest.fn();
  const finishSpy = jest.fn();
  const closeSpy = jest.fn();

  w.on('prefinish', prefinishSpy);
  w.on('finish', finishSpy);
  w.on('close', () => {
    closeSpy();
    expect(prefinishSpy).not.toHaveBeenCalled();
    expect(finishSpy).not.toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalled();
    done();
  });

  w.end();
  w.destroy();
});

//<#END_FILE: test-stream-writable-final-destroy.js
