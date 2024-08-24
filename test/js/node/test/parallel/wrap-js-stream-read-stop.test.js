//#FILE: test-wrap-js-stream-read-stop.js
//#SHA1: 53e905da53ef7a130579672b04ddd6e65b7cb8d5
//-----------------
"use strict";

const Stream = require("stream");

class FakeStream extends Stream {
  constructor() {
    super();
    this._paused = false;
  }

  pause() {
    this._paused = true;
  }

  resume() {
    this._paused = false;
  }

  isPaused() {
    return this._paused;
  }
}

class WrapStream {
  constructor(stream) {
    this.stream = stream;
    this.stream.resume();
  }

  readStop() {
    this.stream.pause();
    return 0;
  }
}

describe("WrapStream", () => {
  let fakeStreamObj;
  let wrappedStream;

  beforeEach(() => {
    fakeStreamObj = new FakeStream();
    wrappedStream = new WrapStream(fakeStreamObj);
  });

  test("Resume by wrapped stream upon construction", () => {
    expect(fakeStreamObj.isPaused()).toBe(false);
  });

  test("Pause and resume fakeStreamObj", () => {
    fakeStreamObj.pause();
    expect(fakeStreamObj.isPaused()).toBe(true);

    fakeStreamObj.resume();
    expect(fakeStreamObj.isPaused()).toBe(false);
  });

  test("readStop method", () => {
    expect(wrappedStream.readStop()).toBe(0);
    expect(fakeStreamObj.isPaused()).toBe(true);
  });
});

//<#END_FILE: test-wrap-js-stream-read-stop.js
