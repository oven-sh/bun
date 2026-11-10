import assert from "assert";
import { describe, expect } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  const nodePolyfillList = {
    "assert": "polyfill",
    "buffer": "polyfill",
    "child_process": "no-op",
    "cluster": "no-op",
    "console": "polyfill",
    "constants": "polyfill",
    "crypto": "polyfill",
    "dgram": "no-op",
    "dns": "no-op",
    "domain": "polyfill",
    "events": "polyfill",
    "fs": "no-op",
    "http": "polyfill",
    "https": "polyfill",
    "module": "no-op",
    "net": "polyfill",
    "os": "polyfill",
    "path": "polyfill",
    "perf_hooks": "no-op",
    "process": "polyfill",
    "punycode": "polyfill",
    "querystring": "polyfill",
    "readline": "no-op",
    "repl": "no-op",
    "stream": "polyfill",
    "string_decoder": "polyfill",
    "sys": "polyfill",
    "timers": "polyfill",
    "tls": "no-op",
    "tty": "polyfill",
    "url": "polyfill",
    "util": "polyfill",
    "v8": "no-op",
    "vm": "no-op",
    "zlib": "polyfill",
  };

  itBundled("browser/NodeBuffer#21522", {
    files: {
      "/entry.js": /* js */ `
        import { Buffer } from "node:buffer";
        const x = Buffer.alloc(5);
        x.write("68656c6c6f", "hex");
        console.log(x);
      `,
    },
    target: "browser",
    run: {
      stdout: "<Buffer 68 65 6c 6c 6f>",
    },
    onAfterBundle(api) {
      api.expectFile("out.js").not.toInclude("import ");
    },
  });
  itBundled("browser/NodeBuffer#12272", {
    files: {
      "/entry.js": /* js */ `
        import * as buffer from "node:buffer";
        import { Buffer } from "buffer";
        import Buffer2 from "buffer";
        import { Blob, File } from "buffer";
        if (Buffer !== Buffer2) throw new Error("Buffer is not the same");
        if (Blob !== globalThis.Blob) throw new Error("Blob is not the same");
        if (File !== globalThis.File) throw new Error("File is not the same");
        if (Buffer.from("foo").toString("hex") !== "666f6f") throw new Error("Buffer.from is broken");
        if (buffer.isAscii("foo") !== true) throw new Error("Buffer.isAscii is broken");
        if (Buffer2.alloc(10, 'b').toString("hex") !== "62626262626262626262") throw new Error("Buffer.alloc is broken");
        console.log("Success!");
      `,
    },
    target: "browser",
    run: {
      stdout: "Success!",
    },
    onAfterBundle(api) {
      api.expectFile("out.js").not.toInclude("import ");
    },
  });
  itBundled("browser/NodeFS", {
    files: {
      "/entry.js": /* js */ `
        import * as fs from "node:fs";
        import * as fs2 from "fs";
        import { readFileSync } from "fs";
        console.log(typeof fs);
        console.log(typeof fs2);
        console.log(typeof readFileSync);
      `,
    },
    target: "browser",
    run: {
      stdout: "function\nfunction\nundefined",
    },
    onAfterBundle(api) {
      api.expectFile("out.js").not.toInclude("import ");
    },
  });
  itBundled("browser/NodeTTY", {
    files: {
      "/entry.js": /* js */ `
        import { isatty, ReadStream, WriteStream } from "node:tty";
        console.log(typeof ReadStream);
        console.log(typeof WriteStream);
        console.log(isatty(0));
      `,
    },
    target: "browser",
    run: {
      stdout: "function\nfunction\nfalse",
    },
    onAfterBundle(api) {
      api.expectFile("out.js").not.toInclude("import ");
    },
  });
  // The polyfill is plain JS bundled into the user's output, so it cannot use
  // JSC builtin intrinsics ($newPromiseCapability and friends). Those are
  // only rewritten inside src/js; in a browser bundle they are bare globals.
  itBundled("browser/NodeEventsOnce", {
    files: {
      "/entry.js": /* js */ `
        import { once, EventEmitter } from "node:events";
        const results = [];
        {
          const e = new EventEmitter();
          const p = once(e, "hello");
          e.emit("hello", 1, "two");
          results.push(JSON.stringify(await p));
        }
        {
          const e = new EventEmitter();
          const p = once(e, "never");
          e.emit("error", new Error("boom"));
          results.push(await p.then(() => "resolved", err => "rejected:" + err.message));
          results.push(e.listenerCount("never") + "," + e.listenerCount("error"));
        }
        {
          const e = new EventEmitter();
          const ac = new AbortController();
          const p = once(e, "never", { signal: ac.signal });
          ac.abort();
          results.push(await p.then(() => "resolved", err => err.name + ":" + err.code));
          results.push(e.listenerCount("never") + "," + e.listenerCount("error"));
        }
        {
          const et = new EventTarget();
          const p = once(et, "ping");
          et.dispatchEvent(new Event("ping"));
          const [ev] = await p;
          results.push(ev.type);
        }
        console.log(results.join("\\n"));
      `,
    },
    target: "browser",
    run: {
      stdout: '[1,"two"]\nrejected:boom\n0,0\nAbortError:ABORT_ERR\n0,0\nping',
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      assert(!out.includes("$newPromiseCapability"), "events polyfill must not reference a JSC builtin intrinsic");
    },
  });
  // Makes bun like a page that is not cross-origin isolated. node:vm gives the buffers of another realm, as an iframe does.
  const likeAPage = {
    "/like-a-page.js": /* js */ `
      import vm from "node:vm";
      const isShared = buffer => Object.prototype.toString.call(buffer) === "[object SharedArrayBuffer]";
      let openChannels = 0;
      const { close } = MessagePort.prototype;
      MessagePort.prototype.close = function () {
        openChannels--;
        return close.call(this);
      };
      globalThis.MessageChannel = class extends MessageChannel {
        constructor() {
          super();
          openChannels++;
        }
      };
      globalThis.openChannels = () => openChannels;
      globalThis.anotherRealm = vm.runInNewContext("({ ArrayBuffer, Uint8Array })");
      for (const name of ["process", "Buffer", "global", "setImmediate", "clearImmediate", "SharedArrayBuffer"]) {
        delete globalThis[name];
      }
      const getRandomValues = crypto.getRandomValues.bind(crypto);
      crypto.getRandomValues = view => {
        if (isShared(view.buffer)) throw new TypeError("The view must not be shared.");
        if (view.byteLength > 65536) throw new DOMException("The quota is 65536 bytes.", "QuotaExceededError");
        return getRandomValues(view);
      };
      await import("./out.js");
    `,
  };
  const cryptoKnownAnswers = JSON.stringify({
    sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    sha256OfDataView: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    md5OfUint8Array: "900150983cd24fb0d6963f7d28e17f72",
    hmac: "4fd0b215276ef12f2b3e4c8ecac2811498b656fc",
    hmacWithArrayBufferKey: "4fd0b215276ef12f2b3e4c8ecac2811498b656fc",
    hmacWithDataViewKey: "4fd0b215276ef12f2b3e4c8ecac2811498b656fc",
    pbkdf2: "653cc888d937efe22810a5cbdb25a5bd",
    encrypted: "4c55a6ffda2e565b40c2051d3d067614",
    decrypted: "hello",
    cbc: "f230676c38a7d716ebed81718e4fc8aa",
    gcm: "3b817c0fa9:7ef3cdbe510337cbe05016fa1582e394",
    ecdhSecretsAgree: true,
    randomBytesDiffer: true,
  });
  itBundled("browser/NodeCryptoPolyfill", {
    files: {
      "/entry.js": /* js */ `
        import { createHash, createHmac, randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv, createECDH } from "node:crypto";
        import { Buffer } from "node:buffer";
        const abc = new TextEncoder().encode("abc");
        const hmacKey = new TextEncoder().encode("key");
        const key = Buffer.alloc(16, 1);
        const cipher = createCipheriv("aes-128-ecb", key, "");
        const decipher = createDecipheriv("aes-128-ecb", key, "");
        const cbc = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 2));
        const gcm = createCipheriv("aes-128-gcm", key, Buffer.alloc(12, 2));
        const alice = createECDH("secp256k1");
        const bob = createECDH("secp256k1");
        alice.generateKeys();
        bob.generateKeys();
        console.log(JSON.stringify({
          sha256: createHash("sha256").update("abc").digest("hex"),
          sha256OfDataView: createHash("sha256").update(new DataView(abc.buffer)).digest("hex"),
          md5OfUint8Array: createHash("md5").update(abc).digest("hex"),
          hmac: createHmac("sha1", "key").update("abc").digest("hex"),
          hmacWithArrayBufferKey: createHmac("sha1", hmacKey.buffer).update("abc").digest("hex"),
          hmacWithDataViewKey: createHmac("sha1", new DataView(hmacKey.buffer)).update("abc").digest("hex"),
          pbkdf2: pbkdf2Sync("password", "salt", 10, 16, "sha256").toString("hex"),
          encrypted: Buffer.concat([cipher.update("hello"), cipher.final()]).toString("hex"),
          decrypted: Buffer.concat([decipher.update("4c55a6ffda2e565b40c2051d3d067614", "hex"), decipher.final()]).toString(),
          cbc: Buffer.concat([cbc.update("hello"), cbc.final()]).toString("hex"),
          gcm: Buffer.concat([gcm.update("hello"), gcm.final()]).toString("hex") + ":" + gcm.getAuthTag().toString("hex"),
          ecdhSecretsAgree:
            alice.computeSecret(bob.getPublicKey()).toString("hex") === bob.computeSecret(alice.getPublicKey()).toString("hex"),
          randomBytesDiffer: randomBytes(16).toString("hex") !== randomBytes(16).toString("hex"),
        }));
      `,
    },
    runtimeFiles: likeAPage,
    target: "browser",
    run: [{ stdout: cryptoKnownAnswers }, { file: "/like-a-page.js", stdout: cryptoKnownAnswers }],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out.split("BN.wordSize = 26").length - 1, "one copy of bn.js 4 and one of bn.js 5").toBe(2);
      expect(out).not.toContain("localStorage");
    },
  });
  const cryptoDefaultImport = JSON.stringify({
    createHash: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    missing: [],
    extra: [],
    subtle: "function",
    webcrypto: true,
    timingSafeEqual: [true, false],
    randomFillSync: [false, true, false],
    randomFillSyncOfElements: [false, true, false],
    randomFillSyncOfSharedMemory: [false, true, false],
    randomFill: true,
    randomFillFromOffset: [false, true],
    randomBytes: 8,
    errorCodes: ["ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH", "ERR_OUT_OF_RANGE", "ERR_OUT_OF_RANGE", "ERR_INVALID_ARG_TYPE"],
  });
  itBundled("browser/NodeCryptoPolyfillDefaultImport", {
    files: {
      "/entry.js": /* js */ `
        import crypto from "node:crypto";
        import * as namespace from "node:crypto";
        const named = Object.keys(namespace).filter(name => name !== "default");
        const filled = (bytes, start, end) => bytes.subarray(start, end).some(byte => byte !== 0);
        const view = new Uint8Array(48);
        crypto.randomFillSync(new Uint8Array(view.buffer, 16, 16));
        const elements = new Uint8Array(48);
        crypto.randomFillSync(new Uint16Array(elements.buffer, 16, 8), 2, 4);
        const shared = new Uint8Array(new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }).buffer);
        crypto.randomFillSync(new Uint8Array(shared.buffer, 16, 16));
        const codeOf = fn => {
          try {
            fn();
          } catch (error) {
            return error.code;
          }
        };
        console.log(JSON.stringify({
          createHash: crypto.createHash("sha256").update("abc").digest("hex"),
          missing: named.filter(name => crypto[name] !== namespace[name]),
          extra: Object.keys(crypto).filter(name => !named.includes(name)),
          subtle: typeof crypto.subtle.digest,
          webcrypto: crypto.webcrypto === globalThis.crypto,
          timingSafeEqual: [
            crypto.timingSafeEqual(new Uint8Array([1, 0, 2, 0]), new Uint16Array([1, 2])),
            crypto.timingSafeEqual(new Uint8Array([1]), new Uint8Array([2])),
          ],
          randomFillSync: [filled(view, 0, 16), filled(view, 16, 32), filled(view, 32, 48)],
          randomFillSyncOfElements: [filled(elements, 0, 20), filled(elements, 20, 28), filled(elements, 28, 48)],
          randomFillSyncOfSharedMemory: [filled(shared, 0, 16), filled(shared, 16, 32), filled(shared, 32, 48)],
          randomFill: await new Promise(resolve => {
            crypto.randomFill(new Uint8Array(16), (error, bytes) => resolve(error ?? filled(bytes, 0, 16)));
          }),
          randomFillFromOffset: await new Promise(resolve => {
            crypto.randomFill(new Uint8Array(16), 8, (error, bytes) => {
              resolve(error ?? [filled(bytes, 0, 8), filled(bytes, 8, 16)]);
            });
          }),
          randomBytes: await new Promise(resolve => {
            crypto.randomBytes(8, (error, bytes) => resolve(error ?? bytes.length));
          }),
          errorCodes: [
            codeOf(() => crypto.timingSafeEqual(new Uint8Array(1), new Uint8Array(2))),
            codeOf(() => crypto.randomFillSync(new Uint8Array(4), 5)),
            codeOf(() => crypto.randomFillSync(new Uint8Array(4), 2, 3)),
            codeOf(() => crypto.randomFillSync("not a buffer")),
          ],
        }));
      `,
    },
    runtimeFiles: likeAPage,
    target: "browser",
    run: [{ stdout: cryptoDefaultImport }, { file: "/like-a-page.js", stdout: cryptoDefaultImport }],
  });
  // node v26.3.0 prints this text for the entry file of the next test, where node:crypto is its own.
  const cryptoLikeNode = `
    randomFillSync(undefined): TypeError [ERR_INVALID_ARG_TYPE] The "buf" argument must be an instance of ArrayBuffer or ArrayBufferView. Received undefined
    randomFillSync(null): TypeError [ERR_INVALID_ARG_TYPE] The "buf" argument must be an instance of ArrayBuffer or ArrayBufferView. Received null
    randomFillSync(1): TypeError [ERR_INVALID_ARG_TYPE] The "buf" argument must be an instance of ArrayBuffer or ArrayBufferView. Received type number (1)
    randomFillSync(-0): TypeError [ERR_INVALID_ARG_TYPE] The "buf" argument must be an instance of ArrayBuffer or ArrayBufferView. Received type number (-0)
    randomFillSync(NaN): TypeError [ERR_INVALID_ARG_TYPE] The "buf" argument must be an instance of ArrayBuffer or ArrayBufferView. Received type number (NaN)
    randomFillSync(true): TypeError [ERR_INVALID_ARG_TYPE] The "buf" argument must be an instance of ArrayBuffer or ArrayBufferView. Received type boolean (true)
    randomFillSync(5n): TypeError [ERR_INVALID_ARG_TYPE] The "buf" argument must be an instance of ArrayBuffer or ArrayBufferView. Received type bigint (5n)
    randomFillSync(Symbol(s)): TypeError [ERR_INVALID_ARG_TYPE] The "buf" argument must be an instance of ArrayBuffer or ArrayBufferView. Received type symbol (Symbol(s))
    randomFillSync("x"): TypeError [ERR_INVALID_ARG_TYPE] The "buf" argument must be an instance of ArrayBuffer or ArrayBufferView. Received type string ('x')
    randomFillSync(a string of 29): TypeError [ERR_INVALID_ARG_TYPE] The "buf" argument must be an instance of ArrayBuffer or ArrayBufferView. Received type string ('aaaaaaaaaaaaaaaaaaaaaaaaa...')
    randomFillSync(a string with a quote): TypeError [ERR_INVALID_ARG_TYPE] The "buf" argument must be an instance of ArrayBuffer or ArrayBufferView. Received type string ("it's")
    randomFillSync({}): TypeError [ERR_INVALID_ARG_TYPE] The "buf" argument must be an instance of ArrayBuffer or ArrayBufferView. Received an instance of Object
    randomFillSync([]): TypeError [ERR_INVALID_ARG_TYPE] The "buf" argument must be an instance of ArrayBuffer or ArrayBufferView. Received an instance of Array
    randomFillSync(new Thing()): TypeError [ERR_INVALID_ARG_TYPE] The "buf" argument must be an instance of ArrayBuffer or ArrayBufferView. Received an instance of Thing
    randomFillSync(named): TypeError [ERR_INVALID_ARG_TYPE] The "buf" argument must be an instance of ArrayBuffer or ArrayBufferView. Received function named
    randomFillSync(Object.create(null)): TypeError [ERR_INVALID_ARG_TYPE] The "buf" argument must be an instance of ArrayBuffer or ArrayBufferView. Received [Object: null prototype] {}
    randomFillSync(a null-prototype object with a key): TypeError [ERR_INVALID_ARG_TYPE] The "buf" argument must be an instance of ArrayBuffer or ArrayBufferView. Received [Object: null prototype]
    randomFillSync({ constructor: null }): TypeError [ERR_INVALID_ARG_TYPE] The "buf" argument must be an instance of ArrayBuffer or ArrayBufferView. Received [Object]
    randomFillSync({ constructor: {} }): TypeError [ERR_INVALID_ARG_TYPE] The "buf" argument must be an instance of ArrayBuffer or ArrayBufferView. Received [Object]
    randomFillSync(Object.create({ constructor: null })): TypeError [ERR_INVALID_ARG_TYPE] The "buf" argument must be an instance of ArrayBuffer or ArrayBufferView. Received {}
    randomFillSync(u8, "test"), and randomFill: TypeError [ERR_INVALID_ARG_TYPE] The "offset" argument must be of type number. Received type string ('test')
    randomFillSync(u8, null), and randomFill: TypeError [ERR_INVALID_ARG_TYPE] The "offset" argument must be of type number. Received null
    randomFillSync(u8, NaN), and randomFill: RangeError [ERR_OUT_OF_RANGE] The value of "offset" is out of range. It must be >= 0 && <= 10. Received NaN
    randomFillSync(u8, -10), and randomFill: RangeError [ERR_OUT_OF_RANGE] The value of "offset" is out of range. It must be >= 0 && <= 10. Received -10
    randomFillSync(u8, 11), and randomFill: RangeError [ERR_OUT_OF_RANGE] The value of "offset" is out of range. It must be >= 0 && <= 10. Received 11
    randomFillSync(u8, 2 ** 31), and randomFill: RangeError [ERR_OUT_OF_RANGE] The value of "offset" is out of range. It must be >= 0 && <= 10. Received 2147483648
    randomFillSync(u8, 2 ** 32), and randomFill: RangeError [ERR_OUT_OF_RANGE] The value of "offset" is out of range. It must be >= 0 && <= 10. Received 4294967296
    randomFillSync(u8, -(10 ** 11)), and randomFill: RangeError [ERR_OUT_OF_RANGE] The value of "offset" is out of range. It must be >= 0 && <= 10. Received -100_000_000_000
    randomFillSync(u8, 2 ** 33 + 0.5), and randomFill: RangeError [ERR_OUT_OF_RANGE] The value of "offset" is out of range. It must be >= 0 && <= 10. Received 8589934592.5
    randomFillSync(u8, 0, "test"), and randomFill: TypeError [ERR_INVALID_ARG_TYPE] The "size" argument must be of type number. Received type string ('test')
    randomFillSync(u8, 0, null), and randomFill: TypeError [ERR_INVALID_ARG_TYPE] The "size" argument must be of type number. Received null
    randomFillSync(u8, 1, NaN), and randomFill: RangeError [ERR_OUT_OF_RANGE] The value of "size" is out of range. It must be >= 0 && <= 2147483647. Received NaN
    randomFillSync(u8, 1, -10), and randomFill: RangeError [ERR_OUT_OF_RANGE] The value of "size" is out of range. It must be >= 0 && <= 2147483647. Received -10
    randomFillSync(u8, 1, 2 ** 31), and randomFill: RangeError [ERR_OUT_OF_RANGE] The value of "size" is out of range. It must be >= 0 && <= 2147483647. Received 2147483648
    randomFillSync(u8, 1, 2 ** 32), and randomFill: RangeError [ERR_OUT_OF_RANGE] The value of "size" is out of range. It must be >= 0 && <= 2147483647. Received 4294967296
    randomFillSync(u8, 1, 1e21), and randomFill: RangeError [ERR_OUT_OF_RANGE] The value of "size" is out of range. It must be >= 0 && <= 2147483647. Received 1e_+21
    randomFillSync(u8, 1, 10), and randomFill: RangeError [ERR_OUT_OF_RANGE] The value of "size + offset" is out of range. It must be <= 10. Received 11
    randomBytes(undefined), and with a callback: TypeError [ERR_INVALID_ARG_TYPE] The "size" argument must be of type number. Received undefined
    randomBytes(null), and with a callback: TypeError [ERR_INVALID_ARG_TYPE] The "size" argument must be of type number. Received null
    randomBytes(false), and with a callback: TypeError [ERR_INVALID_ARG_TYPE] The "size" argument must be of type number. Received type boolean (false)
    randomBytes({}), and with a callback: TypeError [ERR_INVALID_ARG_TYPE] The "size" argument must be of type number. Received an instance of Object
    randomBytes(-1), and with a callback: RangeError [ERR_OUT_OF_RANGE] The value of "size" is out of range. It must be >= 0 && <= 2147483647. Received -1
    randomBytes(NaN), and with a callback: RangeError [ERR_OUT_OF_RANGE] The value of "size" is out of range. It must be >= 0 && <= 2147483647. Received NaN
    randomBytes(2 ** 32), and with a callback: RangeError [ERR_OUT_OF_RANGE] The value of "size" is out of range. It must be >= 0 && <= 2147483647. Received 4294967296
    randomBytes(2 ** 31), and with a callback: RangeError [ERR_OUT_OF_RANGE] The value of "size" is out of range. It must be >= 0 && <= 2147483647. Received 2147483648
    randomFillSync(u8): bytes 0 to 64 of 64
    randomFill(u8, callback): bytes 0 to 64 of 64
    randomFillSync(u8, 16): bytes 16 to 64 of 64
    randomFill(u8, 16, callback): bytes 16 to 64 of 64
    randomFillSync(u8, 16, 16): bytes 16 to 32 of 64
    randomFill(u8, 16, 16, callback): bytes 16 to 32 of 64
    randomFillSync(u8, 16.5): bytes 16 to 64 of 64
    randomFill(u8, 16.5, callback): bytes 16 to 63 of 64
    randomFillSync(u8, 16.5, 16.9): bytes 16 to 32 of 64
    randomFill(u8, 16.5, 16.9, callback): bytes 16 to 32 of 64
    randomFillSync(u8, 64): no bytes
    randomFill(u8, 64, callback): no bytes
    randomFillSync(u8, 0, 0): no bytes
    randomFill(u8, 0, 0, callback): no bytes
    randomFillSync(u8.subarray(16, 48)): bytes 16 to 48 of 64
    randomFill(u8.subarray(16, 48), callback): bytes 16 to 48 of 64
    randomFillSync(u8.subarray(16, 48), 8, 8): bytes 24 to 32 of 64
    randomFill(u8.subarray(16, 48), 8, 8, callback): bytes 24 to 32 of 64
    randomFillSync(new Uint16Array(buffer, 16, 16), 4): bytes 24 to 48 of 64
    randomFill(new Uint16Array(buffer, 16, 16), 4, callback): bytes 24 to 48 of 64
    randomFillSync(new Float64Array(buffer), 2, 2): bytes 16 to 32 of 64
    randomFill(new Float64Array(buffer), 2, 2, callback): bytes 16 to 32 of 64
    randomFillSync(new DataView(buffer, 16, 32)): bytes 16 to 48 of 64
    randomFill(new DataView(buffer, 16, 32), callback): bytes 16 to 48 of 64
    randomFillSync(new DataView(buffer, 16, 32), 8): bytes 24 to 48 of 64
    randomFill(new DataView(buffer, 16, 32), 8, callback): RangeError [ERR_OUT_OF_RANGE] The value of "size" is out of range. It must be >= 0 && <= 2147483647. Received NaN
    randomFillSync(buffer): bytes 0 to 64 of 64
    randomFill(buffer, callback): bytes 0 to 64 of 64
    randomFillSync(buffer, 16): bytes 16 to 64 of 64
    randomFill(buffer, 16, callback): RangeError [ERR_OUT_OF_RANGE] The value of "size" is out of range. It must be >= 0 && <= 2147483647. Received NaN
    randomFillSync(buffer, 16, 16): bytes 16 to 32 of 64
    randomFill(buffer, 16, 16, callback): bytes 16 to 32 of 64
    randomFillSync(new Uint8Array(70000)): bytes 0 to 70000 of 70000
    randomFill(new Uint8Array(70000), callback): bytes 0 to 70000 of 70000
    randomFillSync(a shared buffer of 70000): bytes 0 to 70000 of 70000
    randomFill(a shared buffer of 70000, callback): bytes 0 to 70000 of 70000
    randomFillSync(a view of a shared buffer, 16, 16): bytes 16 to 32 of 64
    randomFill(a view of a shared buffer, 16, 16, callback): bytes 16 to 32 of 64
    randomFillSync(new OtherArrayBuffer(64), 16, 16): bytes 16 to 32 of 64
    randomFill(new OtherArrayBuffer(64), 16, 16, callback): bytes 16 to 32 of 64
    randomFillSync(new OtherUint8Array(64), 16): bytes 16 to 64 of 64
    randomFill(new OtherUint8Array(64), 16, callback): bytes 16 to 64 of 64
    randomBytes("8", 1): TypeError [ERR_INVALID_ARG_TYPE] The "size" argument must be of type number. Received type string ('8')
    randomBytes(8, 1): TypeError [ERR_INVALID_ARG_TYPE] The "callback" argument must be of type function. Received type number (1)
    randomBytes(8, null): TypeError [ERR_INVALID_ARG_TYPE] The "callback" argument must be of type function. Received null
    randomBytes(8, callback) returns: undefined
    randomBytes(size) for 0, 1, 2, 4, 16, 256, 1024, 101.2: Buffer of 0, Buffer of 1, Buffer of 2, Buffer of 4, Buffer of 16, Buffer of 256, Buffer of 1024, Buffer of 101
    randomBytes(size, callback) for 0, 1, 2, 4, 16, 256, 1024, 101.2: Buffer of 0, Buffer of 1, Buffer of 2, Buffer of 4, Buffer of 16, Buffer of 256, Buffer of 1024, Buffer of 101
    randomBytes(64): bytes 0 to 64 of 64
    randomBytes(70000): bytes 0 to 70000 of 70000
    randomBytes(64, callback): bytes 0 to 64 of 64
    prng, pseudoRandomBytes and rng are randomBytes: true
    randomFillSync(u8) returns u8: true
    randomFill(u8, callback) calls back with u8: true
    randomFillSync(new Uint16Array(5), 6): RangeError [ERR_OUT_OF_RANGE] The value of "offset" is out of range. It must be >= 0 && <= 10. Received 12
    randomFillSync(new Uint16Array(5), 3, 3): RangeError [ERR_OUT_OF_RANGE] The value of "size + offset" is out of range. It must be <= 10. Received 12
    randomFill("x", 0, 1, "callback"): TypeError [ERR_INVALID_ARG_TYPE] The "buf" argument must be an instance of ArrayBuffer or ArrayBufferView. Received type string ('x')
    randomFill(u8, -1, 1, "callback"): TypeError [ERR_INVALID_ARG_TYPE] The "callback" argument must be of type function. Received type string ('callback')
    randomFill(u8, -1, callback): RangeError [ERR_OUT_OF_RANGE] The value of "offset" is out of range. It must be >= 0 && <= 10. Received -1
    randomFill(u8): TypeError [ERR_INVALID_ARG_TYPE] The "callback" argument must be of type function. Received undefined
    randomFill(u8, 1): TypeError [ERR_INVALID_ARG_TYPE] The "callback" argument must be of type function. Received undefined
    randomFill(u8, undefined, callback): TypeError [ERR_INVALID_ARG_TYPE] The "offset" argument must be of type number. Received undefined
    randomFill(u8, undefined, undefined, callback): TypeError [ERR_INVALID_ARG_TYPE] The "offset" argument must be of type number. Received undefined
    randomBytes(8, callback) calls back: a microtask, a promise job, the callback
    randomBytes(0, callback) calls back: inside the call
    randomFill(u8, callback) calls back: a microtask, a promise job, the callback
    randomFill(u8, 2, 3, callback) calls back: a microtask, a promise job, the callback
    randomFill(empty, callback) calls back: inside the call
    randomFill(u8, 10, callback) calls back: inside the call
    randomFill(u8, 0, 0, callback) calls back: inside the call
    randomFill(u8, 0, 0.5, callback) calls back: inside the call
    createHmac(5, 5): TypeError [ERR_INVALID_ARG_TYPE] The "hmac" argument must be of type string. Received type number (5)
    createHmac(): TypeError [ERR_INVALID_ARG_TYPE] The "hmac" argument must be of type string. Received undefined
    createHmac("sha256", 5, { encoding: 5 }): TypeError [ERR_INVALID_ARG_TYPE] The "options.encoding" property must be of type string. Received type number (5)
    createHmac("sha256", 5): TypeError [ERR_INVALID_ARG_TYPE] The "key" argument must be of type string or an instance of ArrayBuffer, Buffer, TypedArray, DataView, KeyObject, or CryptoKey. Received type number (5)
    createHmac("sha256"): TypeError [ERR_INVALID_ARG_TYPE] The "key" argument must be of type string or an instance of ArrayBuffer, Buffer, TypedArray, DataView, KeyObject, or CryptoKey. Received undefined
    createHmac("sha256", {}): TypeError [ERR_INVALID_ARG_TYPE] The "key" argument must be of type string or an instance of ArrayBuffer, Buffer, TypedArray, DataView, KeyObject, or CryptoKey. Received an instance of Object
    hmac with the key "key": 9c196e32dc0175f86f4b1cb89289d6619de6bee699e4c378e68309ed97a1a6ab
    hmac with the key "6b6579" and the encoding "hex": 9c196e32dc0175f86f4b1cb89289d6619de6bee699e4c378e68309ed97a1a6ab
    hmac with the key "a2V5" and the encoding "base64": 9c196e32dc0175f86f4b1cb89289d6619de6bee699e4c378e68309ed97a1a6ab
    hmac with the key "key" and the encoding "buffer": 9c196e32dc0175f86f4b1cb89289d6619de6bee699e4c378e68309ed97a1a6ab
    hmac with the key "key" and the encoding null: 9c196e32dc0175f86f4b1cb89289d6619de6bee699e4c378e68309ed97a1a6ab
    hmac with a Uint8Array key: 9c196e32dc0175f86f4b1cb89289d6619de6bee699e4c378e68309ed97a1a6ab
    hmac with an ArrayBuffer key: 9c196e32dc0175f86f4b1cb89289d6619de6bee699e4c378e68309ed97a1a6ab
    hmac with an ArrayBuffer key of another realm: 9c196e32dc0175f86f4b1cb89289d6619de6bee699e4c378e68309ed97a1a6ab
    hmac with a DataView key at an offset: 9c196e32dc0175f86f4b1cb89289d6619de6bee699e4c378e68309ed97a1a6ab
    hmac with a key of 100 bytes: 30f0f7f4a3d31b9750666b038c048550020795dd2743759bf83bcf5e0f125b36
    hmac with a string key of 100 bytes: 30f0f7f4a3d31b9750666b038c048550020795dd2743759bf83bcf5e0f125b36
    hmac with a shared key of 100 bytes: abc726aa04620d1059bc8473a31ba2eb2585a9299c33af7ab8c12adbd741486f
    hmac with a view of 3 bytes of a shared key: fd7adb152c05ef80dccf50a1fa4c05d5a3ec6da95575fc312ae7c5d091836351
    new OtherArrayBuffer(10) instanceof ArrayBuffer: false
    timingSafeEqual("x", u8): TypeError [ERR_INVALID_ARG_TYPE] The "buf1" argument must be an instance of ArrayBuffer, Buffer, TypedArray, or DataView.
    timingSafeEqual(u8, 5): TypeError [ERR_INVALID_ARG_TYPE] The "buf2" argument must be an instance of ArrayBuffer, Buffer, TypedArray, or DataView.
    timingSafeEqual(undefined, undefined): TypeError [ERR_INVALID_ARG_TYPE] The "buf1" argument must be an instance of ArrayBuffer, Buffer, TypedArray, or DataView.
    timingSafeEqual(u8, new Uint8Array(11)): RangeError [ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH] Input buffers must have the same byte length
    timingSafeEqual(new Uint16Array(5), new Uint8Array(5)): RangeError [ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH] Input buffers must have the same byte length
    timingSafeEqual(the bytes 1 0 2 0, new Uint16Array([1, 2])): true
    timingSafeEqual(the byte 1, the byte 2): false
    timingSafeEqual(an ArrayBuffer, a DataView at an offset): true
    timingSafeEqual(a shared buffer, a view of a shared buffer): true
    timingSafeEqual(new OtherArrayBuffer(10), u8): true
    channels that stay open: 0
  `;
  itBundled("browser/NodeCryptoPolyfillLikeNode", {
    files: {
      "/entry.js": /* js */ `
        import { Buffer } from "node:buffer";
        import crypto from "node:crypto";
        const { createHmac, randomBytes, randomFill, randomFillSync, timingSafeEqual } = crypto;
        const { ArrayBuffer: OtherArrayBuffer, Uint8Array: OtherUint8Array } = anotherRealm;

        const lines = [];
        const message = error => error.name + " [" + error.code + "] " + error.message;
        const check = async (label, run) => {
          try {
            lines.push(label + ": " + (await run()));
          } catch (error) {
            lines.push(label + ": " + message(error));
          }
        };
        // The error of both functions, which must be the same.
        const thrown = (run, also) => {
          try {
            run();
            return "no error";
          } catch (error) {
            return also === undefined || thrown(also) === message(error) ? message(error) : "two different errors";
          }
        };
        const never = () => lines.push("a callback ran after an error");
        const calledBack = start =>
          new Promise((resolve, reject) => start((error, value) => (error ? reject(error) : resolve(value))));
        const u8 = () => new Uint8Array(10);
        const zeros = () => new Uint8Array(64);
        const manyZeros = () => new Uint8Array(70000);
        // A page that is not cross-origin isolated has no SharedArrayBuffer global. WebAssembly gives the constructor.
        const SharedBuffer = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }).buffer.constructor;
        const shared = length => new Uint8Array(new SharedBuffer(length));

        // The bytes that fill() changes in zeros. Four rounds, so that no byte at an end stays zero by chance.
        const filled = async (fill, make = zeros) => {
          let start = Infinity;
          let end = 0;
          let length;
          for (let round = 0; round < 4; round++) {
            const bytes = make();
            const other = await fill(bytes);
            if (other) bytes.set(new Uint8Array(other.buffer ?? other));
            const changed = byte => byte !== 0;
            if (!bytes.some(changed)) continue;
            start = Math.min(start, bytes.findIndex(changed));
            end = Math.max(end, bytes.findLastIndex(changed) + 1);
            length = bytes.length;
          }
          return end === 0 ? "no bytes" : "bytes " + start + " to " + end + " of " + length;
        };

        // Inside the call, or after a microtask and a promise job that the caller queues next.
        const timing = start =>
          new Promise(resolve => {
            const order = [];
            let inside = true;
            start(() => resolve(inside ? "inside the call" : order.concat("the callback").join(", ")));
            inside = false;
            queueMicrotask(() => order.push("a microtask"));
            Promise.resolve().then(() => order.push("a promise job"));
          });

        function named() {}
        class Thing {}
        for (const [label, value] of [
          ["undefined", undefined],
          ["null", null],
          ["1", 1],
          ["-0", -0],
          ["NaN", NaN],
          ["true", true],
          ["5n", 5n],
          ["Symbol(s)", Symbol("s")],
          ['"x"', "x"],
          ["a string of 29", "a".repeat(29)],
          ["a string with a quote", "it's"],
          ["{}", {}],
          ["[]", []],
          ["new Thing()", new Thing()],
          ["named", named],
          ["Object.create(null)", Object.create(null)],
          ["a null-prototype object with a key", Object.assign(Object.create(null), { a: 1 })],
          ["{ constructor: null }", { constructor: null }],
          ["{ constructor: {} }", { constructor: {} }],
          ["Object.create({ constructor: null })", Object.create({ constructor: null })],
        ]) {
          await check("randomFillSync(" + label + ")", () => randomFillSync(value));
        }

        for (const [label, ...range] of [
          ['"test"', "test"],
          ["null", null],
          ["NaN", NaN],
          ["-10", -10],
          ["11", 11],
          ["2 ** 31", 2 ** 31],
          ["2 ** 32", 2 ** 32],
          ["-(10 ** 11)", -(10 ** 11)],
          ["2 ** 33 + 0.5", 2 ** 33 + 0.5],
          ['0, "test"', 0, "test"],
          ["0, null", 0, null],
          ["1, NaN", 1, NaN],
          ["1, -10", 1, -10],
          ["1, 2 ** 31", 1, 2 ** 31],
          ["1, 2 ** 32", 1, 2 ** 32],
          ["1, 1e21", 1, 1e21],
          ["1, 10", 1, 10],
        ]) {
          const sync = () => randomFillSync(u8(), ...range);
          const withCallback = () => randomFill(u8(), ...range, never);
          await check("randomFillSync(u8, " + label + "), and randomFill", () => thrown(sync, withCallback));
        }

        for (const [label, size] of [
          ["undefined", undefined],
          ["null", null],
          ["false", false],
          ["{}", {}],
          ["-1", -1],
          ["NaN", NaN],
          ["2 ** 32", 2 ** 32],
          ["2 ** 31", 2 ** 31],
        ]) {
          const sync = () => randomBytes(size);
          const withCallback = () => randomBytes(size, never);
          await check("randomBytes(" + label + "), and with a callback", () => thrown(sync, withCallback));
        }

        // What randomFillSync(...args) and randomFill(...args, callback) fill. args(bytes) gives the arguments.
        for (const [label, args, make] of [
          ["u8", bytes => [bytes]],
          ["u8, 16", bytes => [bytes, 16]],
          ["u8, 16, 16", bytes => [bytes, 16, 16]],
          ["u8, 16.5", bytes => [bytes, 16.5]],
          ["u8, 16.5, 16.9", bytes => [bytes, 16.5, 16.9]],
          ["u8, 64", bytes => [bytes, 64]],
          ["u8, 0, 0", bytes => [bytes, 0, 0]],
          ["u8.subarray(16, 48)", bytes => [bytes.subarray(16, 48)]],
          ["u8.subarray(16, 48), 8, 8", bytes => [bytes.subarray(16, 48), 8, 8]],
          ["new Uint16Array(buffer, 16, 16), 4", bytes => [new Uint16Array(bytes.buffer, 16, 16), 4]],
          ["new Float64Array(buffer), 2, 2", bytes => [new Float64Array(bytes.buffer), 2, 2]],
          ["new DataView(buffer, 16, 32)", bytes => [new DataView(bytes.buffer, 16, 32)]],
          ["new DataView(buffer, 16, 32), 8", bytes => [new DataView(bytes.buffer, 16, 32), 8]],
          ["buffer", bytes => [bytes.buffer]],
          ["buffer, 16", bytes => [bytes.buffer, 16]],
          ["buffer, 16, 16", bytes => [bytes.buffer, 16, 16]],
          ["new Uint8Array(70000)", bytes => [bytes], manyZeros],
          ["a shared buffer of 70000", bytes => [bytes.buffer], () => shared(70000)],
          ["a view of a shared buffer, 16, 16", bytes => [bytes, 16, 16], () => shared(64)],
          ["new OtherArrayBuffer(64), 16, 16", () => [new OtherArrayBuffer(64), 16, 16]],
          ["new OtherUint8Array(64), 16", () => [new OtherUint8Array(64), 16]],
        ]) {
          const sync = bytes => randomFillSync(...args(bytes));
          const withCallback = bytes => calledBack(callback => randomFill(...args(bytes), callback));
          await check("randomFillSync(" + label + ")", () => filled(sync, make));
          await check("randomFill(" + label + ", callback)", () => filled(withCallback, make));
        }

        const hmac = (key, options) => createHmac("sha256", key, options).update("abc").digest("hex");
        const keyBytes = new TextEncoder().encode("key");
        const padded = new Uint8Array(32);
        padded.set(keyBytes, 8);
        const otherKey = new OtherArrayBuffer(3);
        new Uint8Array(otherKey).set(keyBytes);
        const sizes = [0, 1, 2, 4, 16, 256, 1024, 101.2];
        const kind = bytes => (Buffer.isBuffer(bytes) ? "Buffer of " : "no Buffer of ") + bytes.length;
        const sameObject = async (bytes, result) => (await result(bytes)) === bytes;
        const randomBytesLater = size => calledBack(callback => randomBytes(size, callback));
        const randomFillLater = bytes => calledBack(callback => randomFill(bytes, callback));
        const aliases = [crypto.prng, crypto.pseudoRandomBytes, crypto.rng];

        for (const [label, run] of [
          ['randomBytes("8", 1)', () => randomBytes("8", 1)],
          ["randomBytes(8, 1)", () => randomBytes(8, 1)],
          ["randomBytes(8, null)", () => randomBytes(8, null)],
          ["randomBytes(8, callback) returns", () => String(randomBytes(8, () => {}))],
          ["randomBytes(size) for " + sizes.join(", "), () => sizes.map(size => kind(randomBytes(size))).join(", ")],
          [
            "randomBytes(size, callback) for " + sizes.join(", "),
            async () => (await Promise.all(sizes.map(randomBytesLater))).map(kind).join(", "),
          ],
          ["randomBytes(64)", () => filled(() => randomBytes(64))],
          ["randomBytes(70000)", () => filled(() => randomBytes(70000), manyZeros)],
          ["randomBytes(64, callback)", () => filled(() => randomBytesLater(64))],
          ["prng, pseudoRandomBytes and rng are randomBytes", () => aliases.every(alias => alias === randomBytes)],
          ["randomFillSync(u8) returns u8", () => sameObject(u8(), randomFillSync)],
          ["randomFill(u8, callback) calls back with u8", () => sameObject(u8(), randomFillLater)],
          ["randomFillSync(new Uint16Array(5), 6)", () => randomFillSync(new Uint16Array(5), 6)],
          ["randomFillSync(new Uint16Array(5), 3, 3)", () => randomFillSync(new Uint16Array(5), 3, 3)],

          ['randomFill("x", 0, 1, "callback")', () => randomFill("x", 0, 1, "callback")],
          ['randomFill(u8, -1, 1, "callback")', () => randomFill(u8(), -1, 1, "callback")],
          ["randomFill(u8, -1, callback)", () => randomFill(u8(), -1, never)],
          ["randomFill(u8)", () => randomFill(u8())],
          ["randomFill(u8, 1)", () => randomFill(u8(), 1)],
          ["randomFill(u8, undefined, callback)", () => randomFill(u8(), undefined, never)],
          ["randomFill(u8, undefined, undefined, callback)", () => randomFill(u8(), undefined, undefined, never)],

          ["randomBytes(8, callback) calls back", () => timing(callback => randomBytes(8, callback))],
          ["randomBytes(0, callback) calls back", () => timing(callback => randomBytes(0, callback))],
          ["randomFill(u8, callback) calls back", () => timing(callback => randomFill(u8(), callback))],
          ["randomFill(u8, 2, 3, callback) calls back", () => timing(callback => randomFill(u8(), 2, 3, callback))],
          ["randomFill(empty, callback) calls back", () => timing(callback => randomFill(new Uint8Array(0), callback))],
          ["randomFill(u8, 10, callback) calls back", () => timing(callback => randomFill(u8(), 10, callback))],
          ["randomFill(u8, 0, 0, callback) calls back", () => timing(callback => randomFill(u8(), 0, 0, callback))],
          ["randomFill(u8, 0, 0.5, callback) calls back", () => timing(callback => randomFill(u8(), 0, 0.5, callback))],

          ["createHmac(5, 5)", () => createHmac(5, 5)],
          ["createHmac()", () => createHmac()],
          ['createHmac("sha256", 5, { encoding: 5 })', () => createHmac("sha256", 5, { encoding: 5 })],
          ['createHmac("sha256", 5)', () => createHmac("sha256", 5)],
          ['createHmac("sha256")', () => createHmac("sha256")],
          ['createHmac("sha256", {})', () => createHmac("sha256", {})],
          ['hmac with the key "key"', () => hmac("key")],
          ['hmac with the key "6b6579" and the encoding "hex"', () => hmac("6b6579", { encoding: "hex" })],
          ['hmac with the key "a2V5" and the encoding "base64"', () => hmac("a2V5", { encoding: "base64" })],
          ['hmac with the key "key" and the encoding "buffer"', () => hmac("key", { encoding: "buffer" })],
          ['hmac with the key "key" and the encoding null', () => hmac("key", { encoding: null })],
          ["hmac with a Uint8Array key", () => hmac(keyBytes)],
          ["hmac with an ArrayBuffer key", () => hmac(keyBytes.buffer)],
          ["hmac with an ArrayBuffer key of another realm", () => hmac(otherKey)],
          ["hmac with a DataView key at an offset", () => hmac(new DataView(padded.buffer, 8, 3))],
          ["hmac with a key of 100 bytes", () => hmac(new Uint8Array(100).fill(7))],
          ["hmac with a string key of 100 bytes", () => hmac(String.fromCharCode(7).repeat(100))],
          ["hmac with a shared key of 100 bytes", () => hmac(new SharedBuffer(100))],
          ["hmac with a view of 3 bytes of a shared key", () => hmac(shared(64).subarray(0, 3))],
          ["new OtherArrayBuffer(10) instanceof ArrayBuffer", () => new OtherArrayBuffer(10) instanceof ArrayBuffer],
        ]) {
          await check(label, run);
        }

        for (const [label, a, b] of [
          ['"x", u8', "x", u8()],
          ["u8, 5", u8(), 5],
          ["undefined, undefined"],
          ["u8, new Uint8Array(11)", u8(), new Uint8Array(11)],
          ["new Uint16Array(5), new Uint8Array(5)", new Uint16Array(5), new Uint8Array(5)],
          ["the bytes 1 0 2 0, new Uint16Array([1, 2])", new Uint8Array([1, 0, 2, 0]), new Uint16Array([1, 2])],
          ["the byte 1, the byte 2", new Uint8Array([1]), new Uint8Array([2])],
          ["an ArrayBuffer, a DataView at an offset", keyBytes.buffer, new DataView(padded.buffer, 8, 3)],
          ["a shared buffer, a view of a shared buffer", new SharedBuffer(8), shared(8)],
          ["new OtherArrayBuffer(10), u8", new OtherArrayBuffer(10), u8()],
        ]) {
          await check("timingSafeEqual(" + label + ")", () => timingSafeEqual(a, b));
        }
        await check("channels that stay open", () => openChannels());

        console.log(lines.join("\\n"));
      `,
    },
    runtimeFiles: likeAPage,
    target: "browser",
    run: { file: "/like-a-page.js", stdout: cryptoLikeNode },
  });
  itBundled("browser/NodeStreamTicksOnTheHostProcess", {
    files: {
      "/entry.js": /* js */ `
        import { PassThrough } from "node:stream";
        const order = [];
        const stream = new PassThrough();
        stream.on("data", chunk => order.push("data:" + chunk));
        stream.on("end", () => order.push("end"));
        setImmediate(() => console.log([...order, "immediate"].join(" ")));
        stream.write("a");
        stream.end("b");
      `,
    },
    target: "browser",
    run: { stdout: "data:a data:b end immediate" },
  });
  itBundled("browser/NodeHttpPolyfill", {
    files: {
      "/entry.js": /* js */ `
        import http, { STATUS_CODES } from "node:http";
        import https from "node:https";
        import { PassThrough, pipeline } from "node:stream";
        const finish = line => {
          console.log([STATUS_CODES[404], http.STATUS_CODES[200], typeof https.STATUS_CODES, line].join("\\n"));
          stopServer();
        };
        http
          .get(location.href, response => {
            const chunks = [];
            const body = new PassThrough().on("data", chunk => chunks.push(chunk));
            pipeline(response, body, error => finish(error ? String(error) : response.statusCode + " " + chunks.join("")));
          })
          .on("error", error => finish(String(error)));
      `,
    },
    runtimeFiles: {
      "/serve.js": /* js */ `
        const server = Bun.serve({ port: 0, fetch: () => new Response("hello") });
        globalThis.location = server.url;
        globalThis.stopServer = () => server.stop(true);
        await import("./out.js");
      `,
    },
    target: "browser",
    run: { file: "/serve.js", stdout: "Not Found\nOK\nobject\n200 hello" },
  });
  itBundled("browser/NodePunycodePolyfill", {
    files: {
      "/entry.js": /* js */ `
        import punycode, { toASCII, toUnicode } from "node:punycode";
        console.log([toASCII("mañana.com"), punycode.toASCII("mañana.com"), toUnicode("xn--maana-pta.com")].join(" "));
      `,
    },
    target: "browser",
    run: { stdout: "xn--maana-pta.com xn--maana-pta.com mañana.com" },
  });
  // src/node-fallbacks/build-fallbacks.ts keeps the builtins external with a plugin like this one.
  itBundled("browser/PluginExternalWinsOverNodePolyfill", {
    files: {
      "/entry.js": /* js */ `
        import { Buffer } from "buffer";
        import { setTimeout } from "node:timers/promises";
        import EventEmitter from "events";
        console.log(Buffer, setTimeout, EventEmitter);
      `,
    },
    target: "browser",
    plugins(builder) {
      builder.onResolve({ filter: /^(buffer|node:timers\/promises|events)$/ }, args => ({
        path: args.path,
        external: true,
      }));
    },
    onAfterBundle(api) {
      const imports = new Bun.Transpiler().scanImports(api.readFile("/out.js"));
      expect(imports.map(({ path }) => path).sort()).toEqual(["buffer", "events", "node:timers/promises"]);
    },
  });
  itBundled("browser/NodeUrlProtocolTablesIgnorePrototype", {
    files: {
      "/entry.js": /* js */ `
        import { parse } from "node:url";
        const clean = parse("evil://h/p").slashes;
        Object.prototype["evil:"] = true;
        const polluted = parse("evil://h/p").slashes;
        delete Object.prototype["evil:"];
        console.log(clean === true && polluted === true ? "PASS" : "FAIL " + clean + " " + polluted);
      `,
    },
    target: "browser",
    run: {
      stdout: "PASS",
    },
  });
  // TODO: use nodePolyfillList to generate the code in here.
  const NodePolyfills = itBundled("browser/NodePolyfills", {
    files: {
      "/entry.js": /* js */ `
        import * as assert from "node:assert";
        import * as buffer from "node:buffer";
        import * as child_process from "node:child_process";
        import * as cluster from "node:cluster";
        import * as console2 from "node:console";
        import * as constants from "node:constants";
        import * as crypto from "node:crypto";
        import * as dgram from "node:dgram";
        import * as dns from "node:dns";
        import * as domain from "node:domain";
        import * as events from "node:events";
        import * as fs from "node:fs";
        import * as http from "node:http";
        import * as https from "node:https";
        import * as module2 from "node:module";
        import * as net from "node:net";
        import * as os from "node:os";
        import * as path from "node:path";
        import * as perf_hooks from "node:perf_hooks";
        import * as process from "node:process";
        import * as punycode from "node:punycode";
        import * as querystring from "node:querystring";
        import * as readline from "node:readline";
        import * as repl from "node:repl";
        import * as stream from "node:stream";
        import * as string_decoder from "node:string_decoder";
        import * as sys from "node:sys";
        import * as timers from "node:timers";
        import * as tls from "node:tls";
        import * as tty from "node:tty";
        import * as url from "node:url";
        import * as util from "node:util";
        import * as v8 from "node:v8";
        import * as vm from "node:vm";
        import * as zlib from "node:zlib";
        const modules = {
          assert,
          buffer,
          child_process,
          cluster,
          console2,
          constants,
          crypto,
          dgram,
          dns,
          domain,
          events,
          fs,
          http,
          https,
          module: module2,
          net,
          os,
          path,
          perf_hooks,
          process,
          punycode,
          querystring,
          readline,
          repl,
          stream,
          string_decoder,
          sys,
          timers,
          tls,
          tty,
          url,
          util,
          v8,
          vm,
          zlib,
        }
        console.log(Bun.inspect(modules))
      `,
    },
    target: "browser",
    run: {
      stdout:
        "{\n  assert: {\n    AssertionError: [Getter/Setter],\n    CallTracker: [Getter/Setter],\n    deepEqual: [Getter/Setter],\n    deepStrictEqual: [Getter/Setter],\n    default: [Getter/Setter],\n    doesNotMatch: [Getter/Setter],\n    doesNotReject: [Getter/Setter],\n    doesNotThrow: [Getter/Setter],\n    equal: [Getter/Setter],\n    fail: [Getter/Setter],\n    ifError: [Getter/Setter],\n    match: [Getter/Setter],\n    notDeepEqual: [Getter/Setter],\n    notDeepStrictEqual: [Getter/Setter],\n    notEqual: [Getter/Setter],\n    notStrictEqual: [Getter/Setter],\n    ok: [Getter/Setter],\n    rejects: [Getter/Setter],\n    strict: [Getter/Setter],\n    strictEqual: [Getter/Setter],\n    throws: [Getter/Setter],\n  },\n  buffer: {\n    Blob: [Getter/Setter],\n    Buffer: [Getter/Setter],\n    File: [Getter/Setter],\n    INSPECT_MAX_BYTES: [Getter/Setter],\n    atob: [Getter/Setter],\n    btoa: [Getter/Setter],\n    constants: [Getter/Setter],\n    default: [Getter/Setter],\n    isAscii: [Getter/Setter],\n    isUtf8: [Getter/Setter],\n    kMaxLength: [Getter/Setter],\n    kStringMaxLength: [Getter/Setter],\n    resolveObjectURL: [Getter/Setter],\n    transcode: [Getter/Setter],\n  },\n  child_process: [Function: child_process],\n  cluster: [Function: cluster],\n  console2: {\n    default: [Getter/Setter],\n  },\n  constants: {\n    DH_CHECK_P_NOT_PRIME: [Getter/Setter],\n    DH_CHECK_P_NOT_SAFE_PRIME: [Getter/Setter],\n    DH_NOT_SUITABLE_GENERATOR: [Getter/Setter],\n    DH_UNABLE_TO_CHECK_GENERATOR: [Getter/Setter],\n    E2BIG: [Getter/Setter],\n    EACCES: [Getter/Setter],\n    EADDRINUSE: [Getter/Setter],\n    EADDRNOTAVAIL: [Getter/Setter],\n    EAFNOSUPPORT: [Getter/Setter],\n    EAGAIN: [Getter/Setter],\n    EALREADY: [Getter/Setter],\n    EBADF: [Getter/Setter],\n    EBADMSG: [Getter/Setter],\n    EBUSY: [Getter/Setter],\n    ECANCELED: [Getter/Setter],\n    ECHILD: [Getter/Setter],\n    ECONNABORTED: [Getter/Setter],\n    ECONNREFUSED: [Getter/Setter],\n    ECONNRESET: [Getter/Setter],\n    EDEADLK: [Getter/Setter],\n    EDESTADDRREQ: [Getter/Setter],\n    EDOM: [Getter/Setter],\n    EDQUOT: [Getter/Setter],\n    EEXIST: [Getter/Setter],\n    EFAULT: [Getter/Setter],\n    EFBIG: [Getter/Setter],\n    EHOSTUNREACH: [Getter/Setter],\n    EIDRM: [Getter/Setter],\n    EILSEQ: [Getter/Setter],\n    EINPROGRESS: [Getter/Setter],\n    EINTR: [Getter/Setter],\n    EINVAL: [Getter/Setter],\n    EIO: [Getter/Setter],\n    EISCONN: [Getter/Setter],\n    EISDIR: [Getter/Setter],\n    ELOOP: [Getter/Setter],\n    EMFILE: [Getter/Setter],\n    EMLINK: [Getter/Setter],\n    EMSGSIZE: [Getter/Setter],\n    EMULTIHOP: [Getter/Setter],\n    ENAMETOOLONG: [Getter/Setter],\n    ENETDOWN: [Getter/Setter],\n    ENETRESET: [Getter/Setter],\n    ENETUNREACH: [Getter/Setter],\n    ENFILE: [Getter/Setter],\n    ENGINE_METHOD_ALL: [Getter/Setter],\n    ENGINE_METHOD_CIPHERS: [Getter/Setter],\n    ENGINE_METHOD_DH: [Getter/Setter],\n    ENGINE_METHOD_DIGESTS: [Getter/Setter],\n    ENGINE_METHOD_DSA: [Getter/Setter],\n    ENGINE_METHOD_ECDH: [Getter/Setter],\n    ENGINE_METHOD_ECDSA: [Getter/Setter],\n    ENGINE_METHOD_NONE: [Getter/Setter],\n    ENGINE_METHOD_PKEY_ASN1_METHS: [Getter/Setter],\n    ENGINE_METHOD_PKEY_METHS: [Getter/Setter],\n    ENGINE_METHOD_RAND: [Getter/Setter],\n    ENGINE_METHOD_STORE: [Getter/Setter],\n    ENOBUFS: [Getter/Setter],\n    ENODATA: [Getter/Setter],\n    ENODEV: [Getter/Setter],\n    ENOENT: [Getter/Setter],\n    ENOEXEC: [Getter/Setter],\n    ENOLCK: [Getter/Setter],\n    ENOLINK: [Getter/Setter],\n    ENOMEM: [Getter/Setter],\n    ENOMSG: [Getter/Setter],\n    ENOPROTOOPT: [Getter/Setter],\n    ENOSPC: [Getter/Setter],\n    ENOSR: [Getter/Setter],\n    ENOSTR: [Getter/Setter],\n    ENOSYS: [Getter/Setter],\n    ENOTCONN: [Getter/Setter],\n    ENOTDIR: [Getter/Setter],\n    ENOTEMPTY: [Getter/Setter],\n    ENOTSOCK: [Getter/Setter],\n    ENOTSUP: [Getter/Setter],\n    ENOTTY: [Getter/Setter],\n    ENXIO: [Getter/Setter],\n    EOPNOTSUPP: [Getter/Setter],\n    EOVERFLOW: [Getter/Setter],\n    EPERM: [Getter/Setter],\n    EPIPE: [Getter/Setter],\n    EPROTO: [Getter/Setter],\n    EPROTONOSUPPORT: [Getter/Setter],\n    EPROTOTYPE: [Getter/Setter],\n    ERANGE: [Getter/Setter],\n    EROFS: [Getter/Setter],\n    ESPIPE: [Getter/Setter],\n    ESRCH: [Getter/Setter],\n    ESTALE: [Getter/Setter],\n    ETIME: [Getter/Setter],\n    ETIMEDOUT: [Getter/Setter],\n    ETXTBSY: [Getter/Setter],\n    EWOULDBLOCK: [Getter/Setter],\n    EXDEV: [Getter/Setter],\n    F_OK: [Getter/Setter],\n    NPN_ENABLED: [Getter/Setter],\n    O_APPEND: [Getter/Setter],\n    O_CREAT: [Getter/Setter],\n    O_DIRECTORY: [Getter/Setter],\n    O_EXCL: [Getter/Setter],\n    O_NOCTTY: [Getter/Setter],\n    O_NOFOLLOW: [Getter/Setter],\n    O_NONBLOCK: [Getter/Setter],\n    O_RDONLY: [Getter/Setter],\n    O_RDWR: [Getter/Setter],\n    O_SYMLINK: [Getter/Setter],\n    O_SYNC: [Getter/Setter],\n    O_TRUNC: [Getter/Setter],\n    O_WRONLY: [Getter/Setter],\n    POINT_CONVERSION_COMPRESSED: [Getter/Setter],\n    POINT_CONVERSION_HYBRID: [Getter/Setter],\n    POINT_CONVERSION_UNCOMPRESSED: [Getter/Setter],\n    RSA_NO_PADDING: [Getter/Setter],\n    RSA_PKCS1_OAEP_PADDING: [Getter/Setter],\n    RSA_PKCS1_PADDING: [Getter/Setter],\n    RSA_PKCS1_PSS_PADDING: [Getter/Setter],\n    RSA_SSLV23_PADDING: [Getter/Setter],\n    RSA_X931_PADDING: [Getter/Setter],\n    R_OK: [Getter/Setter],\n    SIGABRT: [Getter/Setter],\n    SIGALRM: [Getter/Setter],\n    SIGBUS: [Getter/Setter],\n    SIGCHLD: [Getter/Setter],\n    SIGCONT: [Getter/Setter],\n    SIGFPE: [Getter/Setter],\n    SIGHUP: [Getter/Setter],\n    SIGILL: [Getter/Setter],\n    SIGINT: [Getter/Setter],\n    SIGIO: [Getter/Setter],\n    SIGIOT: [Getter/Setter],\n    SIGKILL: [Getter/Setter],\n    SIGPIPE: [Getter/Setter],\n    SIGPROF: [Getter/Setter],\n    SIGQUIT: [Getter/Setter],\n    SIGSEGV: [Getter/Setter],\n    SIGSTOP: [Getter/Setter],\n    SIGSYS: [Getter/Setter],\n    SIGTERM: [Getter/Setter],\n    SIGTRAP: [Getter/Setter],\n    SIGTSTP: [Getter/Setter],\n    SIGTTIN: [Getter/Setter],\n    SIGTTOU: [Getter/Setter],\n    SIGURG: [Getter/Setter],\n    SIGUSR1: [Getter/Setter],\n    SIGUSR2: [Getter/Setter],\n    SIGVTALRM: [Getter/Setter],\n    SIGWINCH: [Getter/Setter],\n    SIGXCPU: [Getter/Setter],\n    SIGXFSZ: [Getter/Setter],\n    SSL_OP_ALL: [Getter/Setter],\n    SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION: [Getter/Setter],\n    SSL_OP_CIPHER_SERVER_PREFERENCE: [Getter/Setter],\n    SSL_OP_CISCO_ANYCONNECT: [Getter/Setter],\n    SSL_OP_COOKIE_EXCHANGE: [Getter/Setter],\n    SSL_OP_CRYPTOPRO_TLSEXT_BUG: [Getter/Setter],\n    SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS: [Getter/Setter],\n    SSL_OP_EPHEMERAL_RSA: [Getter/Setter],\n    SSL_OP_LEGACY_SERVER_CONNECT: [Getter/Setter],\n    SSL_OP_MICROSOFT_BIG_SSLV3_BUFFER: [Getter/Setter],\n    SSL_OP_MICROSOFT_SESS_ID_BUG: [Getter/Setter],\n    SSL_OP_MSIE_SSLV2_RSA_PADDING: [Getter/Setter],\n    SSL_OP_NETSCAPE_CA_DN_BUG: [Getter/Setter],\n    SSL_OP_NETSCAPE_CHALLENGE_BUG: [Getter/Setter],\n    SSL_OP_NETSCAPE_DEMO_CIPHER_CHANGE_BUG: [Getter/Setter],\n    SSL_OP_NETSCAPE_REUSE_CIPHER_CHANGE_BUG: [Getter/Setter],\n    SSL_OP_NO_COMPRESSION: [Getter/Setter],\n    SSL_OP_NO_QUERY_MTU: [Getter/Setter],\n    SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION: [Getter/Setter],\n    SSL_OP_NO_SSLv2: [Getter/Setter],\n    SSL_OP_NO_SSLv3: [Getter/Setter],\n    SSL_OP_NO_TICKET: [Getter/Setter],\n    SSL_OP_NO_TLSv1: [Getter/Setter],\n    SSL_OP_NO_TLSv1_1: [Getter/Setter],\n    SSL_OP_NO_TLSv1_2: [Getter/Setter],\n    SSL_OP_PKCS1_CHECK_1: [Getter/Setter],\n    SSL_OP_PKCS1_CHECK_2: [Getter/Setter],\n    SSL_OP_SINGLE_DH_USE: [Getter/Setter],\n    SSL_OP_SINGLE_ECDH_USE: [Getter/Setter],\n    SSL_OP_SSLEAY_080_CLIENT_DH_BUG: [Getter/Setter],\n    SSL_OP_SSLREF2_REUSE_CERT_TYPE_BUG: [Getter/Setter],\n    SSL_OP_TLS_BLOCK_PADDING_BUG: [Getter/Setter],\n    SSL_OP_TLS_D5_BUG: [Getter/Setter],\n    SSL_OP_TLS_ROLLBACK_BUG: [Getter/Setter],\n    S_IFBLK: [Getter/Setter],\n    S_IFCHR: [Getter/Setter],\n    S_IFDIR: [Getter/Setter],\n    S_IFIFO: [Getter/Setter],\n    S_IFLNK: [Getter/Setter],\n    S_IFMT: [Getter/Setter],\n    S_IFREG: [Getter/Setter],\n    S_IFSOCK: [Getter/Setter],\n    S_IRGRP: [Getter/Setter],\n    S_IROTH: [Getter/Setter],\n    S_IRUSR: [Getter/Setter],\n    S_IRWXG: [Getter/Setter],\n    S_IRWXO: [Getter/Setter],\n    S_IRWXU: [Getter/Setter],\n    S_IWGRP: [Getter/Setter],\n    S_IWOTH: [Getter/Setter],\n    S_IWUSR: [Getter/Setter],\n    S_IXGRP: [Getter/Setter],\n    S_IXOTH: [Getter/Setter],\n    S_IXUSR: [Getter/Setter],\n    UV_UDP_REUSEADDR: [Getter/Setter],\n    W_OK: [Getter/Setter],\n    X_OK: [Getter/Setter],\n  },\n  crypto: {\n    Cipher: [Getter/Setter],\n    Cipheriv: [Getter/Setter],\n    DEFAULT_ENCODING: [Getter/Setter],\n    Decipher: [Getter/Setter],\n    Decipheriv: [Getter/Setter],\n    DiffieHellman: [Getter/Setter],\n    DiffieHellmanGroup: [Getter/Setter],\n    Hash: [Getter/Setter],\n    Hmac: [Getter/Setter],\n    Sign: [Getter/Setter],\n    Verify: [Getter/Setter],\n    constants: [Getter/Setter],\n    createCipher: [Getter/Setter],\n    createCipheriv: [Getter/Setter],\n    createCredentials: [Getter/Setter],\n    createDecipher: [Getter/Setter],\n    createDecipheriv: [Getter/Setter],\n    createDiffieHellman: [Getter/Setter],\n    createDiffieHellmanGroup: [Getter/Setter],\n    createECDH: [Getter/Setter],\n    createHash: [Getter/Setter],\n    createHmac: [Getter/Setter],\n    createSign: [Getter/Setter],\n    createVerify: [Getter/Setter],\n    default: [Getter/Setter],\n    getCiphers: [Getter/Setter],\n    getCurves: [Getter/Setter],\n    getDiffieHellman: [Getter/Setter],\n    getHashes: [Getter/Setter],\n    getRandomValues: [Getter/Setter],\n    listCiphers: [Getter/Setter],\n    pbkdf2: [Getter/Setter],\n    pbkdf2Sync: [Getter/Setter],\n    privateDecrypt: [Getter/Setter],\n    privateEncrypt: [Getter/Setter],\n    prng: [Getter/Setter],\n    pseudoRandomBytes: [Getter/Setter],\n    publicDecrypt: [Getter/Setter],\n    publicEncrypt: [Getter/Setter],\n    randomBytes: [Getter/Setter],\n    randomFill: [Getter/Setter],\n    randomFillSync: [Getter/Setter],\n    randomUUID: [Getter/Setter],\n    rng: [Getter/Setter],\n    subtle: [Getter/Setter],\n    timingSafeEqual: [Getter/Setter],\n    webcrypto: [Getter/Setter],\n  },\n  dgram: [Function: dgram],\n  dns: [Function: dns],\n  domain: {\n    create: [Getter/Setter],\n    createDomain: [Getter/Setter],\n  },\n  events: {\n    EventEmitter: [Getter/Setter],\n    addAbortListener: [Getter/Setter],\n    captureRejectionSymbol: [Getter/Setter],\n    default: [Getter/Setter],\n    getEventListeners: [Getter/Setter],\n    getMaxListeners: [Getter/Setter],\n    init: [Getter/Setter],\n    listenerCount: [Getter/Setter],\n    once: [Getter/Setter],\n    setMaxListeners: [Getter/Setter],\n  },\n  fs: [Function: fs],\n  http: {\n    Agent: [Getter/Setter],\n    ClientRequest: [Getter/Setter],\n    IncomingMessage: [Getter/Setter],\n    METHODS: [Getter/Setter],\n    STATUS_CODES: [Getter/Setter],\n    default: [Getter/Setter],\n    get: [Getter/Setter],\n    globalAgent: [Getter/Setter],\n    request: [Getter/Setter],\n  },\n  https: {\n    Agent: [Getter/Setter],\n    ClientRequest: [Getter/Setter],\n    IncomingMessage: [Getter/Setter],\n    METHODS: [Getter/Setter],\n    OutgoingMessage: [Getter/Setter],\n    STATUS_CODES: [Getter/Setter],\n    Server: [Getter/Setter],\n    ServerResponse: [Getter/Setter],\n    createServer: [Getter/Setter],\n    default: [Getter/Setter],\n    get: [Getter/Setter],\n    globalAgent: [Getter/Setter],\n    maxHeaderSize: [Getter/Setter],\n    request: [Getter/Setter],\n    setMaxIdleHTTPParsers: [Getter/Setter],\n    validateHeaderName: [Getter/Setter],\n    validateHeaderValue: [Getter/Setter],\n  },\n  module: [Function: module2],\n  net: {\n    default: [Getter/Setter],\n    isIP: [Getter/Setter],\n    isIPv4: [Getter/Setter],\n    isIPv6: [Getter/Setter],\n  },\n  os: {\n    EOL: [Getter/Setter],\n    arch: [Getter/Setter],\n    cpus: [Getter/Setter],\n    endianness: [Getter/Setter],\n    freemem: [Getter/Setter],\n    getNetworkInterfaces: [Getter/Setter],\n    homedir: [Getter/Setter],\n    hostname: [Getter/Setter],\n    loadavg: [Getter/Setter],\n    networkInterfaces: [Getter/Setter],\n    platform: [Getter/Setter],\n    release: [Getter/Setter],\n    tmpDir: [Getter/Setter],\n    tmpdir: [Getter/Setter],\n    totalmem: [Getter/Setter],\n    type: [Getter/Setter],\n    uptime: [Getter/Setter],\n  },\n  path: {\n    _makeLong: [Getter/Setter],\n    basename: [Getter/Setter],\n    default: [Getter/Setter],\n    delimiter: [Getter/Setter],\n    dirname: [Getter/Setter],\n    extname: [Getter/Setter],\n    format: [Getter/Setter],\n    isAbsolute: [Getter/Setter],\n    join: [Getter/Setter],\n    normalize: [Getter/Setter],\n    parse: [Getter/Setter],\n    posix: [Getter/Setter],\n    relative: [Getter/Setter],\n    resolve: [Getter/Setter],\n    sep: [Getter/Setter],\n  },\n  perf_hooks: [Function: perf_hooks],\n  process: {\n    addListener: [Getter/Setter],\n    argv: [Getter/Setter],\n    binding: [Getter/Setter],\n    browser: [Getter/Setter],\n    chdir: [Getter/Setter],\n    cwd: [Getter/Setter],\n    emit: [Getter/Setter],\n    env: [Getter/Setter],\n    listeners: [Getter/Setter],\n    nextTick: [Getter/Setter],\n    off: [Getter/Setter],\n    on: [Getter/Setter],\n    once: [Getter/Setter],\n    prependListener: [Getter/Setter],\n    prependOnceListener: [Getter/Setter],\n    removeAllListeners: [Getter/Setter],\n    removeListener: [Getter/Setter],\n    title: [Getter/Setter],\n    umask: [Getter/Setter],\n    version: [Getter/Setter],\n    versions: [Getter/Setter],\n  },\n  punycode: {\n    decode: [Getter/Setter],\n    default: [Getter/Setter],\n    encode: [Getter/Setter],\n    toASCII: [Getter/Setter],\n    toUnicode: [Getter/Setter],\n    ucs2: [Getter/Setter],\n    version: [Getter/Setter],\n  },\n  querystring: {\n    decode: [Getter/Setter],\n    default: [Getter/Setter],\n    encode: [Getter/Setter],\n    escape: [Getter/Setter],\n    parse: [Getter/Setter],\n    stringify: [Getter/Setter],\n    unescape: [Getter/Setter],\n    unescapeBuffer: [Getter/Setter],\n  },\n  readline: [Function: readline],\n  repl: [Function: repl],\n  stream: Function {\n    default: [Stream: Readable],\n    length: [Getter],\n    name: [Getter],\n    prototype: [Getter],\n    ReadableState: [Getter],\n    _fromList: [Getter],\n    from: [Getter],\n    fromWeb: [Getter],\n    toWeb: [Getter],\n    wrap: [Getter],\n    _uint8ArrayToBuffer: [Getter],\n    _isUint8Array: [Getter],\n    isDisturbed: [Getter],\n    isErrored: [Getter],\n    isReadable: [Getter],\n    Readable: [Getter],\n    Writable: [Getter],\n    Duplex: [Getter],\n    Transform: [Getter],\n    PassThrough: [Getter],\n    addAbortSignal: [Getter],\n    finished: [Getter],\n    destroy: [Getter],\n    pipeline: [Getter],\n    compose: [Getter],\n    Stream: [Getter],\n    isDestroyed: [Function: isDestroyed],\n    isWritable: [Function: isWritable],\n    setDefaultHighWaterMark: [Function: setDefaultHighWaterMark],\n    getDefaultHighWaterMark: [Function: getDefaultHighWaterMark],\n    promises: [Getter],\n  },\n  string_decoder: {\n    StringDecoder: [Getter/Setter],\n    default: [Getter/Setter],\n  },\n  sys: {\n    TextDecoder: [Getter/Setter],\n    TextEncoder: [Getter/Setter],\n    _extend: [Getter/Setter],\n    callbackify: [Getter/Setter],\n    callbackifyOnRejected: [Getter/Setter],\n    debuglog: [Getter/Setter],\n    default: [Getter/Setter],\n    deprecate: [Getter/Setter],\n    format: [Getter/Setter],\n    inherits: [Getter/Setter],\n    inspect: [Getter/Setter],\n    isArray: [Getter/Setter],\n    isBoolean: [Getter/Setter],\n    isBuffer: [Getter/Setter],\n    isDate: [Getter/Setter],\n    isError: [Getter/Setter],\n    isFunction: [Getter/Setter],\n    isNull: [Getter/Setter],\n    isNullOrUndefined: [Getter/Setter],\n    isNumber: [Getter/Setter],\n    isObject: [Getter/Setter],\n    isPrimitive: [Getter/Setter],\n    isRegExp: [Getter/Setter],\n    isString: [Getter/Setter],\n    isSymbol: [Getter/Setter],\n    isUndefined: [Getter/Setter],\n    log: [Getter/Setter],\n    promisify: [Getter/Setter],\n    types: [Getter/Setter],\n  },\n  timers: {\n    _unrefActive: [Getter/Setter],\n    clearImmediate: [Getter/Setter],\n    clearInterval: [Getter/Setter],\n    clearTimeout: [Getter/Setter],\n    promises: [Getter/Setter],\n    setImmediate: [Getter/Setter],\n    setInterval: [Getter/Setter],\n    setTimeout: [Getter/Setter],\n  },\n  tls: [Function: tls],\n  tty: {\n    ReadStream: [Getter/Setter],\n    WriteStream: [Getter/Setter],\n    default: [Getter/Setter],\n    isatty: [Getter/Setter],\n  },\n  url: {\n    URL: [Getter/Setter],\n    URLSearchParams: [Getter/Setter],\n    Url: [Getter/Setter],\n    default: [Getter/Setter],\n    format: [Getter/Setter],\n    parse: [Getter/Setter],\n    resolve: [Getter/Setter],\n    resolveObject: [Getter/Setter],\n  },\n  util: {\n    TextDecoder: [Getter/Setter],\n    TextEncoder: [Getter/Setter],\n    _extend: [Getter/Setter],\n    callbackify: [Getter/Setter],\n    callbackifyOnRejected: [Getter/Setter],\n    debuglog: [Getter/Setter],\n    default: [Getter/Setter],\n    deprecate: [Getter/Setter],\n    format: [Getter/Setter],\n    inherits: [Getter/Setter],\n    inspect: [Getter/Setter],\n    isArray: [Getter/Setter],\n    isBoolean: [Getter/Setter],\n    isBuffer: [Getter/Setter],\n    isDate: [Getter/Setter],\n    isError: [Getter/Setter],\n    isFunction: [Getter/Setter],\n    isNull: [Getter/Setter],\n    isNullOrUndefined: [Getter/Setter],\n    isNumber: [Getter/Setter],\n    isObject: [Getter/Setter],\n    isPrimitive: [Getter/Setter],\n    isRegExp: [Getter/Setter],\n    isString: [Getter/Setter],\n    isSymbol: [Getter/Setter],\n    isUndefined: [Getter/Setter],\n    log: [Getter/Setter],\n    promisify: [Getter/Setter],\n    types: [Getter/Setter],\n  },\n  v8: [Function: v8],\n  vm: [Function: vm],\n  zlib: {\n    default: [Getter/Setter],\n  },\n}",

      validate(ctx) {},
    },
  });
  itBundled("browser/NodePolyfillExternal", {
    todo: true,
    skipOnEsbuild: true,
    files: {
      "/entry.js": NodePolyfills.options.files["/entry.js"],
    },
    target: "browser",
    external: Object.keys(nodePolyfillList),
    onAfterBundle(api) {
      const file = api.readFile("/out.js");
      const imports = new Bun.Transpiler().scanImports(file);
      expect(imports).toStrictEqual(
        Object.keys(nodePolyfillList).map(x => ({
          kind: "import-statement",
          path: "node:" + x,
        })),
      );
    },
  });

  // #4928: a package.json "browser": {"<builtin>": false} must win over the
  // builtin polyfill for --target browser. Packages set this to keep their
  // node-only code paths from dragging crypto/stream/buffer into browser bundles.
  itBundled("browser/BrowserFieldDisablesPolyfilledBuiltin#4928", {
    files: {
      "/entry.js": /* js */ `
        import pkg from "pkg";
        console.log(JSON.stringify(pkg));
      `,
      "/node_modules/pkg/package.json": /* json */ `
        {
          "name": "pkg",
          "main": "./index.js",
          "browser": {
            "crypto": false,
            "stream": false
          }
        }
      `,
      "/node_modules/pkg/index.js": /* js */ `
        const nodeCrypto = require("crypto");
        const nodeStream = require("stream");
        module.exports = {
          hasRandomBytes: typeof nodeCrypto.randomBytes,
          hasReadable: typeof nodeStream.Readable,
        };
      `,
    },
    target: "browser",
    run: {
      stdout: '{"hasRandomBytes":"undefined","hasReadable":"undefined"}',
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      // The crypto polyfill pulls in createHash/Transform; neither should appear
      // when the browser map disables the builtin.
      assert(!out.includes("createHash"), "crypto polyfill should not be bundled when browser:{crypto:false}");
      assert(!out.includes("Transform"), "stream polyfill should not be bundled when browser:{stream:false}");
      assert(out.length < 10000, `output should be a small stub, got ${out.length} bytes`);
    },
  });
  itBundled("browser/BrowserFieldDisablesPolyfilledBuiltinNodePrefix#4928", {
    // Same as above but with the node: prefix on the import. The polyfill table
    // strips node: before lookup, so the browser-map check must too.
    files: {
      "/entry.js": /* js */ `
        import pkg from "pkg";
        console.log(pkg);
      `,
      "/node_modules/pkg/package.json": /* json */ `
        {
          "name": "pkg",
          "main": "./index.js",
          "browser": {
            "crypto": false
          }
        }
      `,
      "/node_modules/pkg/index.js": /* js */ `
        const nodeCrypto = require("node:crypto");
        module.exports = typeof nodeCrypto.randomBytes;
      `,
    },
    target: "browser",
    run: {
      stdout: "undefined",
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      assert(!out.includes("createHash"), "crypto polyfill should not be bundled when browser:{crypto:false}");
    },
  });
  itBundled("browser/BrowserFieldRemapsPolyfilledBuiltin#4928", {
    files: {
      "/entry.js": /* js */ `
        import pkg from "pkg";
        console.log(pkg.id);
      `,
      "/node_modules/pkg/package.json": /* json */ `
        {
          "name": "pkg",
          "main": "./index.js",
          "browser": {
            "crypto": "./crypto-shim.js"
          }
        }
      `,
      "/node_modules/pkg/crypto-shim.js": /* js */ `
        module.exports = { id: "shimmed-crypto" };
      `,
      "/node_modules/pkg/index.js": /* js */ `
        module.exports = require("crypto");
      `,
    },
    target: "browser",
    run: {
      stdout: "shimmed-crypto",
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      assert(out.includes("shimmed-crypto"), "browser shim should be bundled");
      assert(!out.includes("createHash"), "crypto polyfill should not be bundled when browser map remaps it");
    },
  });
  itBundled("browser/BrowserFieldDisabledBuiltinStillPolyfillsOutsideScope", {
    // A browser:{events:false} in one package must not leak into a sibling package.
    files: {
      "/entry.js": /* js */ `
        import disabled from "disabled-pkg";
        import live from "live-pkg";
        console.log(disabled, live);
      `,
      "/node_modules/disabled-pkg/package.json": /* json */ `
        { "name": "disabled-pkg", "main": "./index.js", "browser": { "events": false } }
      `,
      "/node_modules/disabled-pkg/index.js": /* js */ `
        const ev = require("events");
        module.exports = typeof ev.EventEmitter;
      `,
      "/node_modules/live-pkg/package.json": /* json */ `
        { "name": "live-pkg", "main": "./index.js" }
      `,
      "/node_modules/live-pkg/index.js": /* js */ `
        const ev = require("events");
        module.exports = typeof ev.EventEmitter;
      `,
    },
    target: "browser",
    run: {
      stdout: "undefined function",
    },
  });

  // An entry point the "browser" field maps to false has nothing to bundle.
  // This used to reach the linker with zero entry points and crash
  // ("index out of bounds" in generateChunksInParallel); with a second, live
  // entry point it silently built only that one.
  const browserFieldDisabledEntryPointFiles = {
    "/package.json": /* json */ `
      { "name": "app", "browser": { "./entry.js": false } }
    `,
    "/entry.js": /* js */ `
      console.log("entry");
    `,
    "/other.js": /* js */ `
      console.log("other");
    `,
  };
  itBundled("browser/EntryPointDisabledByBrowserField", {
    skipOnEsbuild: true,
    backend: "cli",
    files: browserFieldDisabledEntryPointFiles,
    entryPointsRaw: ["./entry.js"],
    target: "browser",
    bundleErrors: {
      "<bun>": ['"./entry.js" is disabled due to "browser" field in package.json (entry point)'],
    },
  });
  itBundled("browser/EntryPointDisabledByBrowserFieldNextToLiveEntryPoint", {
    skipOnEsbuild: true,
    backend: "cli",
    files: browserFieldDisabledEntryPointFiles,
    entryPointsRaw: ["./entry.js", "./other.js"],
    target: "browser",
    bundleErrors: {
      "<bun>": ['"./entry.js" is disabled due to "browser" field in package.json (entry point)'],
    },
  });
  itBundled("browser/EntryPointDisabledByBrowserFieldOnlyAppliesToBrowserTarget", {
    skipOnEsbuild: true,
    backend: "cli",
    files: browserFieldDisabledEntryPointFiles,
    entryPointsRaw: ["./entry.js"],
    target: "bun",
    run: {
      file: "/out/entry.js",
      stdout: "entry",
    },
  });
  itBundled("browser/EntryPointDisabledByPackageMainBrowserField", {
    // The disabled module is reached through a package's "main", so the entry
    // point specifier and the disabled file differ.
    skipOnEsbuild: true,
    backend: "cli",
    files: {
      "/node_modules/pkg/package.json": /* json */ `
        { "name": "pkg", "main": "./node.js", "browser": { "./node.js": false } }
      `,
      "/node_modules/pkg/node.js": /* js */ `
        console.log("node only");
      `,
    },
    entryPointsRaw: ["pkg"],
    target: "browser",
    bundleErrors: {
      "<bun>": ['"pkg" is disabled due to "browser" field in package.json (entry point)'],
    },
  });
  itBundled("browser/EntryPointIsNodeBuiltinStubbedForBrowser", {
    // Browser builds replace "fs" (and node:* builtins without a polyfill) with
    // an empty module, so as entry points they have nothing to bundle either.
    skipOnEsbuild: true,
    backend: "cli",
    files: {},
    entryPointsRaw: ["fs", "node:fs"],
    target: "browser",
    bundleErrors: {
      "<bun>": [
        `Cannot use "fs" as an entry point: it resolves to a builtin module`,
        `Cannot use "node:fs" as an entry point: it resolves to a builtin module`,
      ],
    },
  });

  // unsure: do we want polyfills or no-op stuff like node:* has
  // right now all error except bun:wrap which errors at resolve time, but is included if external
  const bunModules: Record<string, "no-op" | "polyfill" | "error"> = {
    "bun": "error",
    "bun:ffi": "error",
    "bun:dns": "error",
    "bun:test": "error",
    "bun:sqlite": "error",
    // "bun:wrap": "error",
    "bun:internal": "error",
    "bun:jsc": "error",
  };

  const nonErroringBunModules = Object.entries(bunModules)
    .filter(x => x[1] !== "error")
    .map(x => x[0]);

  // all of them are set to error so this test doesnt make sense to run
  itBundled.skip("browser/BunPolyfill", {
    skipOnEsbuild: true,
    files: {
      "/entry.js": `
          ${nonErroringBunModules.map((x, i) => `import * as bun_${i} from "${x}";`).join("\n")}
          function scan(obj) {
            if (typeof obj === 'function') obj = obj()
            return Object.keys(obj).length === 0 ? 'no-op' : 'polyfill'
          }
          ${nonErroringBunModules.map((x, i) => `console.log("${x.padEnd(12, " ")}:", scan(bun_${i}));`).join("\n")}
        `,
    },
    target: "browser",
    onAfterBundle(api) {
      assert(!api.readFile("/out.js").includes("\0"), "bundle should not contain null bytes");
      const file = api.readFile("/out.js");
      const imports = new Bun.Transpiler().scanImports(file);
      expect(imports).toStrictEqual([]);
    },
    run: {
      stdout: nonErroringBunModules.map(x => `${x.padEnd(12, " ")}: ${bunModules[x]}`).join("\n"),
    },
  });

  const ImportBunError = itBundled("browser/ImportBunError", {
    skipOnEsbuild: true,
    files: {
      "/entry.js": `
        ${Object.keys(bunModules)
          .map((x, i) => `import * as bun_${i} from "${x}";`)
          .join("\n")}
        ${Object.keys(bunModules)
          .map((x, i) => `console.log("${x.padEnd(12, " ")}:", !!bun_${i});`)
          .join("\n")}
      `,
    },
    target: "browser",
    bundleErrors: {
      "/entry.js": Object.keys(bunModules)
        .filter(x => bunModules[x] === "error")
        .map(x => `Browser build cannot import Bun builtin: "${x}". When bundling for Bun, set target to 'bun'`),
    },
  });

  // not implemented right now
  itBundled("browser/BunPolyfillExternal", {
    skipOnEsbuild: true,
    files: ImportBunError.options.files,
    target: "browser",
    external: Object.keys(bunModules),
    onAfterBundle(api) {
      const file = api.readFile("/out.js");
      const imports = new Bun.Transpiler().scanImports(file);
      expect(imports).toStrictEqual(
        Object.keys(bunModules).map(x => ({
          kind: "import-statement",
          path: x,
        })),
      );
    },
  });

  itBundled("browser/ImportNonExistentNodeBuiltinShouldError", {
    skipOnEsbuild: true,
    files: {
      "/entry.js": `
        import net1 from "node:net1";
      `,
    },
    bundleErrors: {
      "/entry.js": [`Could not resolve: "node:net1". Maybe you need to "bun install"?`],
    },
  });
  itBundled("browser/ImportNonExistentWithoutNodePrefix", {
    skipOnEsbuild: true,
    files: {
      "/entry.js": `
        import net1 from "net1";
      `,
    },
    bundleErrors: {
      "/entry.js": [`Could not resolve: "net1". Maybe you need to "bun install"?`],
    },
  });
  itBundled("browser/TargetNodeNonExistentBuiltinShouldBeExternal", {
    files: {
      "/entry.js": `
        import net1 from "node:net1";
      `,
    },
    target: "node",
    onAfterBundle(api) {
      const contents = api.readFile("out.js");
      expect(contents).toBe("");
    },
  });

  itBundled("browser/AwaitUsingStatement", {
    files: {
      "/entry.js": `
        async function test() {
          await using resource = {
            async [Symbol.asyncDispose]() {
              console.log("The function was called");
              await 42;
              console.log("and the await finished");
            }
          };
          console.log("Before!");
        }
        test();
      `,
    },
    target: "browser",
    run: {
      stdout: "Before!\nThe function was called\nand the await finished\n",
    },
  });

  itBundled("browser/UsingStatement", {
    files: {
      "/entry.js": `
        function test() {
          using resource = {
            [Symbol.dispose]() {
              console.log("The dispose function was called");
            }
          };
          console.log("Before!");
        }
        test();
      `,
    },
    target: "browser",
    run: {
      stdout: "Before!\nThe dispose function was called\n",
    },
  });
});
