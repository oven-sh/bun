'use strict';

// Bun adaptation of node v26.3.0 lib/internal/js_stream_socket.js. Node's
// original drives reads/writes through `new Socket({ handle })`, where the
// C++ side of net.Socket speaks the StreamBase protocol against the JSStream
// handle. Bun's net.Socket has no JS-handle StreamBase layer, so this class
// keeps node's handle protocol and public surface (isClosing/readStart/
// readStop/doShutdown/finishShutdown/doWrite/finishWrite/doClose, _handle)
// but wires the Duplex plumbing (_read/_write/_final/_destroy) to the handle
// explicitly, the way node's stream_base_commons does natively.

const { setImmediate } = require('timers');
const { Socket } = require('net');
const { JSStream } = internalBinding('js_stream');
const {
  WriteWrap,
  ShutdownWrap,
  streamBaseState,
  kReadBytesOrError,
  kArrayBufferOffset,
} = internalBinding('stream_wrap');
const uv = internalBinding('uv');
const { ERR_STREAM_WRAP } = require('internal/errors').codes;

const kCurrentWriteRequest = Symbol('kCurrentWriteRequest');
const kCurrentShutdownRequest = Symbol('kCurrentShutdownRequest');
const kPendingShutdownRequest = Symbol('kPendingShutdownRequest');
const kPendingClose = Symbol('kPendingClose');

// node's errnoException(status, 'write') shape, without the full uv errmap
// machinery: only the codes this shim can itself produce.
function writeException(status) {
  let code = 'UNKNOWN';
  for (const name of Object.keys(uv)) {
    if (uv[name] === status && name.startsWith('UV_')) {
      code = name.slice(3);
      break;
    }
  }
  const err = new Error(`write ${code}`);
  err.errno = status;
  err.code = code;
  err.syscall = 'write';
  return err;
}

class JSStreamSocket extends Socket {
  constructor(stream) {
    const handle = new JSStream();
    super({ handle });
    this.stream = stream;
    this._handle = handle;
    this[kCurrentWriteRequest] = null;
    this[kCurrentShutdownRequest] = null;
    this[kPendingShutdownRequest] = null;
    this[kPendingClose] = false;
    this.readable = stream.readable;
    this.writable = stream.writable;

    handle.close = (cb) => {
      this.doClose(cb);
    };
    // Inside of the following hooks, node binds `this` to the handle and
    // recovers the socket via owner_symbol; closures serve the same purpose.
    handle.isClosing = () => this.isClosing();
    handle.onreadstart = () => this.readStart();
    handle.onreadstop = () => this.readStop();
    handle.onshutdown = (req) => this.doShutdown(req);
    handle.onwrite = (req, bufs) => this.doWrite(req, bufs);
    // node's onStreamRead (internal/stream_base_commons.js): push reported
    // chunks into the socket, EOF as push(null), backpressure via readStop.
    handle.onread = (arrayBuffer) => {
      const nread = streamBaseState[kReadBytesOrError];
      if (nread === uv.UV_EOF) {
        this.push(null);
        this.read(0); // trigger 'end' like node's onStreamRead EOF path
        return;
      }
      if (arrayBuffer === undefined || nread === 0) return;
      const offset = streamBaseState[kArrayBufferOffset];
      if (!this.push(Buffer.from(arrayBuffer, offset, nread))) {
        handle.readStop();
      }
    };

    stream.pause();
    stream.on('error', (err) => this.emit('error', err));
    const ondata = (chunk) => {
      if (typeof chunk === 'string' ||
          stream.readableObjectMode === true) {
        // Make sure that no further `data` events will happen.
        stream.pause();
        stream.removeListener('data', ondata);

        this.emit('error', new ERR_STREAM_WRAP());
        return;
      }
      if (this._handle)
        this._handle.readBuffer(chunk);
    };
    stream.on('data', ondata);
    stream.once('end', () => {
      if (this._handle)
        this._handle.emitEOF();
    });
    // Some `Stream` don't pass `hasError` parameters when closed.
    stream.once('close', () => {
      // Errors emitted from `stream` have also been emitted to this instance
      // so that we don't pass errors to `destroy()` again.
      this.destroy();
    });

    // Start reading.
    this.read(0);
  }

  // Allow legacy requires in the test suite to keep working:
  //   const { StreamWrap } = require('internal/js_stream_socket')
  static get StreamWrap() {
    return JSStreamSocket;
  }

  isClosing() {
    return !this.readable || !this.writable;
  }

  readStart() {
    this.stream.resume();
    return 0;
  }

  readStop() {
    this.stream.pause();
    return 0;
  }

