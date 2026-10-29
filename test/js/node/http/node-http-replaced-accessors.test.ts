import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";
import { getDefaultHighWaterMark } from "node:stream";

test("a server uses shouldKeepAlive, socket, writableHighWaterMark and getHeader of its response and readableEnded of its request, wherever a program has replaced them", async () => {
  const highWaterMark = getDefaultHighWaterMark(false);
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "node-http-replaced-accessors-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe(`nothing replaced, end(body): 200 ok keep-alive
    the listener returns
nothing replaced, write(), end(body): 200 ok keep-alive
    the listener returns
nothing replaced, a content-length, write(), end(): 200 ok keep-alive
    the listener returns
nothing replaced, a body that is read, end(body): 200 ok keep-alive
    the listener returns
nothing replaced, a body that is ignored, end(body): 200 ok keep-alive
    the listener returns
shouldKeepAlive of the response replaced on the object, end(body): 200 ok keep-alive
    get shouldKeepAlive: true | the listener returns
shouldKeepAlive of the response replaced on the object, write(), end(body): 200 ok keep-alive
    get shouldKeepAlive: true | the listener returns
shouldKeepAlive of the response replaced on the object, a content-length, write(), end(): 200 ok keep-alive
    get shouldKeepAlive: true | the listener returns
shouldKeepAlive of the response replaced on the object, a body that is read, end(body): 200 ok keep-alive
    the listener returns | get shouldKeepAlive: true
shouldKeepAlive of the response replaced on the object, a body that is ignored, end(body): 200 ok keep-alive
    get shouldKeepAlive: true | the listener returns
shouldKeepAlive of the response replaced on an heir of its prototype, end(body): 200 ok keep-alive
    get shouldKeepAlive: true | the listener returns
shouldKeepAlive of the response replaced on an heir of its prototype, write(), end(body): 200 ok keep-alive
    get shouldKeepAlive: true | the listener returns
shouldKeepAlive of the response replaced on an heir of its prototype, a content-length, write(), end(): 200 ok keep-alive
    get shouldKeepAlive: true | the listener returns
shouldKeepAlive of the response replaced on an heir of its prototype, a body that is read, end(body): 200 ok keep-alive
    the listener returns | get shouldKeepAlive: true
shouldKeepAlive of the response replaced on an heir of its prototype, a body that is ignored, end(body): 200 ok keep-alive
    get shouldKeepAlive: true | the listener returns
shouldKeepAlive of the response replaced on the object, beside a tick and a promise job, end(body): 200 ok keep-alive
    get shouldKeepAlive: true | the listener returns | a tick | a promise job
shouldKeepAlive of the response replaced on the object, beside a tick and a promise job, write(), end(body): 200 ok keep-alive
    get shouldKeepAlive: true | the listener returns | a tick | a promise job
shouldKeepAlive of the response replaced on the object, beside a tick and a promise job, a content-length, write(), end(): 200 ok keep-alive
    get shouldKeepAlive: true | the listener returns | a tick | a promise job
shouldKeepAlive of the response replaced on the object, beside a tick and a promise job, a body that is read, end(body): 200 ok keep-alive
    the listener returns | a tick | a promise job | get shouldKeepAlive: true
shouldKeepAlive of the response replaced on the object, beside a tick and a promise job, a body that is ignored, end(body): 200 ok keep-alive
    get shouldKeepAlive: true | the listener returns | a tick | a promise job
shouldKeepAlive of the response replaced on the object, by a listener of prefinish, end(body): 200 ok keep-alive
    the listener returns
shouldKeepAlive of the response replaced on the object, by a listener of prefinish, write(), end(body): 200 ok keep-alive
    the listener returns
shouldKeepAlive of the response replaced on the object, by a listener of prefinish, a content-length, write(), end(): 200 ok keep-alive
    the listener returns
shouldKeepAlive of the response replaced on the object, by a listener of prefinish, a body that is read, end(body): 200 ok keep-alive
    the listener returns
shouldKeepAlive of the response replaced on the object, by a listener of prefinish, a body that is ignored, end(body): 200 ok keep-alive
    the listener returns
shouldKeepAlive of the response replaced on the object, and the response has listeners, end(body): 200 ok keep-alive
    get shouldKeepAlive: true | prefinish | the listener returns | finish | close
shouldKeepAlive of the response replaced on the object, and the response has listeners, write(), end(body): 200 ok keep-alive
    get shouldKeepAlive: true | prefinish | the listener returns | finish | close
shouldKeepAlive of the response replaced on the object, and the response has listeners, a content-length, write(), end(): 200 ok keep-alive
    get shouldKeepAlive: true | prefinish | the listener returns | finish | close
shouldKeepAlive of the response replaced on the object, and the response has listeners, a body that is read, end(body): 200 ok keep-alive
    the listener returns | get shouldKeepAlive: true | prefinish | finish | close
shouldKeepAlive of the response replaced on the object, and the response has listeners, a body that is ignored, end(body): 200 ok keep-alive
    get shouldKeepAlive: true | prefinish | the listener returns | finish | close
socket of the response replaced on the object, end(body): 200 ok keep-alive
    the listener returns | set socket: null
socket of the response replaced on the object, write(), end(body): 200 ok keep-alive
    get socket: an object | the listener returns | set socket: null | get socket: an object
socket of the response replaced on the object, a content-length, write(), end(): 200 ok keep-alive
    get socket: an object | the listener returns | set socket: null | get socket: an object
socket of the response replaced on the object, a body that is read, end(body): 200 ok keep-alive
    the listener returns | set socket: null
socket of the response replaced on the object, a body that is ignored, end(body): 200 ok keep-alive
    the listener returns | set socket: null
socket of the response replaced on an heir of its prototype, end(body): 200 ok keep-alive
    the listener returns | set socket: null
socket of the response replaced on an heir of its prototype, write(), end(body): 200 ok keep-alive
    get socket: an object | the listener returns | set socket: null | get socket: an object
socket of the response replaced on an heir of its prototype, a content-length, write(), end(): 200 ok keep-alive
    get socket: an object | the listener returns | set socket: null | get socket: an object
socket of the response replaced on an heir of its prototype, a body that is read, end(body): 200 ok keep-alive
    the listener returns | set socket: null
socket of the response replaced on an heir of its prototype, a body that is ignored, end(body): 200 ok keep-alive
    the listener returns | set socket: null
socket of the response replaced on the object, beside a tick and a promise job, end(body): 200 ok keep-alive
    the listener returns | set socket: null | a tick | a promise job
socket of the response replaced on the object, beside a tick and a promise job, write(), end(body): 200 ok keep-alive
    get socket: an object | the listener returns | set socket: null | a tick | get socket: an object | a promise job
socket of the response replaced on the object, beside a tick and a promise job, a content-length, write(), end(): 200 ok keep-alive
    get socket: an object | the listener returns | set socket: null | a tick | get socket: an object | a promise job
socket of the response replaced on the object, beside a tick and a promise job, a body that is read, end(body): 200 ok keep-alive
    the listener returns | a tick | a promise job | set socket: null
socket of the response replaced on the object, beside a tick and a promise job, a body that is ignored, end(body): 200 ok keep-alive
    the listener returns | set socket: null | a tick | a promise job
socket of the response replaced on the object, by a listener of prefinish, end(body): 200 ok keep-alive
    the listener returns | set socket: null
socket of the response replaced on the object, by a listener of prefinish, write(), end(body): 200 ok keep-alive
    the listener returns | set socket: null | get socket: an object
socket of the response replaced on the object, by a listener of prefinish, a content-length, write(), end(): 200 ok keep-alive
    the listener returns | set socket: null | get socket: an object
socket of the response replaced on the object, by a listener of prefinish, a body that is read, end(body): 200 ok keep-alive
    the listener returns | set socket: null
socket of the response replaced on the object, by a listener of prefinish, a body that is ignored, end(body): 200 ok keep-alive
    the listener returns | set socket: null
socket of the response replaced on the object, and the response has listeners, end(body): 200 ok keep-alive
    prefinish | the listener returns | set socket: null | finish | close
socket of the response replaced on the object, and the response has listeners, write(), end(body): 200 ok keep-alive
    get socket: an object | prefinish | the listener returns | set socket: null | get socket: an object | finish | close
socket of the response replaced on the object, and the response has listeners, a content-length, write(), end(): 200 ok keep-alive
    get socket: an object | prefinish | the listener returns | set socket: null | get socket: an object | finish | close
socket of the response replaced on the object, and the response has listeners, a body that is read, end(body): 200 ok keep-alive
    the listener returns | prefinish | set socket: null | finish | close
socket of the response replaced on the object, and the response has listeners, a body that is ignored, end(body): 200 ok keep-alive
    prefinish | the listener returns | set socket: null | finish | close
writableHighWaterMark of the response replaced on the object, end(body): 200 ok keep-alive
    the listener returns
writableHighWaterMark of the response replaced on the object, write(), end(body): 200 ok keep-alive
    get writableHighWaterMark: ${highWaterMark} | the listener returns | get writableHighWaterMark: ${highWaterMark}
writableHighWaterMark of the response replaced on the object, a content-length, write(), end(): 200 ok keep-alive
    get writableHighWaterMark: ${highWaterMark} | the listener returns | get writableHighWaterMark: ${highWaterMark}
writableHighWaterMark of the response replaced on the object, a body that is read, end(body): 200 ok keep-alive
    the listener returns
writableHighWaterMark of the response replaced on the object, a body that is ignored, end(body): 200 ok keep-alive
    the listener returns
writableHighWaterMark of the response replaced on an heir of its prototype, end(body): 200 ok keep-alive
    the listener returns
writableHighWaterMark of the response replaced on an heir of its prototype, write(), end(body): 200 ok keep-alive
    get writableHighWaterMark: ${highWaterMark} | the listener returns | get writableHighWaterMark: ${highWaterMark}
writableHighWaterMark of the response replaced on an heir of its prototype, a content-length, write(), end(): 200 ok keep-alive
    get writableHighWaterMark: ${highWaterMark} | the listener returns | get writableHighWaterMark: ${highWaterMark}
writableHighWaterMark of the response replaced on an heir of its prototype, a body that is read, end(body): 200 ok keep-alive
    the listener returns
writableHighWaterMark of the response replaced on an heir of its prototype, a body that is ignored, end(body): 200 ok keep-alive
    the listener returns
writableHighWaterMark of the response replaced on the object, beside a tick and a promise job, end(body): 200 ok keep-alive
    the listener returns | a tick | a promise job
writableHighWaterMark of the response replaced on the object, beside a tick and a promise job, write(), end(body): 200 ok keep-alive
    get writableHighWaterMark: ${highWaterMark} | the listener returns | a tick | get writableHighWaterMark: ${highWaterMark} | a promise job
writableHighWaterMark of the response replaced on the object, beside a tick and a promise job, a content-length, write(), end(): 200 ok keep-alive
    get writableHighWaterMark: ${highWaterMark} | the listener returns | a tick | get writableHighWaterMark: ${highWaterMark} | a promise job
writableHighWaterMark of the response replaced on the object, beside a tick and a promise job, a body that is read, end(body): 200 ok keep-alive
    the listener returns | a tick | a promise job
writableHighWaterMark of the response replaced on the object, beside a tick and a promise job, a body that is ignored, end(body): 200 ok keep-alive
    the listener returns | a tick | a promise job
writableHighWaterMark of the response replaced on the object, by a listener of prefinish, end(body): 200 ok keep-alive
    the listener returns
writableHighWaterMark of the response replaced on the object, by a listener of prefinish, write(), end(body): 200 ok keep-alive
    the listener returns | get writableHighWaterMark: ${highWaterMark}
writableHighWaterMark of the response replaced on the object, by a listener of prefinish, a content-length, write(), end(): 200 ok keep-alive
    the listener returns | get writableHighWaterMark: ${highWaterMark}
writableHighWaterMark of the response replaced on the object, by a listener of prefinish, a body that is read, end(body): 200 ok keep-alive
    the listener returns
writableHighWaterMark of the response replaced on the object, by a listener of prefinish, a body that is ignored, end(body): 200 ok keep-alive
    the listener returns
writableHighWaterMark of the response replaced on the object, and the response has listeners, end(body): 200 ok keep-alive
    prefinish | the listener returns | finish | close
writableHighWaterMark of the response replaced on the object, and the response has listeners, write(), end(body): 200 ok keep-alive
    get writableHighWaterMark: ${highWaterMark} | prefinish | the listener returns | get writableHighWaterMark: ${highWaterMark} | finish | close
writableHighWaterMark of the response replaced on the object, and the response has listeners, a content-length, write(), end(): 200 ok keep-alive
    get writableHighWaterMark: ${highWaterMark} | prefinish | the listener returns | get writableHighWaterMark: ${highWaterMark} | finish | close
writableHighWaterMark of the response replaced on the object, and the response has listeners, a body that is read, end(body): 200 ok keep-alive
    the listener returns | prefinish | finish | close
writableHighWaterMark of the response replaced on the object, and the response has listeners, a body that is ignored, end(body): 200 ok keep-alive
    prefinish | the listener returns | finish | close
getHeader of the response replaced on the object, end(body): 200 ok keep-alive
    the listener returns
getHeader of the response replaced on the object, write(), end(body): 200 ok keep-alive
    getHeader(content-length) | the listener returns
getHeader of the response replaced on the object, a content-length, write(), end(): 200 ok keep-alive
    getHeader(content-length) | the listener returns
getHeader of the response replaced on the object, a body that is read, end(body): 200 ok keep-alive
    the listener returns
getHeader of the response replaced on the object, a body that is ignored, end(body): 200 ok keep-alive
    the listener returns
getHeader of the response replaced on an heir of its prototype, end(body): 200 ok keep-alive
    the listener returns
getHeader of the response replaced on an heir of its prototype, write(), end(body): 200 ok keep-alive
    getHeader(content-length) | the listener returns
getHeader of the response replaced on an heir of its prototype, a content-length, write(), end(): 200 ok keep-alive
    getHeader(content-length) | the listener returns
getHeader of the response replaced on an heir of its prototype, a body that is read, end(body): 200 ok keep-alive
    the listener returns
getHeader of the response replaced on an heir of its prototype, a body that is ignored, end(body): 200 ok keep-alive
    the listener returns
getHeader of the response replaced on the object, beside a tick and a promise job, end(body): 200 ok keep-alive
    the listener returns | a tick | a promise job
getHeader of the response replaced on the object, beside a tick and a promise job, write(), end(body): 200 ok keep-alive
    getHeader(content-length) | the listener returns | a tick | a promise job
getHeader of the response replaced on the object, beside a tick and a promise job, a content-length, write(), end(): 200 ok keep-alive
    getHeader(content-length) | the listener returns | a tick | a promise job
getHeader of the response replaced on the object, beside a tick and a promise job, a body that is read, end(body): 200 ok keep-alive
    the listener returns | a tick | a promise job
getHeader of the response replaced on the object, beside a tick and a promise job, a body that is ignored, end(body): 200 ok keep-alive
    the listener returns | a tick | a promise job
getHeader of the response replaced on the object, by a listener of prefinish, end(body): 200 ok keep-alive
    the listener returns
getHeader of the response replaced on the object, by a listener of prefinish, write(), end(body): 200 ok keep-alive
    the listener returns
getHeader of the response replaced on the object, by a listener of prefinish, a content-length, write(), end(): 200 ok keep-alive
    the listener returns
getHeader of the response replaced on the object, by a listener of prefinish, a body that is read, end(body): 200 ok keep-alive
    the listener returns
getHeader of the response replaced on the object, by a listener of prefinish, a body that is ignored, end(body): 200 ok keep-alive
    the listener returns
getHeader of the response replaced on the object, and the response has listeners, end(body): 200 ok keep-alive
    prefinish | the listener returns | finish | close
getHeader of the response replaced on the object, and the response has listeners, write(), end(body): 200 ok keep-alive
    getHeader(content-length) | prefinish | the listener returns | finish | close
getHeader of the response replaced on the object, and the response has listeners, a content-length, write(), end(): 200 ok keep-alive
    getHeader(content-length) | prefinish | the listener returns | finish | close
getHeader of the response replaced on the object, and the response has listeners, a body that is read, end(body): 200 ok keep-alive
    the listener returns | prefinish | finish | close
getHeader of the response replaced on the object, and the response has listeners, a body that is ignored, end(body): 200 ok keep-alive
    prefinish | the listener returns | finish | close
getHeader of the response replaced on ServerResponse.prototype, end(body): 200 ok keep-alive
    the listener returns
getHeader of the response replaced on ServerResponse.prototype, write(), end(body): 200 ok keep-alive
    getHeader(content-length) | the listener returns
getHeader of the response replaced on ServerResponse.prototype, a content-length, write(), end(): 200 ok keep-alive
    getHeader(content-length) | the listener returns
getHeader of the response replaced on ServerResponse.prototype, a body that is read, end(body): 200 ok keep-alive
    the listener returns
getHeader of the response replaced on ServerResponse.prototype, a body that is ignored, end(body): 200 ok keep-alive
    the listener returns
readableEnded of the request replaced on the object, end(body): 200 ok keep-alive
    the listener returns | get readableEnded: false | get readableEnded: true
readableEnded of the request replaced on the object, write(), end(body): 200 ok keep-alive
    the listener returns | get readableEnded: false | get readableEnded: true
readableEnded of the request replaced on the object, a content-length, write(), end(): 200 ok keep-alive
    the listener returns | get readableEnded: false | get readableEnded: true
readableEnded of the request replaced on the object, a body that is read, end(body): 200 ok keep-alive
    the listener returns | get readableEnded: true
readableEnded of the request replaced on the object, a body that is ignored, end(body): 200 ok keep-alive
    the listener returns | get readableEnded: false | get readableEnded: true
readableEnded of the request replaced on an heir of its prototype, end(body): 200 ok keep-alive
    the listener returns | get readableEnded: false | get readableEnded: true
readableEnded of the request replaced on an heir of its prototype, write(), end(body): 200 ok keep-alive
    the listener returns | get readableEnded: false | get readableEnded: true
readableEnded of the request replaced on an heir of its prototype, a content-length, write(), end(): 200 ok keep-alive
    the listener returns | get readableEnded: false | get readableEnded: true
readableEnded of the request replaced on an heir of its prototype, a body that is read, end(body): 200 ok keep-alive
    the listener returns | get readableEnded: true
readableEnded of the request replaced on an heir of its prototype, a body that is ignored, end(body): 200 ok keep-alive
    the listener returns | get readableEnded: false | get readableEnded: true
readableEnded of the request replaced on the object, beside a tick and a promise job, end(body): 200 ok keep-alive
    the listener returns | a tick | get readableEnded: false | get readableEnded: true | a promise job
readableEnded of the request replaced on the object, beside a tick and a promise job, write(), end(body): 200 ok keep-alive
    the listener returns | a tick | get readableEnded: false | get readableEnded: true | a promise job
readableEnded of the request replaced on the object, beside a tick and a promise job, a content-length, write(), end(): 200 ok keep-alive
    the listener returns | a tick | get readableEnded: false | get readableEnded: true | a promise job
readableEnded of the request replaced on the object, beside a tick and a promise job, a body that is read, end(body): 200 ok keep-alive
    the listener returns | a tick | a promise job | get readableEnded: true
readableEnded of the request replaced on the object, beside a tick and a promise job, a body that is ignored, end(body): 200 ok keep-alive
    the listener returns | a tick | get readableEnded: false | a promise job | get readableEnded: true
readableEnded of the request replaced on the object, by a listener of prefinish, end(body): 200 ok keep-alive
    the listener returns | get readableEnded: false | get readableEnded: true
readableEnded of the request replaced on the object, by a listener of prefinish, write(), end(body): 200 ok keep-alive
    the listener returns | get readableEnded: false | get readableEnded: true
readableEnded of the request replaced on the object, by a listener of prefinish, a content-length, write(), end(): 200 ok keep-alive
    the listener returns | get readableEnded: false | get readableEnded: true
readableEnded of the request replaced on the object, by a listener of prefinish, a body that is read, end(body): 200 ok keep-alive
    the listener returns | get readableEnded: true
readableEnded of the request replaced on the object, by a listener of prefinish, a body that is ignored, end(body): 200 ok keep-alive
    the listener returns | get readableEnded: false | get readableEnded: true
readableEnded of the request replaced on the object, and the response has listeners, end(body): 200 ok keep-alive
    prefinish | the listener returns | get readableEnded: false | finish | close | get readableEnded: true
readableEnded of the request replaced on the object, and the response has listeners, write(), end(body): 200 ok keep-alive
    prefinish | the listener returns | get readableEnded: false | finish | close | get readableEnded: true
readableEnded of the request replaced on the object, and the response has listeners, a content-length, write(), end(): 200 ok keep-alive
    prefinish | the listener returns | get readableEnded: false | finish | close | get readableEnded: true
readableEnded of the request replaced on the object, and the response has listeners, a body that is read, end(body): 200 ok keep-alive
    the listener returns | prefinish | get readableEnded: true | finish | close
readableEnded of the request replaced on the object, and the response has listeners, a body that is ignored, end(body): 200 ok keep-alive
    prefinish | the listener returns | get readableEnded: false | finish | close | get readableEnded: true
readableEnded of the request replaced on IncomingMessage.prototype, end(body): 200 ok keep-alive
    the listener returns | get readableEnded: false | get readableEnded: true
readableEnded of the request replaced on IncomingMessage.prototype, write(), end(body): 200 ok keep-alive
    the listener returns | get readableEnded: false | get readableEnded: true
readableEnded of the request replaced on IncomingMessage.prototype, a content-length, write(), end(): 200 ok keep-alive
    the listener returns | get readableEnded: false | get readableEnded: true
readableEnded of the request replaced on IncomingMessage.prototype, a body that is read, end(body): 200 ok keep-alive
    the listener returns | get readableEnded: true
readableEnded of the request replaced on IncomingMessage.prototype, a body that is ignored, end(body): 200 ok keep-alive
    the listener returns | get readableEnded: false | get readableEnded: true
shouldKeepAlive of the response answers false, end(body): 200 ok close
    get shouldKeepAlive | get shouldKeepAlive | the listener returns
shouldKeepAlive of the response answers false, write(), end(body): 200 ok close
    get shouldKeepAlive | get shouldKeepAlive | the listener returns
shouldKeepAlive of the response answers false, a content-length, write(), end(): 200 ok close
    get shouldKeepAlive | get shouldKeepAlive | the listener returns
shouldKeepAlive of the response answers false, a body that is read, end(body): 200 ok close
    the listener returns | get shouldKeepAlive | get shouldKeepAlive
shouldKeepAlive of the response answers false, a body that is ignored, end(body): 200 ok close
    get shouldKeepAlive | get shouldKeepAlive | the listener returns
shouldKeepAlive of the response replaced between write() and end(): 200 ok keep-alive
    the listener returns
shouldKeepAlive of the response replaced between write() and end(), behind a content-length: 200 ok keep-alive
    the listener returns
socket of the response replaced between write() and end(): 200 ok keep-alive
    the listener returns | set socket: null | get socket: an object
socket of the response replaced between write() and end(), behind a content-length: 200 ok keep-alive
    the listener returns | set socket: null | get socket: an object
writableHighWaterMark of the response replaced between write() and end(): 200 ok keep-alive
    the listener returns | get writableHighWaterMark: ${highWaterMark}
writableHighWaterMark of the response replaced between write() and end(), behind a content-length: 200 ok keep-alive
    the listener returns | get writableHighWaterMark: ${highWaterMark}
getHeader of the response replaced between write() and end(): 200 ok keep-alive
    the listener returns
getHeader of the response replaced between write() and end(), behind a content-length: 200 ok keep-alive
    the listener returns
readableEnded of the request replaced between write() and end(): 200 ok keep-alive
    the listener returns | get readableEnded: false | get readableEnded: true
readableEnded of the request replaced between write() and end(), behind a content-length: 200 ok keep-alive
    the listener returns | get readableEnded: false | get readableEnded: true
shouldKeepAlive = false between write() and end(): 200 ok keep-alive
    the listener returns
shouldKeepAlive = false between write() and end(), behind a content-length: 200 ok keep-alive
    the listener returns
`);
  expect(exitCode).toBe(0);
});
