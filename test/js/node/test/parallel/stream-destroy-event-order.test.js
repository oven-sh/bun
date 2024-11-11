//#FILE: test-stream-destroy-event-order.js
//#SHA1: 0d5e12d85e093a1d7c118a2e15cf0c38c1ab96f6
//-----------------
'use strict';

const { Readable } = require('stream');

test('Stream destroy event order', (done) => {
  const rs = new Readable({
    read() {}
  });

  let closed = false;
  let errored = false;

  const errorHandler = jest.fn(() => {
    errored = true;
    expect(closed).toBe(false);
  });

  const closeHandler = jest.fn(() => {
    closed = true;
    expect(errored).toBe(true);
    expect(errorHandler).toHaveBeenCalled();
    done();
  });

  rs.on('close', closeHandler);
  rs.on('error', errorHandler);

  rs.destroy(new Error('kaboom'));

  // Ensure that the event handlers are called
  setImmediate(() => {
    expect(errorHandler).toHaveBeenCalled();
    expect(closeHandler).toHaveBeenCalled();
  });
});

//<#END_FILE: test-stream-destroy-event-order.js
