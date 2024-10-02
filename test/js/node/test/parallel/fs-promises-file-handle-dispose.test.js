//#FILE: test-fs-promises-file-handle-dispose.js
//#SHA1: 4627605b9a96934262220299017ba0c7b76d9c36
//-----------------
'use strict';

const fs = require('fs').promises;

// Mock FileHandle
class MockFileHandle {
  constructor() {
    this.closeHandler = null;
    this.on = jest.fn((event, handler) => {
      if (event === 'close') {
        this.closeHandler = handler;
      }
    });
    this[Symbol.asyncDispose] = jest.fn(async () => {
      if (this.closeHandler) {
        this.closeHandler();
      }
    });
  }
}

// Mock fs.promises.open
fs.open = jest.fn(async () => new MockFileHandle());

test('FileHandle asyncDispose calls close event', async () => {
  async function doOpen() {
    const fh = await fs.open('dummy-file');
    fh.on('close', jest.fn()); // Simulate setting up the 'close' event handler
    await fh[Symbol.asyncDispose]();
    return fh;
  }

  const fh = await doOpen();
  
  expect(fs.open).toHaveBeenCalledWith('dummy-file');
  expect(fh.on).toHaveBeenCalledWith('close', expect.any(Function));
  expect(fh[Symbol.asyncDispose]).toHaveBeenCalled();
  expect(fh.closeHandler).toHaveBeenCalled();
});

//<#END_FILE: test-fs-promises-file-handle-dispose.js
