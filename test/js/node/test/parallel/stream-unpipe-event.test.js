//#FILE: test-stream-unpipe-event.js
//#SHA1: 17303ffe85d8760f81f6294d9004c98638985bd6
//-----------------
"use strict";

const { Writable, Readable } = require("stream");

class NullWriteable extends Writable {
  _write(chunk, encoding, callback) {
    return callback();
  }
}

class QuickEndReadable extends Readable {
  _read() {
    this.push(null);
  }
}

class NeverEndReadable extends Readable {
  _read() {}
}

test("QuickEndReadable pipes and unpipes", done => {
  const dest = new NullWriteable();
  const src = new QuickEndReadable();
  const pipeSpy = jest.fn();
  const unpipeSpy = jest.fn();

  dest.on("pipe", pipeSpy);
  dest.on("unpipe", unpipeSpy);

  src.pipe(dest);

  setImmediate(() => {
    expect(pipeSpy).toHaveBeenCalledTimes(1);
    expect(unpipeSpy).toHaveBeenCalledTimes(1);
    expect(src._readableState.pipes.length).toBe(0);
    done();
  });
});

test("NeverEndReadable pipes but does not unpipe", done => {
  const dest = new NullWriteable();
  const src = new NeverEndReadable();
  const pipeSpy = jest.fn();
  const unpipeSpy = jest.fn();

  dest.on("pipe", pipeSpy);
  dest.on("unpipe", unpipeSpy);

  src.pipe(dest);

  setImmediate(() => {
    expect(pipeSpy).toHaveBeenCalledTimes(1);
    expect(unpipeSpy).not.toHaveBeenCalled();
    expect(src._readableState.pipes.length).toBe(1);
    done();
  });
});

test("NeverEndReadable pipes and manually unpipes", done => {
  const dest = new NullWriteable();
  const src = new NeverEndReadable();
  const pipeSpy = jest.fn();
  const unpipeSpy = jest.fn();

  dest.on("pipe", pipeSpy);
  dest.on("unpipe", unpipeSpy);

  src.pipe(dest);
  src.unpipe(dest);

  setImmediate(() => {
    expect(pipeSpy).toHaveBeenCalledTimes(1);
    expect(unpipeSpy).toHaveBeenCalledTimes(1);
    expect(src._readableState.pipes.length).toBe(0);
    done();
  });
});

test("QuickEndReadable pipes and unpipes with end: false", done => {
  const dest = new NullWriteable();
  const src = new QuickEndReadable();
  const pipeSpy = jest.fn();
  const unpipeSpy = jest.fn();

  dest.on("pipe", pipeSpy);
  dest.on("unpipe", unpipeSpy);

  src.pipe(dest, { end: false });

  setImmediate(() => {
    expect(pipeSpy).toHaveBeenCalledTimes(1);
    expect(unpipeSpy).toHaveBeenCalledTimes(1);
    expect(src._readableState.pipes.length).toBe(0);
    done();
  });
});

test("NeverEndReadable pipes but does not unpipe with end: false", done => {
  const dest = new NullWriteable();
  const src = new NeverEndReadable();
  const pipeSpy = jest.fn();
  const unpipeSpy = jest.fn();

  dest.on("pipe", pipeSpy);
  dest.on("unpipe", unpipeSpy);

  src.pipe(dest, { end: false });

  setImmediate(() => {
    expect(pipeSpy).toHaveBeenCalledTimes(1);
    expect(unpipeSpy).not.toHaveBeenCalled();
    expect(src._readableState.pipes.length).toBe(1);
    done();
  });
});

test("NeverEndReadable pipes and manually unpipes with end: false", done => {
  const dest = new NullWriteable();
  const src = new NeverEndReadable();
  const pipeSpy = jest.fn();
  const unpipeSpy = jest.fn();

  dest.on("pipe", pipeSpy);
  dest.on("unpipe", unpipeSpy);

  src.pipe(dest, { end: false });
  src.unpipe(dest);

  setImmediate(() => {
    expect(pipeSpy).toHaveBeenCalledTimes(1);
    expect(unpipeSpy).toHaveBeenCalledTimes(1);
    expect(src._readableState.pipes.length).toBe(0);
    done();
  });
});

//<#END_FILE: test-stream-unpipe-event.js
