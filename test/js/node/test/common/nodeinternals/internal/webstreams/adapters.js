'use strict';

// Excerpt of node v26.3.0 lib/internal/webstreams/adapters.js: only the
// StreamBase-backed adapters (newWritableStreamFromStreamBase and
// newReadableStreamFromStreamBase), which Bun's own webstreams adapters do
// not implement. The stream.Readable/Writable adapters come from Bun's real
// internal/webstreams/adapters via the require interceptor's key-for-key
// merge; only the keys exported here are added on top. Function bodies are
// verbatim from upstream.

const {
  PromisePrototypeThen,
  PromiseWithResolvers,
} = primordials;

const {
  codes: {
    ERR_INVALID_STATE,
  },
  ErrnoException,
} = require('internal/errors');

const {
  validateFunction,
  validateObject,
} = require('internal/validators');

const {
  kEmptyObject,
} = require('internal/util');

const {
  WriteWrap,
  ShutdownWrap,
  streamBaseState,
  kReadBytesOrError,
  kLastWriteWasAsync,
} = internalBinding('stream_wrap');

const {
  UV_EOF,
} = internalBinding('uv');

function newWritableStreamFromStreamBase(streamBase, strategy) {
  validateObject(streamBase, 'streamBase');

  let current;

  function createWriteWrap(controller, promise) {
    const req = new WriteWrap();
    req.handle = streamBase;
    req.oncomplete = onWriteComplete;
    req.async = false;
    req.bytes = 0;
    req.buffer = null;
    req.controller = controller;
    req.promise = promise;
    return req;
  }

  function onWriteComplete(status) {
    if (status < 0) {
      const error = new ErrnoException(status, 'write', this.error);
      this.promise.reject(error);
      this.controller.error(error);
      return;
    }
    this.promise.resolve();
  }

  function doWrite(chunk, controller) {
    const promise = PromiseWithResolvers();
    let ret;
    let req;
    try {
      req = createWriteWrap(controller, promise);
      ret = streamBase.writeBuffer(req, chunk);
      if (streamBaseState[kLastWriteWasAsync])
        req.buffer = chunk;
      req.async = !!streamBaseState[kLastWriteWasAsync];
    } catch (error) {
      promise.reject(error);
    }

    if (ret !== 0)
      promise.reject(new ErrnoException(ret, 'write', req));
    else if (!req.async)
      promise.resolve();

    return promise.promise;
  }

  return new WritableStream({
    write(chunk, controller) {
      current = current !== undefined ?
        PromisePrototypeThen(
          current,
          () => doWrite(chunk, controller),
          (error) => controller.error(error)) :
        doWrite(chunk, controller);
      return current;
    },

    close() {
      const promise = PromiseWithResolvers();
      const req = new ShutdownWrap();
      req.oncomplete = () => promise.resolve();
      const err = streamBase.shutdown(req);
      if (err === 1)
        promise.resolve();
      return promise.promise;
    },
  }, strategy);
}

function newReadableStreamFromStreamBase(streamBase, strategy, options = kEmptyObject) {
  validateObject(streamBase, 'streamBase');
  validateObject(options, 'options');

  const {
    ondone = () => {},
  } = options;

  if (typeof streamBase.onread === 'function')
    throw new ERR_INVALID_STATE('StreamBase already has a consumer');

  validateFunction(ondone, 'options.ondone');

  let controller;

  streamBase.onread = (arrayBuffer) => {
    const nread = streamBaseState[kReadBytesOrError];

    if (nread === 0)
      return;

    try {
      if (nread === UV_EOF) {
        controller.close();
        streamBase.readStop();
        try {
          ondone();
        } catch (error) {
          controller.error(error);
        }
        return;
      }

      controller.enqueue(arrayBuffer);

      if (controller.desiredSize <= 0)
        streamBase.readStop();
    } catch (error) {
      controller.error(error);
      streamBase.readStop();
    }
  };

  return new ReadableStream({
    start(c) { controller = c; },

    pull() {
      streamBase.readStart();
    },

    cancel() {
      const promise = PromiseWithResolvers();
      try {
        ondone();
      } catch (error) {
        promise.reject(error);
        return promise.promise;
      }
      const req = new ShutdownWrap();
      req.oncomplete = () => promise.resolve();
      const err = streamBase.shutdown(req);
      if (err === 1)
        promise.resolve();
      return promise.promise;
    },
  }, strategy);
}

module.exports = {
  newWritableStreamFromStreamBase,
  newReadableStreamFromStreamBase,
};
