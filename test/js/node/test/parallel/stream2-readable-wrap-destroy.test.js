//#FILE: test-stream2-readable-wrap-destroy.js
//#SHA1: 632a198f6b4fc882942984df461383047f6b78a6
//-----------------
'use strict';

const { Readable } = require('stream');
const EventEmitter = require('events');

describe('Readable.wrap destroy behavior', () => {
  let oldStream;

  beforeEach(() => {
    oldStream = new EventEmitter();
    oldStream.pause = jest.fn();
    oldStream.resume = jest.fn();
  });

  test('should call destroy when "destroy" event is emitted', () => {
    const destroyMock = jest.fn();
    const readable = new Readable({
      autoDestroy: false,
      destroy: destroyMock
    });

    readable.wrap(oldStream);
    oldStream.emit('destroy');

    expect(destroyMock).toHaveBeenCalledTimes(1);
  });

  test('should call destroy when "close" event is emitted', () => {
    const destroyMock = jest.fn();
    const readable = new Readable({
      autoDestroy: false,
      destroy: destroyMock
    });

    readable.wrap(oldStream);
    oldStream.emit('close');

    expect(destroyMock).toHaveBeenCalledTimes(1);
  });
});

//<#END_FILE: test-stream2-readable-wrap-destroy.js
