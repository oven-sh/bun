// Script can call the native object of an HTTP/2 session through the getter named
// Symbol.for("::bunhttp2native::"). The fixture runs in a subprocess because a failure there ends the process.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("native pushPromise() and altsvc() throw for ids that are not stream ids and for an ALTSVC frame that is too long", async () => {
  const fixture = /* js */ `
    const http2 = require("node:http2");
    const { Duplex } = require("node:stream");

    // The transport of a server session that has no peer. It keeps what the session writes.
    const written = [];
    const socket = new Duplex({
      write(chunk, encoding, callback) {
        written.push(Buffer.from(chunk));
        callback();
      },
      read() {},
    });
    const session = http2.performServerHandshake(socket);
    const native = session[Symbol.for("::bunhttp2native::")];
    const outcome = fn => {
      try {
        const value = fn();
        return value === undefined ? "returned" : "returned " + value;
      } catch (err) {
        return err.name + (err.code ? " " + err.code : "") + ": " + err.message;
      }
    };
    const fill = length => Buffer.alloc(length, "x").toString();
    const quoted = length => 'h2="' + fill(length - 5) + '"';
    // A string of this many bytes in UTF-8. U+4E2D is three bytes.
    const wide = bytes => fill(bytes % 3) + Buffer.alloc(bytes - (bytes % 3), "\u4e2d").toString();
    const shortOrigin = "https://example.org";
    const shortValue = 'h2=":443"';
    const result = { pushPromise: {}, nativeAltsvc: {}, sessionAltsvc: {} };

    for (const [label, parentId, promisedId] of [
      ["(undefined, undefined)", undefined, undefined],
      ["(null, 2)", null, 2],
      ['("1", 2)', "1", 2],
      ["({}, 2)", {}, 2],
      ["(1, undefined)", 1, undefined],
      ['(1, "2")', 1, "2"],
      ["(1, {})", 1, {}],
      ["(NaN, 2)", NaN, 2],
      ["(-1, 2)", -1, 2],
      ["(0, 2)", 0, 2],
      ["(0.5, 2)", 0.5, 2],
      ["(Infinity, 2)", Infinity, 2],
      ["(1, NaN)", 1, NaN],
      ["(1, -4)", 1, -4],
      ["(1, 0)", 1, 0],
      ["(1, Infinity)", 1, Infinity],
    ]) {
      result.pushPromise[label] = outcome(() => native.pushPromise(parentId, promisedId, {}, {}));
    }

    for (const [label, origin, value, streamId = 0] of [
      ["long origin, 16382 bytes with the value", fill(16382 - shortValue.length), shortValue],
      ["long origin, 16383 bytes with the value", fill(16383 - shortValue.length), shortValue],
      ["long value, 16382 bytes with the origin", shortOrigin, quoted(16382 - shortOrigin.length)],
      ["long value, 16383 bytes with the origin", shortOrigin, quoted(16383 - shortOrigin.length)],
      ["origin of 65535 bytes", fill(65535), shortValue],
      ["origin of 65536 bytes", fill(65536), shortValue],
      // The session has no stream 7. A frame for it is not sent, and the length is still checked.
      ["16382 bytes for a stream that does not exist", fill(16382 - shortValue.length), shortValue, 7],
      ["16383 bytes for a stream that does not exist", fill(16383 - shortValue.length), shortValue, 7],
    ]) {
      result.nativeAltsvc[label] = outcome(() => native.altsvc(origin, value, streamId));
    }

    // The origin of an object is sent as it is. One code unit above U+00FF makes it go out as UTF-8.
    for (const bytes of [16382, 16383]) {
      result.sessionAltsvc["UTF-8 origin, " + bytes + " bytes with the value"] = outcome(() =>
        session.altsvc(shortValue, { origin: wide(bytes - shortValue.length) }),
      );
    }

    // The session hands its frames to the transport before the event loop turns.
    setImmediate(() => {
      const bytes = Buffer.concat(written);
      const wideUnit = Buffer.from("\u4e2d").toString("latin1");
      result.pushPromiseFrames = 0;
      result.altsvcFrames = [];
      for (let offset = 0; offset + 9 <= bytes.length; ) {
        const length = bytes.readUIntBE(offset, 3);
        const type = bytes[offset + 3];
        const payload = bytes.subarray(offset + 9, offset + 9 + length);
        if (type === 0x05) result.pushPromiseFrames++;
        if (type === 0x0a) {
          result.altsvcFrames.push({
            streamId: bytes.readUInt32BE(offset + 5),
            originLength: payload.readUInt16BE(0),
            // A run of "x" is written as x{count}, and a run of U+4E2D as W{count}.
            originAndValue: payload
              .subarray(2)
              .toString("latin1")
              .replaceAll(wideUnit, "W")
              .replace(/x{2,}|W{2,}/g, run => run[0] + "{" + run.length + "}"),
          });
        }
        offset += 9 + length;
      }
      console.log(JSON.stringify(result));
      session.destroy();
    });
    `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const tooLong = "TypeError ERR_HTTP2_ALTSVC_LENGTH: HTTP/2 ALTSVC frames are limited to 16382 bytes";
  // stderr is not asserted. It is here so that a crash report shows in the diff.
  expect({ stdout: stdout.trim() && JSON.parse(stdout), stderr, exitCode }).toEqual({
    stdout: {
      pushPromise: {
        "(undefined, undefined)": "Error: Expected parentId to be a number",
        "(null, 2)": "Error: Expected parentId to be a number",
        '("1", 2)': "Error: Expected parentId to be a number",
        "({}, 2)": "Error: Expected parentId to be a number",
        "(1, undefined)": "Error: Expected promisedId to be a number",
        '(1, "2")': "Error: Expected promisedId to be a number",
        "(1, {})": "Error: Expected promisedId to be a number",
        "(NaN, 2)": "Error: Invalid stream id",
        "(-1, 2)": "Error: Invalid stream id",
        "(0, 2)": "Error: Invalid stream id",
        "(0.5, 2)": "Error: Invalid stream id",
        "(Infinity, 2)": "Error: Invalid stream id",
        "(1, NaN)": "Error: Invalid stream id",
        "(1, -4)": "Error: Invalid stream id",
        "(1, 0)": "Error: Invalid stream id",
        // An id above the largest stream id returns -1. That did not change.
        "(1, Infinity)": "returned -1",
      },
      pushPromiseFrames: 0,
      nativeAltsvc: {
        "long origin, 16382 bytes with the value": "returned",
        "long origin, 16383 bytes with the value": tooLong,
        "long value, 16382 bytes with the origin": "returned",
        "long value, 16383 bytes with the origin": tooLong,
        "origin of 65535 bytes": tooLong,
        "origin of 65536 bytes": tooLong,
        "16382 bytes for a stream that does not exist": "returned",
        "16383 bytes for a stream that does not exist": tooLong,
      },
      sessionAltsvc: {
        "UTF-8 origin, 16382 bytes with the value": "returned",
        "UTF-8 origin, 16383 bytes with the value": tooLong,
      },
      altsvcFrames: [
        { streamId: 0, originLength: 16373, originAndValue: 'x{16373}h2=":443"' },
        { streamId: 0, originLength: 19, originAndValue: 'https://example.orgh2="x{16358}"' },
        { streamId: 0, originLength: 16373, originAndValue: 'x{2}W{5457}h2=":443"' },
      ],
    },
    stderr: expect.any(String),
    exitCode: 0,
  });
});
