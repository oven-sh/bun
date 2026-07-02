import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tmpdirSync } from "harness";

import { ok } from "node:assert/strict";

const wasmDataUriPrefix = "data:application/wasm;base64,";

// (module
//   (import "env" "reciprocal" (func $reciprocal (param f64) (result f64)))
//   (export "div" (func $div))
//   (func $div (param f64 f64) (result f64)
//     (f64.mul
//       (local.get 0)
//       (call $reciprocal (local.get 1))
//     )
//   )
// )
const simpleWasm = "AGFzbQEAAAABDAJgAXwBfGACfHwBfAISAQNlbnYKcmVjaXByb2NhbAAAAwIBAQcHAQNkaXYAAQoLAQkAIAAgARAAogs=";
const simpleWasmUri = wasmDataUriPrefix + simpleWasm;

// (module
//   (export "add" (func $add))
//   (func $add (param i32 i32) (result i32)
//     (i32.add (local.get 0) (local.get 1))
//   )
// )
const simplerWasmUri = wasmDataUriPrefix + "AGFzbQEAAAABBwFgAn9/AX8DAgEABwcBA2FkZAAACgkBBwAgACABags=";

// (module
//   (export "foo" (func $foo))
//   (func $foo (param i64) (result f64)
//     local.get 0
//     i64.extend8_s ;; 0xC2
//     f64.reinterpret_i64 ;; 0xBF
//   )
// )
const validUtf8Wasm =
  // The ¿ near the end of the string is represented by two bytes (0xC2 and 0xBF) in UTF-8.
  "\x00asm\x01\x00\x00\x00\x01\x06\x01`\x01~\x01|\x03\x02\x01\x00\x07\x07\x01\x03foo\x00\x00\n\b\x01\x06\x00 \x00¿\x0B";

const responseFromStream = (pull: (controller: ReadableStreamDefaultController<any>) => void | PromiseLike<void>) =>
  new Response(new ReadableStream({ pull }), {
    headers: {
      "Content-Type": "application/wasm",
    },
  });

