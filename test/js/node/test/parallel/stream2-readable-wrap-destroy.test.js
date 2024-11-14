//#FILE: test-stream2-readable-wrap-destroy.js
//#SHA1: 632a198f6b4fc882942984df461383047f6b78a6
//-----------------
"use strict";

const { Readable } = require("stream");
const EventEmitter = require("events");

test('Readable.wrap should call destroy on "destroy" event', () => {
  const oldStream = new EventEmitter();
  oldStream.pause = jest.fn();
  oldStream.resume = jest.fn();

  const destroyMock = jest.fn();

  const readable = new Readable({
    autoDestroy: false,
    destroy: destroyMock,
  });

  readable.wrap(oldStream);
  oldStream.emit("destroy");

  expect(destroyMock).toHaveBeenCalledTimes(1);
});

test('Readable.wrap should call destroy on "close" event', () => {
  const oldStream = new EventEmitter();
  oldStream.pause = jest.fn();
  oldStream.resume = jest.fn();

  const destroyMock = jest.fn();

  const readable = new Readable({
    autoDestroy: false,
    destroy: destroyMock,
  });

  readable.wrap(oldStream);
  oldStream.emit("close");

  expect(destroyMock).toHaveBeenCalledTimes(1);
});

//<#END_FILE: test-stream2-readable-wrap-destroy.js
