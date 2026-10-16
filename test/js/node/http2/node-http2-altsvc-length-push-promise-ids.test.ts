// session.altsvc() and stream.pushStream() check their arguments and then call the native
// session object. Script can also call that object itself: every HTTP/2 session has a getter
// named Symbol.for("::bunhttp2native::") that returns it.
//
// The native altsvc() cast the length of the origin to 16 bits. An origin longer than 65535
// bytes ended the process with "panic: int cast: TryFromIntError(PosOverflow)". A shorter one
// went out as a frame larger than 16384 bytes, the smallest SETTINGS_MAX_FRAME_SIZE. The
// public session.altsvc() sent such a frame too, for an origin that goes out as UTF-8: it
// counts code units, and the frame holds bytes.
//
// The native pushPromise() converted an id that is not a number. A build with assertions
// stopped at "ASSERTION FAILED: value.isHeapBigInt() || value.isNumber()". A release build
// wrote a PUSH_PROMISE frame with id 0.
//
// The fixture runs in a subprocess because those failures kill the process.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";

test(
  "native pushPromise() and altsvc() throw for ids that are not numbers and for an ALTSVC frame that is too long",
  async () => {
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
          fn();
          return "returned";
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
      ]) {
        result.pushPromise[label] = outcome(() => native.pushPromise(parentId, promisedId, {}, {}));
      }

      for (const [label, origin, value] of [
        ["long origin, 16382 bytes with the value", fill(16382 - shortValue.length), shortValue],
        ["long origin, 16383 bytes with the value", fill(16383 - shortValue.length), shortValue],
        ["long value, 16382 bytes with the origin", shortOrigin, quoted(16382 - shortOrigin.length)],
        ["long value, 16383 bytes with the origin", shortOrigin, quoted(16383 - shortOrigin.length)],
        ["origin of 65535 bytes", fill(65535), shortValue],
        ["origin of 65536 bytes", fill(65536), shortValue],
      ]) {
        result.nativeAltsvc[label] = outcome(() => native.altsvc(origin, value, 0));
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
        },
        pushPromiseFrames: 0,
        nativeAltsvc: {
          "long origin, 16382 bytes with the value": "returned",
          "long origin, 16383 bytes with the value": tooLong,
          "long value, 16382 bytes with the origin": "returned",
          "long value, 16383 bytes with the origin": tooLong,
          "origin of 65535 bytes": tooLong,
          "origin of 65536 bytes": tooLong,
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
  },
  // A debug build needs about 3 s to load node:http2, which is near the default timeout.
  isDebug ? 30_000 : undefined,
);