describe("WebAssembly.compileStreaming", () => {
  test("compiles a non-streaming Response", async () => {
    const response = await fetch(simpleWasmUri);
    expect(WebAssembly.compileStreaming(response)).resolves.toBeInstanceOf(WebAssembly.Module);
  });

  test("compiles a resolved Promise to a non-streaming Response", async () => {
    const promise = Promise.resolve(await fetch(simpleWasmUri));
    expect(WebAssembly.compileStreaming(promise)).resolves.toBeInstanceOf(WebAssembly.Module);
  });

  test("compiles a pending Promise to a non-streaming Response", async () => {
    const response = await fetch(simpleWasmUri);
    const promise = Bun.sleep(100).then(() => response);
    expect(WebAssembly.compileStreaming(promise)).resolves.toBeInstanceOf(WebAssembly.Module);
  });

  // Errors:

  test("doesn't compile a rejected Promise", async () => {
    const error = new Error("sudden explosion");
    const promise = Promise.reject(error);
    expect(WebAssembly.compileStreaming(promise)).rejects.toBe(error);
  });

  test("doesn't compile a non-Response", async () => {
    const nonResponse = Buffer.from("not a Response");
    // @ts-expect-error nonResponse is not a Response
    await expect(WebAssembly.compileStreaming(nonResponse)).rejects.toThrow(
      `The "source" argument must be an instance of Response or an Promise resolving to Response. Received an instance of Buffer`,
    );
  });

  test("doesn't compile a response with the wrong MIME type", async () => {
    const response = await fetch("data:image/png;base64," + simpleWasm);
    expect(WebAssembly.compileStreaming(response)).rejects.toThrow(
      "WebAssembly response has unsupported MIME type 'image/png'",
    );
  });

  // https://webassembly.github.io/spec/web-api/#compile-a-potential-webassembly-response
  // requires a byte-case-insensitive match for `application/wasm`, with no
  // parameters. Mirrors WPT wasm/webapi/contenttype.any.js.
  describe("Content-Type matching", () => {
    const wasmBody = () => Buffer.from(simpleWasm, "base64");

    test.each(["application/wasm", "APPLICATION/wasm", "APPLICATION/WASM"])(
      "accepts Content-Type %j",
      async contentType => {
        const response = new Response(wasmBody(), { headers: { "Content-Type": contentType } });
        await expect(WebAssembly.compileStreaming(response)).resolves.toBeInstanceOf(WebAssembly.Module);
      },
    );

    test("accepts a case-insensitive Content-Type over HTTP", async () => {
      await using server = Bun.serve({
        port: 0,
        fetch: () => new Response(wasmBody(), { headers: { "Content-Type": "APPLICATION/WASM" } }),
      });
      const response = await fetch(server.url);
      expect(response.headers.get("content-type")).toBe("APPLICATION/WASM");
      await expect(WebAssembly.compileStreaming(response)).resolves.toBeInstanceOf(WebAssembly.Module);
    });

    test.each([
      "",
      // A case-insensitive prefix of "application/wasm" must not match.
      "application",
      "application/javascript",
      "application/octet-stream",
      "text/wasm",
      "application/wasm;",
      "application/wasm;x",
      "application/wasm;charset=UTF-8",
    ])("rejects Content-Type %j", async contentType => {
      const response = new Response(wasmBody(), { headers: { "Content-Type": contentType } });
      // An empty Content-Type header value reads back as absent, so it echoes as 'null'.
      const echoed = contentType === "" ? "null" : contentType;
      await expect(WebAssembly.compileStreaming(response)).rejects.toThrow(
        `WebAssembly response has unsupported MIME type '${echoed}'`,
      );
    });

    test("rejects a missing Content-Type", async () => {
      const response = new Response(wasmBody());
      response.headers.delete("Content-Type");
      await expect(WebAssembly.compileStreaming(response)).rejects.toThrow(
        "WebAssembly response has unsupported MIME type 'null'",
      );
    });
  });

  test("doesn't compile a Response that isn't OK", async () => {
    const response = new Response(Buffer.from(simpleWasm), {
      headers: {
        "Content-Type": "application/wasm",
      },
      status: 418,
    });

    expect(WebAssembly.compileStreaming(response)).rejects.toThrow("WebAssembly response has status code 418");
  });

  test("doesn't compile a used streaming response", async () => {
    let i = 0;
    const response = responseFromStream(async controller => {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      if (i == 3) controller.close();
      i++;
    });

    // @ts-expect-error ReadableStreams are in fact async iterables
    for await (const _ of response.body); // Consume the stream
    ok(response.bodyUsed);

    expect(WebAssembly.compileStreaming(response)).rejects.toThrow("WebAssembly response body has already been used");
  });

  test("doesn't compile a streaming response that throws while streaming", async () => {
    let i = 0;
    const error = new Error("sudden explosion in stream");
    const response = responseFromStream(async controller => {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      if (i == 3) throw error;
      i++;
    });

    expect(WebAssembly.compileStreaming(response)).rejects.toBe(error);
  });

  test("doesn't compile a streaming response that yields neither ArrayBuffer nor ArrayBufferView", async () => {
    const response = responseFromStream(async controller => {
      controller.enqueue("something random");
    });

    expect(WebAssembly.compileStreaming(response)).rejects.toThrow(
      "chunk must be an ArrayBufferView or an ArrayBuffer",
    );
  });

  test("doesn't compile a streaming response that yields a detached TypedArray", async () => {
    const response = responseFromStream(async controller => {
      const array = new Uint8Array(123);
      array.buffer.transfer();
      controller.enqueue(array);
    });

    expect(WebAssembly.compileStreaming(response)).rejects.toThrow(
      "Underlying ArrayBuffer has been detached from the view or out-of-bounds",
    );
  });

  test("doesn't compile a streaming response that yields a detached ArrayBuffer", async () => {
    const response = responseFromStream(async controller => {
      const buffer = new ArrayBuffer(123);
      buffer.transfer();
      controller.enqueue(buffer);
    });

    expect(WebAssembly.compileStreaming(response)).rejects.toThrow(
      "Underlying ArrayBuffer has been detached from the view or out-of-bounds",
    );
  });

  test("doesn't compile a response that isn't valid WebAssembly", async () => {
    const response = await fetch("data:application/wasm,This is not actually Wasm");
    expect(WebAssembly.compileStreaming(response)).rejects.toBeInstanceOf(WebAssembly.CompileError);
  });
});

