//#FILE: test-stream-readable-error-end.js
//#SHA1: 53ca73a1c4c11701d94345bac39bfc43258dae21
//-----------------
'use strict';

const { Readable } = require('stream');

test('Readable stream error and end behavior', (done) => {
  const r = new Readable({ read() {} });

  const onEnd = jest.fn();
  const onData = jest.fn();
  const onError = jest.fn();

  r.on('end', onEnd);
  r.on('data', onData);
  r.on('error', onError);

  r.push('asd');
  r.push(null);
  r.destroy(new Error('kaboom'));

  // Use setImmediate to allow all events to be processed
  setImmediate(() => {
    expect(onEnd).not.toHaveBeenCalled();
    expect(onData).toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
    done();
  });
});

//<#END_FILE: test-stream-readable-error-end.js
