import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExeAtLeast, tempDir } from "harness";
import { EventEmitter, once } from "node:events";
import { readFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { join } from "node:path";
import { setTimeout as sleepWithSignal } from "node:timers/promises";

// Errors with a Node `code` get their prototype, including `toString`, from the native
// error table (src/jsc/bindings/ErrorCode.cpp).
function nodeError(): Error & { code: string } {
  try {
    // @ts-expect-error the missing argument is the point
    readFileSync();
  } catch (e) {
    return e as Error & { code: string };
  }
  throw new Error("readFileSync() did not throw");
}

describe("node error toString()", () => {
  test("formats name, code and message", () => {
    const err = nodeError();
    expect({ code: err.code, string: err.toString() }).toEqual({
      code: "ERR_INVALID_ARG_TYPE",
      string: `TypeError [ERR_INVALID_ARG_TYPE]: ${err.message}`,
    });
  });

  // The toString of a NodeError closes over the code of its class and does not read `this.code`:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/errors.js#L462-L464
  test("prints the code the error was made with, whatever `code` the receiver has", () => {
    const err = nodeError();
    const text = `TypeError [ERR_INVALID_ARG_TYPE]: ${err.message}`;
    err.code = "CUSTOM";
    expect(err.toString()).toBe(text);
    delete (err as { code?: string }).code;
    expect(err.toString()).toBe(text);
    expect(err.toString.call({ name: "Name", message: "message" })).toBe("Name [ERR_INVALID_ARG_TYPE]: message");
  });

  // The toString of a SystemError reads `this.code`:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/errors.js#L386-L388
  test("a SystemError prints the code that the receiver has", () => {
    using dir = tempDir("error-code-system-error-toString", {});
    let err: any;
    try {
      rmSync(String(dir));
    } catch (e) {
      err = e;
    }
    const text = (code: string) => `SystemError [${code}]: ${err.message}`;
    expect({ code: err.code, string: err.toString() }).toEqual({
      code: "ERR_FS_EISDIR",
      string: text("ERR_FS_EISDIR"),
    });
    err.code = "CUSTOM";
    expect(err.toString()).toBe(text("CUSTOM"));
    delete err.code;
    expect(err.toString()).toBe(text("undefined"));
    expect(err.toString.call({ name: "Name", code: "CODE", message: "message" })).toBe("Name [CODE]: message");
  });

  // A call resolved through a binding that a closure captures is compiled with the scope
  // object itself in the this slot; native functions see it raw. toString() used to read
  // name/code/message off that scope object and return "undefined [undefined]: undefined".
  // Node's toString is strict-mode JS, so it throws on the undefined receiver instead.
  test("called without a receiver through a captured binding throws like Node", () => {
    const { toString } = nodeError();
    function keep() {
      return toString;
    }
    expect(() => toString()).toThrow(TypeError);
    expect(keep()).toBe(toString);
  });

  // Reading a binding that is still in its temporal dead zone through the scope object yields
  // an empty value rather than a TDZ error, and toString() crashed the process (SIGSEGV at
  // address 0x5) when it tried to stringify it.
  test("called through a scope whose `name` binding is in its TDZ does not crash", async () => {
    const src = `
      let toString;
      try {
        require("node:fs").readFileSync();
      } catch (e) {
        ({ toString } = e);
      }
      let result;
      try {
        result = toString();
      } catch (e) {
        result = e.constructor.name;
      }
      console.log(result);
      let name = "initialized only after the call above";
      function keep() {
        return [toString, name];
      }
      keep();
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "TypeError\n", stderr: "", exitCode: 0 });
  });
});

// Node defines the `name [code]: message` toString() on the NodeError classes that makeNodeErrorWithCode makes:
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/errors.js#L462-L464
// The errors below are of no such class in Node.
describe("an error that is no NodeError in Node inherits Error.prototype.toString", () => {
  function expectInheritedToString(err: any) {
    expect(err).toBeInstanceOf(Error);
    expect(String(err)).toBe(`${err.name}: ${err.message}`);
    expect(err.toString).toBe(Error.prototype.toString);
    expect(Object.hasOwn(Object.getPrototypeOf(err), "toString")).toBe(false);
    // The first line of the stack never had the code.
    expect(err.stack.split("\n")[0]).toBe(String(err));
  }

  function rejection(promise: Promise<unknown>): Promise<any> {
    return promise.then(
      () => {
        throw new Error("expected the promise to reject");
      },
      err => err,
    );
  }

  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/errors.js#L979-L988
  describe.concurrent("AbortError", () => {
    function expectAbortError(err: any, reason: unknown) {
      expect({ name: err.name, code: err.code, cause: err.cause, string: String(err) }).toEqual({
        name: "AbortError",
        code: "ABORT_ERR",
        cause: reason,
        string: "AbortError: The operation was aborted",
      });
      expectInheritedToString(err);
    }

    test("timers/promises setTimeout({ signal })", async () => {
      const signal = AbortSignal.abort();
      expectAbortError(await rejection(sleepWithSignal(1, undefined, { signal })), signal.reason);
    });

    test("events.once({ signal })", async () => {
      const reason = new Error("stop");
      expectAbortError(
        await rejection(once(new EventEmitter(), "never", { signal: AbortSignal.abort(reason) })),
        reason,
      );
    });

    // This one is made by native code, the two above by built-in modules.
    test("fs.promises.readFile({ signal })", async () => {
      const signal = AbortSignal.abort();
      expectAbortError(await rejection(readFile(import.meta.path, { signal })), signal.reason);
    });
  });

  // llhttp's error is a plain Error that gets a `code`.
  test("the HPE_* error of an http clientError", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<any>();
    await using server = createServer(() => {});
    server.on("clientError", (err, socket) => {
      socket.destroy();
      resolve(err);
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    const socket = connect(port, "127.0.0.1", () => socket.write("BOGUS\r\n\r\n"));
    socket.on("error", reject);
    socket.on("close", () => reject(new Error("the connection closed and the server emitted no clientError")));
    // Without a reader the socket does not see the server close the connection.
    socket.resume();
    try {
      const err = await promise;
      expect({ name: err.name, code: err.code, string: String(err) }).toEqual({
        name: "Error",
        code: "HPE_INVALID_METHOD",
        string: "Error: Parse Error: Invalid method encountered",
      });
      expectInheritedToString(err);
    } finally {
      socket.destroy();
    }
  });

  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/process/promises.js#L46-L58
  test.concurrent.each(
    ["strict", "throw"].flatMap(mode => [
      [mode, "an uncaughtException listener", `process.on("uncaughtException", report);`],
      [mode, "the capture callback", `process.setUncaughtExceptionCaptureCallback(report);`],
    ]),
  )("the error of an unhandled rejection under --unhandled-rejections=%s, handed to %s", async (mode, _, hook) => {
    const src = `
      function report(err) {
        // strict emits the rejection after this call. A listener keeps the warning about it off stderr.
        process.on("unhandledRejection", () => {});
        console.log(JSON.stringify({
          name: err.name,
          code: err.code,
          string: String(err),
          inherits: err.toString === Error.prototype.toString,
          prototypeHasToString: Object.hasOwn(Object.getPrototypeOf(err), "toString"),
        }));
      }
      ${hook}
      Promise.reject(1);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), `--unhandled-rejections=${mode}`, "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const expected = {
      name: "UnhandledPromiseRejection",
      code: "ERR_UNHANDLED_REJECTION",
      string:
        "UnhandledPromiseRejection: This error originated either by throwing inside of an async function without a catch block, " +
        'or by rejecting a promise which was not handled with .catch(). The promise rejected with the reason "1".',
      inherits: true,
      prototypeHasToString: false,
    };
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: JSON.stringify(expected) + "\n", stderr: "", exitCode: 0 });
  });

  // Node itself says which rows ErrorCode.ts may make with plain(): a producer of each runs there too.
  // Most are errors from native code, which is a plain error that gets a `code`: https://github.com/nodejs/node/blob/v26.3.0/src/node_errors.h#L143-L167
  describe("the rows made with plain()", () => {
    const fixture = join(import.meta.dir, "error-code-toString-fixture.cjs");
    // --no-addons is for ERR_DLOPEN_DISABLED, --unhandled-rejections=throw for ERR_UNHANDLED_REJECTION.
    const flags = ["--no-addons", "--unhandled-rejections=throw"];
    const expected = [
      ["ERR_CLOSED_MESSAGE_PORT", "Error"],
      ["ERR_CONSTRUCT_CALL_INVALID", "TypeError"],
      ["ERR_CRYPTO_INVALID_AUTH_TAG", "TypeError"],
      ["ERR_CRYPTO_INVALID_CURVE", "TypeError"],
      ["ERR_CRYPTO_INVALID_DIGEST", "TypeError"],
      ["ERR_CRYPTO_INVALID_IV", "TypeError"],
      ["ERR_CRYPTO_INVALID_JWK", "TypeError"],
      ["ERR_CRYPTO_INVALID_KEYLEN", "RangeError"],
      ["ERR_CRYPTO_INVALID_KEYPAIR", "RangeError"],
      ["ERR_CRYPTO_INVALID_KEYTYPE", "RangeError"],
      ["ERR_CRYPTO_INVALID_SCRYPT_PARAMS", "RangeError"],
      ["ERR_CRYPTO_JWK_UNSUPPORTED_CURVE", "Error"],
      ["ERR_CRYPTO_JWK_UNSUPPORTED_KEY_TYPE", "Error"],
      ["ERR_CRYPTO_UNKNOWN_CIPHER", "Error"],
      ["ERR_CRYPTO_UNKNOWN_DH_GROUP", "Error"],
      ["ERR_CRYPTO_UNSUPPORTED_OPERATION", "Error"],
      ["ERR_DLOPEN_DISABLED", "Error"],
      ["ERR_INVALID_OBJECT_DEFINE_PROPERTY", "TypeError"],
      ["ERR_LOAD_SQLITE_EXTENSION", "Error"],
      ["ERR_MISSING_PASSPHRASE", "TypeError"],
      ["ERR_OSSL_EVP_INVALID_DIGEST", "Error"],
      ["ERR_SCRIPT_EXECUTION_TIMEOUT", "Error"],
      ["ERR_SQLITE_ERROR", "Error"],
      ["ERR_SSL_NO_CIPHER_MATCH", "Error"],
      ["ERR_TLS_INVALID_PROTOCOL_METHOD", "TypeError"],
      ["ERR_UNHANDLED_REJECTION", "UnhandledPromiseRejection"],
      ["ERR_VM_MODULE_CACHED_DATA_REJECTED", "Error"],
      ["ERR_ZLIB_INITIALIZATION_FAILED", "Error"],
    ].map(([code, name]) => JSON.stringify({ code, name, string: "name: message", inheritsToString: true }));

    // The producers were held against v26.3.0, v26.12.1 and v26.13.0. An older Node refuses some of their inputs in another way.
    for (const [name, runtime, runtimeFlags] of [
      ["bun", bunExe(), flags],
      ["node", nodeExeAtLeast("26.3.0"), [...flags, "--experimental-vm-modules", "--no-warnings"]],
    ] as const) {
      test.skipIf(!runtime)(`inherit Error.prototype.toString (${name})`, async () => {
        await using proc = Bun.spawn({
          cmd: [runtime!, ...runtimeFlags, fixture],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ lines: stdout.trimEnd().split(/\r?\n/), stderr, exitCode }).toEqual({
          lines: expected,
          stderr: "",
          exitCode: 0,
        });
      });
    }
  });

  test("a NodeError keeps `name [code]: message`", () => {
    function thrown(fn: () => unknown): any {
      try {
        fn();
      } catch (err) {
        return err;
      }
      throw new Error("expected the function to throw");
    }

    const rangeError = thrown(() => Buffer.alloc(-1));
    expect({ name: rangeError.name, code: rangeError.code, string: String(rangeError) }).toEqual({
      name: "RangeError",
      code: "ERR_OUT_OF_RANGE",
      string: `RangeError [ERR_OUT_OF_RANGE]: ${rangeError.message}`,
    });
    expect(Object.hasOwn(Object.getPrototypeOf(rangeError), "toString")).toBe(true);

    const typeError = thrown(() => new EventEmitter().on("x", 1 as any));
    expect({ name: typeError.name, code: typeError.code, string: String(typeError) }).toEqual({
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      string: `TypeError [ERR_INVALID_ARG_TYPE]: ${typeError.message}`,
    });
  });
});
