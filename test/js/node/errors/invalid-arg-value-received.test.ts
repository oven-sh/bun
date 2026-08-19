// Node's ERR_INVALID_ARG_VALUE renders the received value with util.inspect and,
// when that is longer than 128 characters, keeps the first 128 and appends "...".
// Every Bun path that builds the message (the C++ overloads in ErrorCode.cpp, the
// $ERR_INVALID_ARG_VALUE dispatch used by the JS builtins, and the Rust callers of
// inspect_for_error_message) has to apply the same cut. The expected messages below
// are what node v26 prints for the same calls.
import { exposedInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { fork } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";

const long = "x".repeat(200);
// `long` inspects to 202 characters (quotes included); the first 128 of them are
// the opening quote plus 127 x's.
const longCut = "'" + "x".repeat(127) + "...";

function thrownBy(fn: () => unknown) {
  try {
    fn();
  } catch (e: any) {
    return { name: e.constructor.name, code: e.code, message: e.message };
  }
  throw new Error("expected the call to throw");
}

function received(message: string) {
  const marker = ". Received ";
  const index = message.indexOf(marker);
  expect(index).toBeGreaterThan(0);
  return message.slice(index + marker.length);
}

describe("ERR_INVALID_ARG_VALUE cuts the received value at 128 characters like node", () => {
  test.each([
    [
      "Buffer#fill (native, default reason)",
      () => Buffer.alloc(4).fill(long, "hex"),
      `The argument 'value' is invalid. Received ${longCut}`,
    ],
    [
      "module.createRequire (native, custom reason)",
      () => createRequire(long),
      `The argument 'filename' must be a file URL object, file URL string, or absolute path string. Received ${longCut}`,
    ],
    [
      "validateOneOf via http.Agent scheduling (native, list of allowed values)",
      () => new http.Agent({ scheduling: long as any }),
      `The argument 'scheduling' must be one of: 'fifo', 'lifo'. Received ${longCut}`,
    ],
    [
      "crypto.generateKeyPairSync encoding format (native, computed property name)",
      () => generateKeyPairSync("ed25519", { publicKeyEncoding: { format: long as any, type: "spki" } }),
      `The property 'options.publicKeyEncoding.format' is invalid. Received ${longCut}`,
    ],
    [
      "net.Socket objectMode ($ERR_INVALID_ARG_VALUE with a reason)",
      () => new net.Socket({ objectMode: long } as any),
      `The property 'options.objectMode' is not supported. Received ${longCut}`,
    ],
    [
      "child_process.fork stdio ($ERR_INVALID_ARG_VALUE without a reason)",
      () => fork("/does-not-matter-validation-throws-first.js", [], { stdio: long as any }),
      `The argument 'stdio' is invalid. Received ${longCut}`,
    ],
    [
      "fs.openSync flags (rust, inspect_for_error_message)",
      () => fs.openSync("x", long),
      `The argument 'flags' is invalid. Received ${longCut}`,
    ],
    [
      "fs.openSync mode (rust, inspect_for_error_message)",
      () => fs.openSync("x", "r", "9".repeat(200)),
      `The argument 'mode' must be a 32-bit unsigned integer or an octal string. Received '${"9".repeat(127)}...`,
    ],
    [
      "non-latin1 string",
      () => Buffer.alloc(4).fill("\u00e9\u4e2d".repeat(100), "hex"),
      `The argument 'value' is invalid. Received '${"\u00e9\u4e2d".repeat(63)}\u00e9...`,
    ],
  ])("%s", (_name, fn, message) => {
    expect(thrownBy(fn)).toEqual({ name: "TypeError", code: "ERR_INVALID_ARG_VALUE", message });
  });

  test("a value that inspects to exactly 128 characters is kept whole", () => {
    const value = "q".repeat(126);
    expect(thrownBy(() => Buffer.alloc(4).fill(value, "hex")).message).toBe(
      `The argument 'value' is invalid. Received '${value}'`,
    );
  });

  test("a value that inspects to 129 characters is cut", () => {
    const value = "q".repeat(127);
    expect(thrownBy(() => Buffer.alloc(4).fill(value, "hex")).message).toBe(
      `The argument 'value' is invalid. Received '${value}...`,
    );
  });

  test("short values are not touched", () => {
    expect(thrownBy(() => Buffer.alloc(4).fill("zz z", "hex")).message).toBe(
      "The argument 'value' is invalid. Received 'zz z'",
    );
    expect(thrownBy(() => new http.Agent({ scheduling: 42 as any })).message).toBe(
      "The argument 'scheduling' must be one of: 'fifo', 'lifo'. Received 42",
    );
  });

  test("objects are cut after being inspected", () => {
    const error = thrownBy(() => new http.Agent({ scheduling: { mode: long } as any }));
    expect(error).toMatchObject({ name: "TypeError", code: "ERR_INVALID_ARG_VALUE" });
    const value = received(error.message);
    expect(value).toStartWith("{ mode: ");
    expect(value).toEndWith("...");
    expect(value).toHaveLength(128 + "...".length);
  });

  test("the RangeError overload (ReadableByteStreamController BYOB view) is cut too", async () => {
    let error: any;
    const stream = new ReadableStream({
      type: "bytes",
      pull(controller) {
        const request = controller.byobRequest!;
        try {
          // byteOffset 1 can never match the request's write position of 0.
          request.respondWithNewView(new Uint8Array(200).subarray(1));
        } catch (e) {
          error = e;
        }
        controller.close();
        request.respond(0);
      },
    });
    await stream.getReader({ mode: "byob" }).read(new Uint8Array(200));

    expect(error).toBeInstanceOf(RangeError);
    expect(error.code).toBe("ERR_INVALID_ARG_VALUE");
    expect(error.message).toStartWith(
      "The argument 'view' must match the BYOB request's current write position. Received Uint8Array(199) [",
    );
    expect(received(error.message)).toEndWith("...");
    expect(received(error.message)).toHaveLength(128 + "...".length);
  });

  test("validateArray minLength (native overload taking the name as a JSValue) is cut too", () => {
    const { validateArray } = exposedInternals["internal/validators"];
    const error = thrownBy(() => validateArray(new Array(60).fill("abcdef"), "list", 100));
    expect(error.code).toBe("ERR_INVALID_ARG_VALUE");
    expect(received(error.message)).toStartWith('[ "abcdef", ');
    expect(received(error.message)).toEndWith("...");
    expect(received(error.message)).toHaveLength(128 + "...".length);
  });

  test("$ERR_INVALID_ARG_VALUE_RangeError (stream/iter encoding) is cut too", async () => {
    const script = `
      const { text } = require("node:stream/iter");
      Promise.resolve()
        .then(() => text(["a"], { encoding: "x".repeat(200) }))
        .then(
          () => console.log("resolved"),
          e => console.log(JSON.stringify({ name: e.constructor.name, code: e.code, message: e.message })),
        );
    `;
    await using proc = Bun.spawn({
      // --no-warnings silences the stream/iter ExperimentalWarning so stderr is empty on success.
      cmd: [bunExe(), "--no-warnings", "--experimental-stream-iter", "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      name: "RangeError",
      code: "ERR_INVALID_ARG_VALUE",
      message: `The property 'options.encoding' is invalid. Received ${longCut}`,
    });
    expect(exitCode).toBe(0);
  });
});