describe("streaming a module whose function body fails validation", () => {
  // The streaming compiler parses section framing on the main thread and compiles
  // each function body on a worklist thread, so this error path is distinct from a
  // malformed header. https://github.com/oven-sh/WebKit/pull/265
  test("rejects with CompileError instead of crashing", async () => {
    const fixture = `
      // 3 functions of type () -> (); the bytes are framing-valid, but the last
      // function body leaves an i32 on the stack, so it fails validation.
      const bytes = Uint8Array.from([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic + version
        0x01, 0x04, 0x01, 0x60, 0x00, 0x00, // type section: 1 type, () -> ()
        0x03, 0x04, 0x03, 0x00, 0x00, 0x00, // function section: 3 functions of type 0
        0x0a, 0x0d, 0x03, // code section: 3 bodies
        0x02, 0x00, 0x0b, // (func)
        0x03, 0x00, 0x01, 0x0b, // (func nop)
        0x04, 0x00, 0x41, 0x00, 0x0b, // (func i32.const 0): invalid
      ]);
      console.log("validate:", WebAssembly.validate(bytes));
      const headers = { "Content-Type": "application/wasm" };

      const compiled = await WebAssembly.compileStreaming(new Response(bytes, { headers })).then(
        () => "resolved",
        e => e.constructor.name,
      );
      console.log("compileStreaming:", compiled);

      // Deliver the code section in a second chunk so the stream turns invalid late.
      const response = new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.slice(0, 20));
            controller.enqueue(bytes.slice(20));
            controller.close();
          },
        }),
        { headers },
      );
      const instantiated = await WebAssembly.instantiateStreaming(response).then(
        () => "resolved",
        e => e.constructor.name,
      );
      console.log("instantiateStreaming:", instantiated);
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "validate: false
      compileStreaming: CompileError
      instantiateStreaming: CompileError"
    `);
    expect(exitCode).toBe(0);
  });
});

describe("WebAssembly.instantiateStreaming", () => {
  const imports = {
    env: {
      reciprocal: (x: number) => 1 / x,
    },
  };

  const instantiateAndGetExports = async (
    responseOrPromise: Response | PromiseLike<Response>,
    importsMaybe?: Bun.WebAssembly.Imports,
  ) => {
    const { instance } = await WebAssembly.instantiateStreaming(responseOrPromise, importsMaybe);
    return instance.exports;
  };

  test("instantiates a non-streaming response", async () => {
    const response = await fetch(simpleWasmUri);
    expect(instantiateAndGetExports(response, imports)).resolves.toHaveProperty("div");
  });

  test("instantiates a non-streaming response, without an import object", async () => {
    const response = await fetch(simplerWasmUri);
    expect(instantiateAndGetExports(response)).resolves.toHaveProperty("add");
  });

  test("instantiates a pending Promise to a non-streaming response", async () => {
    const response = await fetch(simpleWasmUri);
    const promise = Bun.sleep(100).then(() => response);
    expect(instantiateAndGetExports(promise, imports)).resolves.toHaveProperty("div");
  });

  test("instantiates a Bun.file() response", async () => {
    const path = tmpdirSync() + "/simple.wasm";
    await Bun.write(path, Buffer.from(simpleWasm, "base64"));

    const response = new Response(Bun.file(path));
    expect(instantiateAndGetExports(response, imports)).resolves.toHaveProperty("div");
  });

  test("instantiates a ReadableStream response", async () => {
    const buffer = Buffer.from(simpleWasm, "base64");
    let i = 0;
    const response = responseFromStream(async controller => {
      const chunkSize = 10;

      await Bun.sleep(10);
      controller.enqueue(buffer.subarray(i, i + chunkSize));

      i += chunkSize;
      if (i >= buffer.length) controller.close();
    });

    expect(instantiateAndGetExports(response, imports)).resolves.toHaveProperty("div");
  });

  test("instantiates a string response", async () => {
    const response = new Response(validUtf8Wasm, {
      headers: {
        "Content-Type": "application/wasm",
      },
    });

    expect(instantiateAndGetExports(response)).resolves.toHaveProperty("foo");
  });

  // Errors:

  test("doesn't instantiate a response without the correct import object", async () => {
    const response = await fetch(simpleWasmUri);
    expect(instantiateAndGetExports(response)).rejects.toThrow(
      "can't make WebAssembly.Instance because there is no imports Object and the WebAssembly.Module requires imports",
    );
  });
});