  doShutdown(req) {
    // See the upstream TODO: a shutdown while a write is still pending is
    // deferred until that write finishes.
    if (this[kCurrentWriteRequest] !== null) {
      this[kPendingShutdownRequest] = req;
      return 0;
    }

    this[kCurrentShutdownRequest] = req;

    if (this[kPendingClose]) {
      // If doClose is pending, the stream & this._handle are gone. We can't do
      // anything. doClose will call finishShutdown with ECANCELED for us shortly.
      return 0;
    }

    const handle = this._handle;

    process.nextTick(() => {
      // Ensure that write is dispatched asynchronously.
      this.stream.end(() => {
        this.finishShutdown(handle, 0);
      });
    });
    return 0;
  }

  // handle === this._handle except when called from doClose().
  finishShutdown(handle, errCode) {
    // The shutdown request might already have been cancelled.
    if (this[kCurrentShutdownRequest] === null)
      return;
    const req = this[kCurrentShutdownRequest];
    this[kCurrentShutdownRequest] = null;
    handle.finishShutdown(req, errCode);
  }

  doWrite(req, bufs) {
    if (this[kPendingClose]) {
      // If doClose is pending, the stream & this._handle are gone. We can't do
      // anything. doClose will call finishWrite with ECANCELED for us shortly.
      this[kCurrentWriteRequest] = req; // Store req, for doClose to cancel
      return 0;
    } else if (this._handle === null) {
      // If this._handle is already null, there is nothing left to do with a
      // pending write request, so we discard it.
      return 0;
    }

    const handle = this._handle;
    const self = this;

    let pending = bufs.length;

    this.stream.cork();
    for (let i = 0; i < bufs.length; ++i)
      this.stream.write(bufs[i], done);
    this.stream.uncork();

    // Only set the request here, because the `write()` calls could throw.
    this[kCurrentWriteRequest] = req;

    function done(err) {
      if (!err && --pending !== 0)
        return;

      // Ensure that this is called once in case of error
      pending = 0;

      let errCode = 0;
      if (err) {
        errCode = uv[`UV_${err.code}`] || uv.UV_EPIPE;
      }

      // Ensure that write was dispatched
      setImmediate(() => {
        self.finishWrite(handle, errCode);
      });
    }

    return 0;
  }

  // handle === this._handle except when called from doClose().
  finishWrite(handle, errCode) {
    // The write request might already have been cancelled.
    if (this[kCurrentWriteRequest] === null)
      return;
    const req = this[kCurrentWriteRequest];
    this[kCurrentWriteRequest] = null;

    handle.finishWrite(req, errCode);
    if (this[kPendingShutdownRequest]) {
      const req = this[kPendingShutdownRequest];
      this[kPendingShutdownRequest] = null;
      this.doShutdown(req);
    }
  }

  doClose(cb) {
    this[kPendingClose] = true;

    const handle = this._handle;

    // When sockets of the "net" module destroyed, they will call
    // `this._handle.close()` which will also emit EOF if not emitted before.
    // This feature makes sockets on the other side emit "end" and "close"
    // even though we haven't called `end()`. As `stream` are likely to be
    // instances of `net.Socket`, calling `stream.destroy()` manually will
    // avoid issues that don't properly close wrapped connections.
    this.stream.destroy();

    setImmediate(() => {
      this.finishWrite(handle, uv.UV_ECANCELED);
      this.finishShutdown(handle, uv.UV_ECANCELED);

      this[kPendingClose] = false;

      cb();
    });
  }

  // ---- Bun: Duplex plumbing the C++ net.Socket({ handle }) layer provides
  // in node (internal/stream_base_commons.js writeGeneric/onStreamRead).

  _read() {
    const handle = this._handle;
    if (handle) handle.readStart();
  }

  _write(chunk, encoding, cb) {
    const handle = this._handle;
    if (!handle) return cb(writeException(uv.UV_ECANCELED));
    const req = new WriteWrap();
    req.handle = handle;
    req.oncomplete = function oncomplete(status) {
      cb(status < 0 ? writeException(status) : null);
    };
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, encoding) : chunk;
    const ret = handle.writeBuffer(req, buf);
    if (ret !== 0) cb(writeException(ret));
  }

  _final(cb) {
    const handle = this._handle;
    if (!handle) return cb();
    const req = new ShutdownWrap();
    req.handle = handle;
    req.oncomplete = function oncomplete(status) {
      cb(status < 0 && status !== uv.UV_ECANCELED ? writeException(status) : null);
    };
    handle.shutdown(req);
  }

  _destroy(err, cb) {
    const handle = this._handle;
    const emitClose = () => {
      // net.Socket disables the Duplex's own 'close' (emitClose: false) and
      // emits from its handle-close callback; do the same here.
      this.emit('close', this._hadError || !!err);
    };
    if (!handle) {
      cb(err);
      process.nextTick(emitClose);
      return;
    }
    // Same order as net.js: initiate the close (doClose captures the handle),
    // then null the field so doClose's deferred cancellations see it cleared.
    handle.close(() => {
      cb(err);
      emitClose();
    });
    this._handle = null;
  }
}

module.exports = JSStreamSocket;
