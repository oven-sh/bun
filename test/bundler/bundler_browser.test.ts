import assert from "assert";
import { describe, expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { join } from "path";
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
  // A second run makes bun like a page that is not cross-origin isolated. node:vm is its iframe: another realm.
  // A page's timers and base64 functions also reject a receiver that is not the global object.
  const withoutNodeGlobals = {
    "/without-node-globals.js": /* js */ `
      import vm from "node:vm";
      const isShared = buffer => Object.prototype.toString.call(buffer) === "[object SharedArrayBuffer]";
      globalThis.anotherRealm = vm.runInNewContext("({ ArrayBuffer })");
      for (const name of ["process", "Buffer", "global", "setImmediate", "clearImmediate", "SharedArrayBuffer"]) {
        delete globalThis[name];
      }
      for (const name of ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "atob", "btoa"]) {
        const host = globalThis[name];
        globalThis[name] = function (...args) {
          if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
          return host(...args);
        };
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
  // A page that loads the bundle with a classic <script>. There, each top-level name of the bundle is a property of
  // the global object, and the global object has web names only. The run prints the names that the bundle replaced.
  const asClassicScript = {
    "/classic-script.js": /* js */ `
      import vm from "node:vm";
      import { readFileSync } from "node:fs";
      const web = [
        "console", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask", "AbortController",
        "AbortSignal", "atob", "btoa", "crypto", "TextEncoder", "TextDecoder", "URL", "URLSearchParams", "File", "Blob",
      ];
      const page = vm.createContext(Object.fromEntries(web.map(name => [name, globalThis[name]])));
      // Every global object has these by itself.
      const names = [...web, "escape", "unescape", "hasOwnProperty"];
      const before = names.map(name => vm.runInContext(name, page));
      vm.runInContext(readFileSync(new URL("./out.js", import.meta.url), "utf8"), page, { filename: "out.js" });
      const replaced = names.filter((name, i) => vm.runInContext(name, page) !== before[i]);
      if (replaced.length) console.log("the bundle replaced the page's " + replaced.join(", "));
    `,
  };
  const cryptoKnownAnswers = JSON.stringify({
    sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    sha256OfDataView: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    md5OfUint8Array: "900150983cd24fb0d6963f7d28e17f72",
    hmac: "4fd0b215276ef12f2b3e4c8ecac2811498b656fc",
    hmacWithArrayBufferKey: "4fd0b215276ef12f2b3e4c8ecac2811498b656fc",
    hmacWithDataViewKey: "4fd0b215276ef12f2b3e4c8ecac2811498b656fc",
    hmacWithOtherKeys: Array.from({ length: 6 }, () => "4fd0b215276ef12f2b3e4c8ecac2811498b656fc"),
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
        // Only the second run has another realm. A page has no SharedArrayBuffer global unless it is isolated.
        const realm = globalThis.anotherRealm ?? globalThis;
        const SharedBuffer = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }).buffer.constructor;
        const padded = new Uint8Array(32);
        const keyOfAnotherRealm = new Uint8Array(new realm.ArrayBuffer(3));
        const sharedKey = new Uint8Array(new SharedBuffer(3));
        for (const bytes of [padded.subarray(8), keyOfAnotherRealm, sharedKey]) bytes.set(hmacKey);
        const hmacWith = (key, options) => createHmac("sha1", key, options).update("abc").digest("hex");
        console.log(JSON.stringify({
          sha256: createHash("sha256").update("abc").digest("hex"),
          sha256OfDataView: createHash("sha256").update(new DataView(abc.buffer)).digest("hex"),
          md5OfUint8Array: createHash("md5").update(abc).digest("hex"),
          hmac: createHmac("sha1", "key").update("abc").digest("hex"),
          hmacWithArrayBufferKey: createHmac("sha1", hmacKey.buffer).update("abc").digest("hex"),
          hmacWithDataViewKey: createHmac("sha1", new DataView(hmacKey.buffer)).update("abc").digest("hex"),
          hmacWithOtherKeys: [
            hmacWith("6b6579", { encoding: "hex" }),
            hmacWith("key", { encoding: "buffer" }),
            hmacWith("key", { encoding: null }),
            hmacWith(new DataView(padded.buffer, 8, 3)),
            hmacWith(keyOfAnotherRealm.buffer),
            hmacWith(sharedKey),
          ],
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
    runtimeFiles: withoutNodeGlobals,
    target: "browser",
    run: [{ stdout: cryptoKnownAnswers }, { file: "/without-node-globals.js", stdout: cryptoKnownAnswers }],
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
    timingSafeEqualOfUnequalBytes: [false, false, false, false, false],
    timingSafeEqualOfOtherBuffers: [true, true, true],
    timingSafeEqualOfNoBuffers: Array.from({ length: 3 }, () => "TypeError ERR_INVALID_ARG_TYPE"),
    randomFillSync: [false, true, false],
    randomFillSyncOfElements: [false, true, false],
    randomFillSyncOfSharedMemory: [false, true, false],
    randomFillSyncReturnsItsBuffer: true,
    randomFill: true,
    randomFillFromOffset: [false, true],
    randomBytes: 8,
    errorCodes: ["ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH", "ERR_OUT_OF_RANGE", "ERR_OUT_OF_RANGE", "ERR_INVALID_ARG_TYPE"],
    fills: {
      "u8, 16.5, 16.9": ["16 to 32", "16 to 32"],
      "u8, 63.5, 1": ["63 to 64", "63 to 64"],
      "u8, 16.5": ["16 to 64", "16 to 63"],
      "u8 with wrong properties, 16, 16": ["16 to 32", "16 to 32"],
      "buffer, 16": ["16 to 64", "16 to 64"],
      "new DataView(buffer, 16, 32), 8": ["24 to 48", "24 to 48"],
      "new Uint16Array(buffer, 16, 16)": ["16 to 48", "16 to 48"],
      "new Uint32Array(buffer), 4": ["16 to 64", "16 to 64"],
      "new Float64Array(buffer), 2": ["16 to 64", "16 to 64"],
      "buffer of another realm, 16, 16": ["16 to 32", "16 to 32"],
      "70000 shared bytes": ["0 to 70000", "0 to 70000"],
    },
    errors: {
      "randomBytes(NaN)": "RangeError ERR_OUT_OF_RANGE",
      'randomBytes("8")': "TypeError ERR_INVALID_ARG_TYPE",
      "randomBytes(2 ** 31)": "RangeError ERR_OUT_OF_RANGE",
      "randomBytes(-1, callback)": "RangeError ERR_OUT_OF_RANGE",
      "randomBytes(8, null)": "TypeError ERR_INVALID_ARG_TYPE",
      "randomFillSync(u8, NaN)": "RangeError ERR_OUT_OF_RANGE",
      "randomFillSync(u8, null)": "TypeError ERR_INVALID_ARG_TYPE",
      "randomFill(u8, undefined, callback)": "TypeError ERR_INVALID_ARG_TYPE",
      "randomFillSync(u8, -1)": "RangeError ERR_OUT_OF_RANGE",
      'randomFill(u8, -1, 1, "callback")': "TypeError ERR_INVALID_ARG_TYPE",
      'randomFill("buffer", -1, 1, callback)': "TypeError ERR_INVALID_ARG_TYPE",
      'createHmac(5, "key")': "TypeError ERR_INVALID_ARG_TYPE",
      'createHmac("sha256", "key", { encoding: 5 })': "TypeError ERR_INVALID_ARG_TYPE",
      'createHmac("sha256", 5)': "TypeError ERR_INVALID_ARG_TYPE",
      "randomFillSync(a Proxy of an ArrayBuffer)": "TypeError ERR_INVALID_ARG_TYPE",
      "createHmac with a Proxy of an ArrayBuffer": "TypeError ERR_INVALID_ARG_TYPE",
    },
    callbacks: {
      "randomBytes(8, callback)": "after the call",
      "randomBytes(0, callback)": "in the call",
      "randomFill(u8, callback)": "after the call",
      "randomFill(u8, 10, callback)": "in the call",
      "randomFill(u8, 0, 0.5, callback)": "in the call",
      lengths: [0, 8, 10],
      unexpectedCalls: [],
    },
  });
  itBundled("browser/NodeCryptoPolyfillDefaultImport", {
    files: {
      "/entry.js": /* js */ `
        import crypto from "node:crypto";
        import * as namespace from "node:crypto";
        const named = Object.keys(namespace).filter(name => name !== "default");
        const filled = (bytes, start, end) => bytes.subarray(start, end).some(byte => byte !== 0);
        // Only the second run has another realm. A page has no SharedArrayBuffer global unless it is isolated.
        const realm = globalThis.anotherRealm ?? globalThis;
        const SharedBuffer = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }).buffer.constructor;
        const view = new Uint8Array(48);
        crypto.randomFillSync(new Uint8Array(view.buffer, 16, 16));
        const elements = new Uint8Array(48);
        crypto.randomFillSync(new Uint16Array(elements.buffer, 16, 8), 2, 4);
        const shared = new Uint8Array(new SharedBuffer(48));
        crypto.randomFillSync(new Uint8Array(shared.buffer, 16, 16));
        const codeOf = fn => {
          try {
            fn();
          } catch (error) {
            return error.code;
          }
        };
        const errorOf = fn => {
          try {
            fn();
            return "no error";
          } catch (error) {
            return error.name + " " + error.code;
          }
        };
        const u8 = () => new Uint8Array(10);
        const zeros = () => new Uint8Array(64);
        // What fill() changes in zeros. Four rounds, so that no byte at an end stays zero by chance.
        const range = async (fill, make = zeros) => {
          let [start, end] = [Infinity, 0];
          for (let round = 0; round < 4; round++) {
            const bytes = make();
            await fill(bytes);
            if (!bytes.some(Boolean)) continue;
            start = Math.min(start, bytes.findIndex(Boolean));
            end = Math.max(end, bytes.findLastIndex(Boolean) + 1);
          }
          return start + " to " + end;
        };
        const unexpectedCalls = [];
        const notCalled = () => unexpectedCalls.push("after an error");
        // The value of the callback. A second call, and arguments that are not (null, value), are unexpected.
        const calledBack = start =>
          new Promise(resolve => {
            let calls = 0;
            start((...args) => {
              if (++calls > 1 || args.length !== 2 || args[0] !== null)
                unexpectedCalls.push(calls + ": " + args.length);
              resolve(args[1]);
            });
          });
        const when = start =>
          new Promise(resolve => {
            let inTheCall = true;
            start(() => resolve(inTheCall ? "in the call" : "after the call"));
            inTheCall = false;
          });
        // Views that lie about themselves. Node reads the internal slots, so the lies change nothing.
        const wrongProperties = bytes =>
          Object.defineProperties(bytes, {
            buffer: { value: new ArrayBuffer(64) },
            byteOffset: { value: 8 },
            byteLength: { value: 4 },
            BYTES_PER_ELEMENT: { value: 2 },
          });
        const notBuffers = [
          new Proxy(new ArrayBuffer(8), {}),
          { [Symbol.toStringTag]: "ArrayBuffer" },
          Object.create(ArrayBuffer.prototype),
        ];
        // The arguments of randomFillSync, and of randomFill before its callback. Then: what each of the two fills.
        const fills = {
          "u8, 16.5, 16.9": [bytes => [bytes, 16.5, 16.9]],
          "u8, 63.5, 1": [bytes => [bytes, 63.5, 1]],
          "u8, 16.5": [bytes => [bytes, 16.5]],
          "u8 with wrong properties, 16, 16": [bytes => [wrongProperties(bytes), 16, 16]],
          "buffer, 16": [bytes => [bytes.buffer, 16]],
          "new DataView(buffer, 16, 32), 8": [bytes => [new DataView(bytes.buffer, 16, 32), 8]],
          "new Uint16Array(buffer, 16, 16)": [bytes => [new Uint16Array(bytes.buffer, 16, 16)]],
          "new Uint32Array(buffer), 4": [bytes => [new Uint32Array(bytes.buffer), 4]],
          "new Float64Array(buffer), 2": [bytes => [new Float64Array(bytes.buffer), 2]],
          "buffer of another realm, 16, 16": [
            bytes => [bytes.buffer, 16, 16],
            () => new Uint8Array(new realm.ArrayBuffer(64)),
          ],
          "70000 shared bytes": [bytes => [bytes.buffer], () => new Uint8Array(new SharedBuffer(70000))],
        };
        const errors = {
          "randomBytes(NaN)": () => crypto.randomBytes(NaN),
          'randomBytes("8")': () => crypto.randomBytes("8"),
          "randomBytes(2 ** 31)": () => crypto.randomBytes(2 ** 31),
          "randomBytes(-1, callback)": () => crypto.randomBytes(-1, notCalled),
          "randomBytes(8, null)": () => crypto.randomBytes(8, null),
          "randomFillSync(u8, NaN)": () => crypto.randomFillSync(u8(), NaN),
          "randomFillSync(u8, null)": () => crypto.randomFillSync(u8(), null),
          "randomFill(u8, undefined, callback)": () => crypto.randomFill(u8(), undefined, notCalled),
          "randomFillSync(u8, -1)": () => crypto.randomFillSync(u8(), -1),
          'randomFill(u8, -1, 1, "callback")': () => crypto.randomFill(u8(), -1, 1, "callback"),
          'randomFill("buffer", -1, 1, callback)': () => crypto.randomFill("buffer", -1, 1, notCalled),
          'createHmac(5, "key")': () => crypto.createHmac(5, "key"),
          'createHmac("sha256", "key", { encoding: 5 })': () => crypto.createHmac("sha256", "key", { encoding: 5 }),
          'createHmac("sha256", 5)': () => crypto.createHmac("sha256", 5),
          "randomFillSync(a Proxy of an ArrayBuffer)": () => crypto.randomFillSync(notBuffers[0]),
          "createHmac with a Proxy of an ArrayBuffer": () => crypto.createHmac("sha256", notBuffers[0]),
        };
        for (const [label, [args, make]] of Object.entries(fills)) {
          fills[label] = [
            await range(bytes => crypto.randomFillSync(...args(bytes)), make),
            await range(bytes => calledBack(callback => crypto.randomFill(...args(bytes), callback)), make),
          ];
        }
        for (const [label, run] of Object.entries(errors)) errors[label] = errorOf(run);
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
          timingSafeEqualOfUnequalBytes: [
            crypto.timingSafeEqual(new Uint8Array([9, 2, 3, 4]), new Uint8Array([1, 2, 3, 4])),
            crypto.timingSafeEqual(new Uint8Array([1, 9, 3, 4]), new Uint8Array([1, 2, 3, 4])),
            crypto.timingSafeEqual(new Uint8Array(33).fill(7, 32), new Uint8Array(33)),
            crypto.timingSafeEqual(new Float64Array([0]), new Float64Array([-0])),
            crypto.timingSafeEqual(new Uint8Array([1, 1]), new Uint8Array([2, 2])),
          ],
          timingSafeEqualOfOtherBuffers: [
            crypto.timingSafeEqual(new realm.ArrayBuffer(4), new Uint8Array(4)),
            crypto.timingSafeEqual(new SharedBuffer(4), new Uint8Array(new SharedBuffer(4))),
            crypto.timingSafeEqual(wrongProperties(zeros().fill(1)), zeros().fill(1)),
          ],
          timingSafeEqualOfNoBuffers: notBuffers.map(value => errorOf(() => crypto.timingSafeEqual(value, value))),
          randomFillSync: [filled(view, 0, 16), filled(view, 16, 32), filled(view, 32, 48)],
          randomFillSyncOfElements: [filled(elements, 0, 20), filled(elements, 20, 28), filled(elements, 28, 48)],
          randomFillSyncOfSharedMemory: [filled(shared, 0, 16), filled(shared, 16, 32), filled(shared, 32, 48)],
          randomFillSyncReturnsItsBuffer: crypto.randomFillSync(view) === view,
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
          fills,
          errors,
          callbacks: {
            "randomBytes(8, callback)": await when(callback => crypto.randomBytes(8, callback)),
            "randomBytes(0, callback)": await when(callback => crypto.randomBytes(0, callback)),
            "randomFill(u8, callback)": await when(callback => crypto.randomFill(u8(), callback)),
            "randomFill(u8, 10, callback)": await when(callback => crypto.randomFill(u8(), 10, callback)),
            "randomFill(u8, 0, 0.5, callback)": await when(callback => crypto.randomFill(u8(), 0, 0.5, callback)),
            lengths: [
              (await calledBack(callback => crypto.randomBytes(0, callback))).length,
              (await calledBack(callback => crypto.randomBytes(8, callback))).length,
              (await calledBack(callback => crypto.randomFill(u8(), 10, callback))).length,
            ],
            unexpectedCalls,
          },
        }));
      `,
    },
    runtimeFiles: withoutNodeGlobals,
    target: "browser",
    run: [{ stdout: cryptoDefaultImport }, { file: "/without-node-globals.js", stdout: cryptoDefaultImport }],
  });
  itBundled("browser/NodeStreamTicksBeforeSetImmediate", {
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
      ...withoutNodeGlobals,
      "/serve.js": /* js */ `
        const server = Bun.serve({ port: 0, fetch: () => new Response("hello") });
        globalThis.location = server.url;
        globalThis.stopServer = () => server.stop(true);
        await import(process.argv[2] ?? "./out.js");
      `,
    },
    target: "browser",
    run: [
      { file: "/serve.js", stdout: "Not Found\nOK\nobject\n200 hello" },
      { file: "/serve.js", args: ["./without-node-globals.js"], stdout: "Not Found\nOK\nobject\n200 hello" },
    ],
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
  // A polyfill asks for its sibling `process` with an import of its own. A plugin can answer it with a CommonJS
  // module, which has no default export, or leave it to the host.
  const processFromAPlugin = {
    "/entry.js": /* js */ `
      import { Readable } from "node:stream";
      import assert from "node:assert";
      import { gzip, gunzipSync } from "node:zlib";
      const chunks = [];
      const stream = await new Promise(resolve => Readable.from(["a", "b"]).on("data", c => chunks.push(c)).on("end", resolve));
      let code;
      try { assert.strictEqual(1, 2); } catch (e) { code = e.code; }
      const zipped = await new Promise(resolve => gzip("hi", (error, data) => resolve(error ?? gunzipSync(data).toString())));
      console.log(["got:" + chunks, code, zipped].join(" "));
    `,
  };
  itBundled("browser/PluginResolvesProcessOfPolyfillToCommonJS", {
    files: processFromAPlugin,
    runtimeFiles: withoutNodeGlobals,
    target: "browser",
    plugins(builder) {
      builder.onResolve({ filter: /^process$/ }, () => ({ path: "process", namespace: "from-a-plugin" }));
      builder.onLoad({ filter: /.*/, namespace: "from-a-plugin" }, () => ({
        contents: `module.exports = { nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)), env: {} };`,
        loader: "js",
      }));
    },
    run: { file: "/without-node-globals.js", stdout: "got:a,b ERR_ASSERTION hi" },
  });
  itBundled("browser/PluginLeavesProcessOfPolyfillExternal", {
    files: {
      "/entry.js": /* js */ `
        import { Readable } from "node:stream";
        const chunks = [];
        await new Promise(resolve => Readable.from(["a", "b"]).on("data", c => chunks.push(c)).on("end", resolve));
        console.log("got:" + chunks);
      `,
    },
    runtimeFiles: withoutNodeGlobals,
    target: "browser",
    plugins(builder) {
      builder.onResolve({ filter: /^process$/ }, args => ({ path: args.path, external: true }));
    },
    run: { file: "/without-node-globals.js", stdout: "got:a,b" },
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
  // The names that bun's own builtins export, the same on every platform, and three that only node has. The test
  // below prints which of them a polyfill does not export. A name that a polyfill gains leaves that list.
  const nodeOnlyExports = { console: ["context", "createTask"], domain: ["Domain"] };
  const referenceExports = Object.fromEntries(
    readFileSync(join(import.meta.dir, "../../src/codegen/builtins/data/module-exports.txt"), "utf8")
      .split("\n")
      .map(line => line.split(" "))
      .filter(([name]) => nodePolyfillList[name.replace(/^node:|=.*$/g, "")] === "polyfill")
      .map(([name, ...names]) => [name.replace(/^node:|=.*$/g, ""), names.map(n => n.replace(/=.*$/, ""))])
      .map(([name, names]) => [
        name,
        names
          .concat(nodeOnlyExports[name] ?? [])
          .filter(n => n !== "default")
          .sort(),
      ]),
  );
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
        const reference = ${JSON.stringify(referenceExports)};
        const notExported = {};
        for (const name in reference) {
          const polyfill = modules[name === "console" ? "console2" : name];
          const missing = reference[name].filter(key => polyfill[key] === undefined);
          // An import of a missing name fails the build, but not for a CommonJS polyfill: there it is undefined.
          const commonjs = ["assert", "events", "stream"].includes(name);
          if (missing.length) notExported[commonjs ? name + " (CommonJS)" : name] = missing.join(" ");
        }
        console.log(JSON.stringify(notExported));
      `,
    },
    target: "browser",
    // A name that no browser declares is a ReferenceError there, also in a branch that no test runs.
    async onAfterBundle(api) {
      api.writeFile(
        "/no-undef.json",
        JSON.stringify({
          plugins: [],
          categories: { correctness: "off" },
          rules: { "no-undef": "error" },
          env: { browser: true, es2024: true },
          // The bundler's `__require` helper reads `require` behind a `typeof` test. The entry itself prints with Bun.
          globals: { require: "readonly", Bun: "readonly" },
        }),
      );
      await using proc = Bun.spawn({
        cmd: [bunExe(), "lint", "--config", api.join("no-undef.json"), "--no-ignore", "--format=unix", api.outfile],
        env: bunEnv,
        cwd: api.root,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const undefinedNames = [...new Set([...(stdout + stderr).matchAll(/'([^']+)' is not defined/g)].map(m => m[1]))];
      expect({ undefinedNames, exitCode }).toEqual({ undefinedNames: [], exitCode: 0 });
    },
    run: {
      validate({ stdout }) {
        const lines = stdout.trimEnd().split("\n");
        expect(JSON.parse(lines.pop()!)).toMatchInlineSnapshot(`
          {
            "assert (CommonJS)": "Assert CallTracker partialDeepStrictEqual",
            "buffer": "SlowBuffer",
            "console": "Console context createTask profile profileEnd record recordEnd screenshot takeHeapSnapshot write",
            "constants": "COPYFILE_EXCL COPYFILE_FICLONE COPYFILE_FICLONE_FORCE ENGINE_METHOD_EC ENGINE_METHOD_RSA EXTENSIONLESS_FORMAT_JAVASCRIPT EXTENSIONLESS_FORMAT_WASM OPENSSL_VERSION_NUMBER O_DSYNC PRIORITY_ABOVE_NORMAL PRIORITY_BELOW_NORMAL PRIORITY_HIGH PRIORITY_HIGHEST PRIORITY_LOW PRIORITY_NORMAL RSA_PSS_SALTLEN_AUTO RSA_PSS_SALTLEN_DIGEST RSA_PSS_SALTLEN_MAX_SIGN RTLD_GLOBAL RTLD_LAZY RTLD_LOCAL RTLD_NOW SSL_OP_ALLOW_NO_DHE_KEX SSL_OP_NO_ENCRYPT_THEN_MAC SSL_OP_NO_RENEGOTIATION SSL_OP_NO_TLSv1_3 SSL_OP_PRIORITIZE_CHACHA TLS1_1_VERSION TLS1_2_VERSION TLS1_3_VERSION TLS1_VERSION UV_DIRENT_BLOCK UV_DIRENT_CHAR UV_DIRENT_DIR UV_DIRENT_FIFO UV_DIRENT_FILE UV_DIRENT_LINK UV_DIRENT_SOCKET UV_DIRENT_UNKNOWN UV_FS_COPYFILE_EXCL UV_FS_COPYFILE_FICLONE UV_FS_COPYFILE_FICLONE_FORCE UV_FS_O_FILEMAP UV_FS_SYMLINK_DIR UV_FS_SYMLINK_JUNCTION defaultCipherList defaultCoreCipherList",
            "crypto": "Certificate ECDH KeyObject X509Certificate argon2 argon2Sync checkPrime checkPrimeSync createPrivateKey createPublicKey createSecretKey diffieHellman generateKey generateKeyPair generateKeyPairSync generateKeySync generatePrime generatePrimeSync getCipherInfo getFips hash hkdf hkdfSync randomInt randomUUIDv7 scrypt scryptSync secureHeapUsed setEngine setFips sign verify",
            "domain": "Domain _stack active",
            "events (CommonJS)": "EventEmitterAsyncResource on",
            "http": "CloseEvent MessageEvent OutgoingMessage Server ServerResponse WebSocket createServer maxHeaderSize setGlobalProxyFromEnv setMaxIdleHTTPParsers validateHeaderName validateHeaderValue",
            "https": "Server createServer",
            "net": "BlockList Server Socket SocketAddress Stream _normalizeArgs _setSimultaneousAccepts connect createConnection createServer getDefaultAutoSelectFamily getDefaultAutoSelectFamilyAttemptTimeout setDefaultAutoSelectFamily setDefaultAutoSelectFamilyAttemptTimeout",
            "os": "availableParallelism constants devNull getPriority machine setPriority userInfo version",
            "path": "matchesGlob toNamespacedPath win32",
            "process": "_eval _eventsCount _exiting _fatalException _getActiveHandles _getActiveRequests _kill _linkedBinding _preload_modules _rawDebug _tickCallback abort allowedNodeEnvironmentFlags arch argv0 assert availableMemory channel config connected constrainedMemory cpuUsage debugPort disconnect dlopen emitWarning eventNames execArgv execPath execve exit exitCode features finalization getActiveResourcesInfo getBuiltinModule getMaxListeners getegid geteuid getgid getgroups getuid hasUncaughtExceptionCaptureCallback hrtime initgroups isBun kill listenerCount loadEnvFile mainModule memoryUsage moduleLoadList openStdin pid platform ppid rawListeners reallyExit ref release report resourceUsage revision send setMaxListeners setSourceMapsEnabled setUncaughtExceptionCaptureCallback setegid seteuid setgid setgroups setuid stderr stdin stdout threadCpuUsage unref uptime",
            "stream (CommonJS)": "_isArrayBufferView duplexPair eos",
            "timers": "active enroll unenroll",
            "url": "URLPattern domainToASCII domainToUnicode fileURLToPath fileURLToPathBuffer pathToFileURL urlToHttpOptions",
            "util": "MIMEParams MIMEType _errnoException aborted convertProcessSignalToExitCode debug formatWithOptions getCallSites getSystemErrorMap getSystemErrorMessage getSystemErrorName isDeepStrictEqual parseArgs parseEnv setTraceSigInt stripVTControlCharacters styleText toUSVString",
            "zlib": "BrotliCompress BrotliDecompress ZstdCompress ZstdDecompress brotliCompress brotliCompressSync brotliDecompress brotliDecompressSync crc32 createBrotliCompress createBrotliDecompress createZstdCompress createZstdDecompress zstdCompress zstdCompressSync zstdDecompress zstdDecompressSync",
          }
        `);
        expect(lines.join("\n")).toBe(exportedNames);
      },
    },
  });
  const exportedNames =
    "{\n  assert: Function {\n    default: [Function: ok],\n    length: [Getter],\n    name: [Getter],\n    prototype: [Getter],\n    fail: [Getter],\n    AssertionError: [Getter],\n    ok: [Getter],\n    equal: [Getter],\n    notEqual: [Getter],\n    deepEqual: [Getter],\n    notDeepEqual: [Getter],\n    deepStrictEqual: [Getter],\n    notDeepStrictEqual: [Getter],\n    strictEqual: [Getter],\n    notStrictEqual: [Getter],\n    throws: [Getter],\n    rejects: [Getter],\n    doesNotThrow: [Getter],\n    doesNotReject: [Getter],\n    ifError: [Getter],\n    match: [Getter],\n    doesNotMatch: [Getter],\n    strict: [Getter],\n  },\n  buffer: {\n    Blob: [Getter/Setter],\n    Buffer: [Getter/Setter],\n    File: [Getter/Setter],\n    INSPECT_MAX_BYTES: [Getter/Setter],\n    atob: [Getter/Setter],\n    btoa: [Getter/Setter],\n    constants: [Getter/Setter],\n    default: [Getter/Setter],\n    isAscii: [Getter/Setter],\n    isUtf8: [Getter/Setter],\n    kMaxLength: [Getter/Setter],\n    kStringMaxLength: [Getter/Setter],\n    resolveObjectURL: [Getter/Setter],\n    transcode: [Getter/Setter],\n  },\n  child_process: [Function: child_process],\n  cluster: [Function: cluster],\n  console2: {\n    assert: [Getter/Setter],\n    clear: [Getter/Setter],\n    count: [Getter/Setter],\n    countReset: [Getter/Setter],\n    debug: [Getter/Setter],\n    default: [Getter/Setter],\n    dir: [Getter/Setter],\n    dirxml: [Getter/Setter],\n    error: [Getter/Setter],\n    group: [Getter/Setter],\n    groupCollapsed: [Getter/Setter],\n    groupEnd: [Getter/Setter],\n    info: [Getter/Setter],\n    log: [Getter/Setter],\n    table: [Getter/Setter],\n    time: [Getter/Setter],\n    timeEnd: [Getter/Setter],\n    timeLog: [Getter/Setter],\n    timeStamp: [Getter/Setter],\n    trace: [Getter/Setter],\n    warn: [Getter/Setter],\n  },\n  constants: {\n    DH_CHECK_P_NOT_PRIME: [Getter/Setter],\n    DH_CHECK_P_NOT_SAFE_PRIME: [Getter/Setter],\n    DH_NOT_SUITABLE_GENERATOR: [Getter/Setter],\n    DH_UNABLE_TO_CHECK_GENERATOR: [Getter/Setter],\n    E2BIG: [Getter/Setter],\n    EACCES: [Getter/Setter],\n    EADDRINUSE: [Getter/Setter],\n    EADDRNOTAVAIL: [Getter/Setter],\n    EAFNOSUPPORT: [Getter/Setter],\n    EAGAIN: [Getter/Setter],\n    EALREADY: [Getter/Setter],\n    EBADF: [Getter/Setter],\n    EBADMSG: [Getter/Setter],\n    EBUSY: [Getter/Setter],\n    ECANCELED: [Getter/Setter],\n    ECHILD: [Getter/Setter],\n    ECONNABORTED: [Getter/Setter],\n    ECONNREFUSED: [Getter/Setter],\n    ECONNRESET: [Getter/Setter],\n    EDEADLK: [Getter/Setter],\n    EDESTADDRREQ: [Getter/Setter],\n    EDOM: [Getter/Setter],\n    EDQUOT: [Getter/Setter],\n    EEXIST: [Getter/Setter],\n    EFAULT: [Getter/Setter],\n    EFBIG: [Getter/Setter],\n    EHOSTUNREACH: [Getter/Setter],\n    EIDRM: [Getter/Setter],\n    EILSEQ: [Getter/Setter],\n    EINPROGRESS: [Getter/Setter],\n    EINTR: [Getter/Setter],\n    EINVAL: [Getter/Setter],\n    EIO: [Getter/Setter],\n    EISCONN: [Getter/Setter],\n    EISDIR: [Getter/Setter],\n    ELOOP: [Getter/Setter],\n    EMFILE: [Getter/Setter],\n    EMLINK: [Getter/Setter],\n    EMSGSIZE: [Getter/Setter],\n    EMULTIHOP: [Getter/Setter],\n    ENAMETOOLONG: [Getter/Setter],\n    ENETDOWN: [Getter/Setter],\n    ENETRESET: [Getter/Setter],\n    ENETUNREACH: [Getter/Setter],\n    ENFILE: [Getter/Setter],\n    ENGINE_METHOD_ALL: [Getter/Setter],\n    ENGINE_METHOD_CIPHERS: [Getter/Setter],\n    ENGINE_METHOD_DH: [Getter/Setter],\n    ENGINE_METHOD_DIGESTS: [Getter/Setter],\n    ENGINE_METHOD_DSA: [Getter/Setter],\n    ENGINE_METHOD_ECDH: [Getter/Setter],\n    ENGINE_METHOD_ECDSA: [Getter/Setter],\n    ENGINE_METHOD_NONE: [Getter/Setter],\n    ENGINE_METHOD_PKEY_ASN1_METHS: [Getter/Setter],\n    ENGINE_METHOD_PKEY_METHS: [Getter/Setter],\n    ENGINE_METHOD_RAND: [Getter/Setter],\n    ENGINE_METHOD_STORE: [Getter/Setter],\n    ENOBUFS: [Getter/Setter],\n    ENODATA: [Getter/Setter],\n    ENODEV: [Getter/Setter],\n    ENOENT: [Getter/Setter],\n    ENOEXEC: [Getter/Setter],\n    ENOLCK: [Getter/Setter],\n    ENOLINK: [Getter/Setter],\n    ENOMEM: [Getter/Setter],\n    ENOMSG: [Getter/Setter],\n    ENOPROTOOPT: [Getter/Setter],\n    ENOSPC: [Getter/Setter],\n    ENOSR: [Getter/Setter],\n    ENOSTR: [Getter/Setter],\n    ENOSYS: [Getter/Setter],\n    ENOTCONN: [Getter/Setter],\n    ENOTDIR: [Getter/Setter],\n    ENOTEMPTY: [Getter/Setter],\n    ENOTSOCK: [Getter/Setter],\n    ENOTSUP: [Getter/Setter],\n    ENOTTY: [Getter/Setter],\n    ENXIO: [Getter/Setter],\n    EOPNOTSUPP: [Getter/Setter],\n    EOVERFLOW: [Getter/Setter],\n    EPERM: [Getter/Setter],\n    EPIPE: [Getter/Setter],\n    EPROTO: [Getter/Setter],\n    EPROTONOSUPPORT: [Getter/Setter],\n    EPROTOTYPE: [Getter/Setter],\n    ERANGE: [Getter/Setter],\n    EROFS: [Getter/Setter],\n    ESPIPE: [Getter/Setter],\n    ESRCH: [Getter/Setter],\n    ESTALE: [Getter/Setter],\n    ETIME: [Getter/Setter],\n    ETIMEDOUT: [Getter/Setter],\n    ETXTBSY: [Getter/Setter],\n    EWOULDBLOCK: [Getter/Setter],\n    EXDEV: [Getter/Setter],\n    F_OK: [Getter/Setter],\n    NPN_ENABLED: [Getter/Setter],\n    O_APPEND: [Getter/Setter],\n    O_CREAT: [Getter/Setter],\n    O_DIRECTORY: [Getter/Setter],\n    O_EXCL: [Getter/Setter],\n    O_NOCTTY: [Getter/Setter],\n    O_NOFOLLOW: [Getter/Setter],\n    O_NONBLOCK: [Getter/Setter],\n    O_RDONLY: [Getter/Setter],\n    O_RDWR: [Getter/Setter],\n    O_SYMLINK: [Getter/Setter],\n    O_SYNC: [Getter/Setter],\n    O_TRUNC: [Getter/Setter],\n    O_WRONLY: [Getter/Setter],\n    POINT_CONVERSION_COMPRESSED: [Getter/Setter],\n    POINT_CONVERSION_HYBRID: [Getter/Setter],\n    POINT_CONVERSION_UNCOMPRESSED: [Getter/Setter],\n    RSA_NO_PADDING: [Getter/Setter],\n    RSA_PKCS1_OAEP_PADDING: [Getter/Setter],\n    RSA_PKCS1_PADDING: [Getter/Setter],\n    RSA_PKCS1_PSS_PADDING: [Getter/Setter],\n    RSA_SSLV23_PADDING: [Getter/Setter],\n    RSA_X931_PADDING: [Getter/Setter],\n    R_OK: [Getter/Setter],\n    SIGABRT: [Getter/Setter],\n    SIGALRM: [Getter/Setter],\n    SIGBUS: [Getter/Setter],\n    SIGCHLD: [Getter/Setter],\n    SIGCONT: [Getter/Setter],\n    SIGFPE: [Getter/Setter],\n    SIGHUP: [Getter/Setter],\n    SIGILL: [Getter/Setter],\n    SIGINT: [Getter/Setter],\n    SIGIO: [Getter/Setter],\n    SIGIOT: [Getter/Setter],\n    SIGKILL: [Getter/Setter],\n    SIGPIPE: [Getter/Setter],\n    SIGPROF: [Getter/Setter],\n    SIGQUIT: [Getter/Setter],\n    SIGSEGV: [Getter/Setter],\n    SIGSTOP: [Getter/Setter],\n    SIGSYS: [Getter/Setter],\n    SIGTERM: [Getter/Setter],\n    SIGTRAP: [Getter/Setter],\n    SIGTSTP: [Getter/Setter],\n    SIGTTIN: [Getter/Setter],\n    SIGTTOU: [Getter/Setter],\n    SIGURG: [Getter/Setter],\n    SIGUSR1: [Getter/Setter],\n    SIGUSR2: [Getter/Setter],\n    SIGVTALRM: [Getter/Setter],\n    SIGWINCH: [Getter/Setter],\n    SIGXCPU: [Getter/Setter],\n    SIGXFSZ: [Getter/Setter],\n    SSL_OP_ALL: [Getter/Setter],\n    SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION: [Getter/Setter],\n    SSL_OP_CIPHER_SERVER_PREFERENCE: [Getter/Setter],\n    SSL_OP_CISCO_ANYCONNECT: [Getter/Setter],\n    SSL_OP_COOKIE_EXCHANGE: [Getter/Setter],\n    SSL_OP_CRYPTOPRO_TLSEXT_BUG: [Getter/Setter],\n    SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS: [Getter/Setter],\n    SSL_OP_EPHEMERAL_RSA: [Getter/Setter],\n    SSL_OP_LEGACY_SERVER_CONNECT: [Getter/Setter],\n    SSL_OP_MICROSOFT_BIG_SSLV3_BUFFER: [Getter/Setter],\n    SSL_OP_MICROSOFT_SESS_ID_BUG: [Getter/Setter],\n    SSL_OP_MSIE_SSLV2_RSA_PADDING: [Getter/Setter],\n    SSL_OP_NETSCAPE_CA_DN_BUG: [Getter/Setter],\n    SSL_OP_NETSCAPE_CHALLENGE_BUG: [Getter/Setter],\n    SSL_OP_NETSCAPE_DEMO_CIPHER_CHANGE_BUG: [Getter/Setter],\n    SSL_OP_NETSCAPE_REUSE_CIPHER_CHANGE_BUG: [Getter/Setter],\n    SSL_OP_NO_COMPRESSION: [Getter/Setter],\n    SSL_OP_NO_QUERY_MTU: [Getter/Setter],\n    SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION: [Getter/Setter],\n    SSL_OP_NO_SSLv2: [Getter/Setter],\n    SSL_OP_NO_SSLv3: [Getter/Setter],\n    SSL_OP_NO_TICKET: [Getter/Setter],\n    SSL_OP_NO_TLSv1: [Getter/Setter],\n    SSL_OP_NO_TLSv1_1: [Getter/Setter],\n    SSL_OP_NO_TLSv1_2: [Getter/Setter],\n    SSL_OP_PKCS1_CHECK_1: [Getter/Setter],\n    SSL_OP_PKCS1_CHECK_2: [Getter/Setter],\n    SSL_OP_SINGLE_DH_USE: [Getter/Setter],\n    SSL_OP_SINGLE_ECDH_USE: [Getter/Setter],\n    SSL_OP_SSLEAY_080_CLIENT_DH_BUG: [Getter/Setter],\n    SSL_OP_SSLREF2_REUSE_CERT_TYPE_BUG: [Getter/Setter],\n    SSL_OP_TLS_BLOCK_PADDING_BUG: [Getter/Setter],\n    SSL_OP_TLS_D5_BUG: [Getter/Setter],\n    SSL_OP_TLS_ROLLBACK_BUG: [Getter/Setter],\n    S_IFBLK: [Getter/Setter],\n    S_IFCHR: [Getter/Setter],\n    S_IFDIR: [Getter/Setter],\n    S_IFIFO: [Getter/Setter],\n    S_IFLNK: [Getter/Setter],\n    S_IFMT: [Getter/Setter],\n    S_IFREG: [Getter/Setter],\n    S_IFSOCK: [Getter/Setter],\n    S_IRGRP: [Getter/Setter],\n    S_IROTH: [Getter/Setter],\n    S_IRUSR: [Getter/Setter],\n    S_IRWXG: [Getter/Setter],\n    S_IRWXO: [Getter/Setter],\n    S_IRWXU: [Getter/Setter],\n    S_IWGRP: [Getter/Setter],\n    S_IWOTH: [Getter/Setter],\n    S_IWUSR: [Getter/Setter],\n    S_IXGRP: [Getter/Setter],\n    S_IXOTH: [Getter/Setter],\n    S_IXUSR: [Getter/Setter],\n    UV_UDP_REUSEADDR: [Getter/Setter],\n    W_OK: [Getter/Setter],\n    X_OK: [Getter/Setter],\n    default: [Getter/Setter],\n  },\n  crypto: {\n    Cipher: [Getter/Setter],\n    Cipheriv: [Getter/Setter],\n    DEFAULT_ENCODING: [Getter/Setter],\n    Decipher: [Getter/Setter],\n    Decipheriv: [Getter/Setter],\n    DiffieHellman: [Getter/Setter],\n    DiffieHellmanGroup: [Getter/Setter],\n    Hash: [Getter/Setter],\n    Hmac: [Getter/Setter],\n    Sign: [Getter/Setter],\n    Verify: [Getter/Setter],\n    constants: [Getter/Setter],\n    createCipher: [Getter/Setter],\n    createCipheriv: [Getter/Setter],\n    createCredentials: [Getter/Setter],\n    createDecipher: [Getter/Setter],\n    createDecipheriv: [Getter/Setter],\n    createDiffieHellman: [Getter/Setter],\n    createDiffieHellmanGroup: [Getter/Setter],\n    createECDH: [Getter/Setter],\n    createHash: [Getter/Setter],\n    createHmac: [Getter/Setter],\n    createSign: [Getter/Setter],\n    createVerify: [Getter/Setter],\n    default: [Getter/Setter],\n    getCiphers: [Getter/Setter],\n    getCurves: [Getter/Setter],\n    getDiffieHellman: [Getter/Setter],\n    getHashes: [Getter/Setter],\n    getRandomValues: [Getter/Setter],\n    listCiphers: [Getter/Setter],\n    pbkdf2: [Getter/Setter],\n    pbkdf2Sync: [Getter/Setter],\n    privateDecrypt: [Getter/Setter],\n    privateEncrypt: [Getter/Setter],\n    prng: [Getter/Setter],\n    pseudoRandomBytes: [Getter/Setter],\n    publicDecrypt: [Getter/Setter],\n    publicEncrypt: [Getter/Setter],\n    randomBytes: [Getter/Setter],\n    randomFill: [Getter/Setter],\n    randomFillSync: [Getter/Setter],\n    randomUUID: [Getter/Setter],\n    rng: [Getter/Setter],\n    subtle: [Getter/Setter],\n    timingSafeEqual: [Getter/Setter],\n    webcrypto: [Getter/Setter],\n  },\n  dgram: [Function: dgram],\n  dns: [Function: dns],\n  domain: {\n    create: [Getter/Setter],\n    createDomain: [Getter/Setter],\n    default: [Getter/Setter],\n  },\n  events: Function {\n    default: [Function: EventEmitter],\n    length: [Getter],\n    name: [Getter],\n    prototype: [Getter],\n    captureRejections: [Getter],\n    defaultMaxListeners: [Getter],\n    kMaxEventTargetListeners: [Getter],\n    kMaxEventTargetListenersWarned: [Getter],\n    once: [Getter],\n    getEventListeners: [Getter],\n    getMaxListeners: [Getter],\n    setMaxListeners: [Getter],\n    EventEmitter: [Getter],\n    usingDomains: [Getter],\n    captureRejectionSymbol: [Getter],\n    errorMonitor: [Getter],\n    addAbortListener: [Getter],\n    init: [Getter],\n    listenerCount: [Getter],\n  },\n  fs: [Function: fs],\n  http: {\n    Agent: [Getter/Setter],\n    ClientRequest: [Getter/Setter],\n    IncomingMessage: [Getter/Setter],\n    METHODS: [Getter/Setter],\n    STATUS_CODES: [Getter/Setter],\n    default: [Getter/Setter],\n    get: [Getter/Setter],\n    globalAgent: [Getter/Setter],\n    request: [Getter/Setter],\n  },\n  https: {\n    Agent: [Getter/Setter],\n    ClientRequest: [Getter/Setter],\n    IncomingMessage: [Getter/Setter],\n    METHODS: [Getter/Setter],\n    OutgoingMessage: [Getter/Setter],\n    STATUS_CODES: [Getter/Setter],\n    Server: [Getter/Setter],\n    ServerResponse: [Getter/Setter],\n    createServer: [Getter/Setter],\n    default: [Getter/Setter],\n    get: [Getter/Setter],\n    globalAgent: [Getter/Setter],\n    maxHeaderSize: [Getter/Setter],\n    request: [Getter/Setter],\n    setMaxIdleHTTPParsers: [Getter/Setter],\n    validateHeaderName: [Getter/Setter],\n    validateHeaderValue: [Getter/Setter],\n  },\n  module: [Function: module2],\n  net: {\n    default: [Getter/Setter],\n    isIP: [Getter/Setter],\n    isIPv4: [Getter/Setter],\n    isIPv6: [Getter/Setter],\n  },\n  os: {\n    EOL: [Getter/Setter],\n    arch: [Getter/Setter],\n    cpus: [Getter/Setter],\n    default: [Getter/Setter],\n    endianness: [Getter/Setter],\n    freemem: [Getter/Setter],\n    getNetworkInterfaces: [Getter/Setter],\n    homedir: [Getter/Setter],\n    hostname: [Getter/Setter],\n    loadavg: [Getter/Setter],\n    networkInterfaces: [Getter/Setter],\n    platform: [Getter/Setter],\n    release: [Getter/Setter],\n    tmpDir: [Getter/Setter],\n    tmpdir: [Getter/Setter],\n    totalmem: [Getter/Setter],\n    type: [Getter/Setter],\n    uptime: [Getter/Setter],\n  },\n  path: {\n    _makeLong: [Getter/Setter],\n    basename: [Getter/Setter],\n    default: [Getter/Setter],\n    delimiter: [Getter/Setter],\n    dirname: [Getter/Setter],\n    extname: [Getter/Setter],\n    format: [Getter/Setter],\n    isAbsolute: [Getter/Setter],\n    join: [Getter/Setter],\n    normalize: [Getter/Setter],\n    parse: [Getter/Setter],\n    posix: [Getter/Setter],\n    relative: [Getter/Setter],\n    resolve: [Getter/Setter],\n    sep: [Getter/Setter],\n  },\n  perf_hooks: [Function: perf_hooks],\n  process: {\n    addListener: [Getter/Setter],\n    argv: [Getter/Setter],\n    binding: [Getter/Setter],\n    browser: [Getter/Setter],\n    chdir: [Getter/Setter],\n    cwd: [Getter/Setter],\n    default: [Getter/Setter],\n    emit: [Getter/Setter],\n    env: [Getter/Setter],\n    listeners: [Getter/Setter],\n    nextTick: [Getter/Setter],\n    off: [Getter/Setter],\n    on: [Getter/Setter],\n    once: [Getter/Setter],\n    prependListener: [Getter/Setter],\n    prependOnceListener: [Getter/Setter],\n    removeAllListeners: [Getter/Setter],\n    removeListener: [Getter/Setter],\n    title: [Getter/Setter],\n    umask: [Getter/Setter],\n    version: [Getter/Setter],\n    versions: [Getter/Setter],\n  },\n  punycode: {\n    decode: [Getter/Setter],\n    default: [Getter/Setter],\n    encode: [Getter/Setter],\n    toASCII: [Getter/Setter],\n    toUnicode: [Getter/Setter],\n    ucs2: [Getter/Setter],\n    version: [Getter/Setter],\n  },\n  querystring: {\n    decode: [Getter/Setter],\n    default: [Getter/Setter],\n    encode: [Getter/Setter],\n    escape: [Getter/Setter],\n    parse: [Getter/Setter],\n    stringify: [Getter/Setter],\n    unescape: [Getter/Setter],\n    unescapeBuffer: [Getter/Setter],\n  },\n  readline: [Function: readline],\n  repl: [Function: repl],\n  stream: Function {\n    default: [Stream: Readable],\n    length: [Getter],\n    name: [Getter],\n    prototype: [Getter],\n    ReadableState: [Getter],\n    _fromList: [Getter],\n    from: [Getter],\n    fromWeb: [Getter],\n    toWeb: [Getter],\n    wrap: [Getter],\n    _uint8ArrayToBuffer: [Getter],\n    _isUint8Array: [Getter],\n    isDisturbed: [Getter],\n    isErrored: [Getter],\n    isReadable: [Getter],\n    Readable: [Getter],\n    Writable: [Getter],\n    Duplex: [Getter],\n    Transform: [Getter],\n    PassThrough: [Getter],\n    addAbortSignal: [Getter],\n    finished: [Getter],\n    destroy: [Getter],\n    pipeline: [Getter],\n    compose: [Getter],\n    Stream: [Getter],\n    isDestroyed: [Function: isDestroyed],\n    isWritable: [Function: isWritable],\n    setDefaultHighWaterMark: [Function: setDefaultHighWaterMark],\n    getDefaultHighWaterMark: [Function: getDefaultHighWaterMark],\n    promises: [Getter],\n  },\n  string_decoder: {\n    StringDecoder: [Getter/Setter],\n    default: [Getter/Setter],\n  },\n  sys: {\n    TextDecoder: [Getter/Setter],\n    TextEncoder: [Getter/Setter],\n    _extend: [Getter/Setter],\n    callbackify: [Getter/Setter],\n    callbackifyOnRejected: [Getter/Setter],\n    debuglog: [Getter/Setter],\n    default: [Getter/Setter],\n    deprecate: [Getter/Setter],\n    format: [Getter/Setter],\n    inherits: [Getter/Setter],\n    inspect: [Getter/Setter],\n    isArray: [Getter/Setter],\n    isBoolean: [Getter/Setter],\n    isBuffer: [Getter/Setter],\n    isDate: [Getter/Setter],\n    isError: [Getter/Setter],\n    isFunction: [Getter/Setter],\n    isNull: [Getter/Setter],\n    isNullOrUndefined: [Getter/Setter],\n    isNumber: [Getter/Setter],\n    isObject: [Getter/Setter],\n    isPrimitive: [Getter/Setter],\n    isRegExp: [Getter/Setter],\n    isString: [Getter/Setter],\n    isSymbol: [Getter/Setter],\n    isUndefined: [Getter/Setter],\n    log: [Getter/Setter],\n    promisify: [Getter/Setter],\n    types: [Getter/Setter],\n  },\n  timers: {\n    _unrefActive: [Getter/Setter],\n    clearImmediate: [Getter/Setter],\n    clearInterval: [Getter/Setter],\n    clearTimeout: [Getter/Setter],\n    default: [Getter/Setter],\n    promises: [Getter/Setter],\n    setImmediate: [Getter/Setter],\n    setInterval: [Getter/Setter],\n    setTimeout: [Getter/Setter],\n  },\n  tls: [Function: tls],\n  tty: {\n    ReadStream: [Getter/Setter],\n    WriteStream: [Getter/Setter],\n    default: [Getter/Setter],\n    isatty: [Getter/Setter],\n  },\n  url: {\n    URL: [Getter/Setter],\n    URLSearchParams: [Getter/Setter],\n    Url: [Getter/Setter],\n    default: [Getter/Setter],\n    format: [Getter/Setter],\n    parse: [Getter/Setter],\n    resolve: [Getter/Setter],\n    resolveObject: [Getter/Setter],\n  },\n  util: {\n    TextDecoder: [Getter/Setter],\n    TextEncoder: [Getter/Setter],\n    _extend: [Getter/Setter],\n    callbackify: [Getter/Setter],\n    callbackifyOnRejected: [Getter/Setter],\n    debuglog: [Getter/Setter],\n    default: [Getter/Setter],\n    deprecate: [Getter/Setter],\n    format: [Getter/Setter],\n    inherits: [Getter/Setter],\n    inspect: [Getter/Setter],\n    isArray: [Getter/Setter],\n    isBoolean: [Getter/Setter],\n    isBuffer: [Getter/Setter],\n    isDate: [Getter/Setter],\n    isError: [Getter/Setter],\n    isFunction: [Getter/Setter],\n    isNull: [Getter/Setter],\n    isNullOrUndefined: [Getter/Setter],\n    isNumber: [Getter/Setter],\n    isObject: [Getter/Setter],\n    isPrimitive: [Getter/Setter],\n    isRegExp: [Getter/Setter],\n    isString: [Getter/Setter],\n    isSymbol: [Getter/Setter],\n    isUndefined: [Getter/Setter],\n    log: [Getter/Setter],\n    promisify: [Getter/Setter],\n    types: [Getter/Setter],\n  },\n  v8: [Function: v8],\n  vm: [Function: vm],\n  zlib: {\n    Deflate: [Getter/Setter],\n    DeflateRaw: [Getter/Setter],\n    Gunzip: [Getter/Setter],\n    Gzip: [Getter/Setter],\n    Inflate: [Getter/Setter],\n    InflateRaw: [Getter/Setter],\n    Unzip: [Getter/Setter],\n    Z_BEST_COMPRESSION: [Getter/Setter],\n    Z_BEST_SPEED: [Getter/Setter],\n    Z_BINARY: [Getter/Setter],\n    Z_BLOCK: [Getter/Setter],\n    Z_BUF_ERROR: [Getter/Setter],\n    Z_DATA_ERROR: [Getter/Setter],\n    Z_DEFAULT_CHUNK: [Getter/Setter],\n    Z_DEFAULT_COMPRESSION: [Getter/Setter],\n    Z_DEFAULT_LEVEL: [Getter/Setter],\n    Z_DEFAULT_MEMLEVEL: [Getter/Setter],\n    Z_DEFAULT_STRATEGY: [Getter/Setter],\n    Z_DEFAULT_WINDOWBITS: [Getter/Setter],\n    Z_DEFLATED: [Getter/Setter],\n    Z_ERRNO: [Getter/Setter],\n    Z_FILTERED: [Getter/Setter],\n    Z_FINISH: [Getter/Setter],\n    Z_FIXED: [Getter/Setter],\n    Z_FULL_FLUSH: [Getter/Setter],\n    Z_HUFFMAN_ONLY: [Getter/Setter],\n    Z_MAX_CHUNK: [Getter/Setter],\n    Z_MAX_LEVEL: [Getter/Setter],\n    Z_MAX_MEMLEVEL: [Getter/Setter],\n    Z_MAX_WINDOWBITS: [Getter/Setter],\n    Z_MIN_CHUNK: [Getter/Setter],\n    Z_MIN_LEVEL: [Getter/Setter],\n    Z_MIN_MEMLEVEL: [Getter/Setter],\n    Z_MIN_WINDOWBITS: [Getter/Setter],\n    Z_NEED_DICT: [Getter/Setter],\n    Z_NO_COMPRESSION: [Getter/Setter],\n    Z_NO_FLUSH: [Getter/Setter],\n    Z_OK: [Getter/Setter],\n    Z_PARTIAL_FLUSH: [Getter/Setter],\n    Z_RLE: [Getter/Setter],\n    Z_STREAM_END: [Getter/Setter],\n    Z_STREAM_ERROR: [Getter/Setter],\n    Z_SYNC_FLUSH: [Getter/Setter],\n    Z_TEXT: [Getter/Setter],\n    Z_TREES: [Getter/Setter],\n    Z_UNKNOWN: [Getter/Setter],\n    Zlib: [Getter/Setter],\n    codes: [Getter/Setter],\n    constants: [Getter/Setter],\n    createDeflate: [Getter/Setter],\n    createDeflateRaw: [Getter/Setter],\n    createGunzip: [Getter/Setter],\n    createGzip: [Getter/Setter],\n    createInflate: [Getter/Setter],\n    createInflateRaw: [Getter/Setter],\n    createUnzip: [Getter/Setter],\n    default: [Getter/Setter],\n    deflate: [Getter/Setter],\n    deflateRaw: [Getter/Setter],\n    deflateRawSync: [Getter/Setter],\n    deflateSync: [Getter/Setter],\n    gunzip: [Getter/Setter],\n    gunzipSync: [Getter/Setter],\n    gzip: [Getter/Setter],\n    gzipSync: [Getter/Setter],\n    inflate: [Getter/Setter],\n    inflateRaw: [Getter/Setter],\n    inflateRawSync: [Getter/Setter],\n    inflateSync: [Getter/Setter],\n    unzip: [Getter/Setter],\n    unzipSync: [Getter/Setter],\n  },\n}";
  // The bundler checks a named import against the export list of an ES module polyfill.
  itBundled("browser/NodePolyfillMissingExportFailsBuild", {
    files: {
      "/entry.js": `
        import { Console } from "node:console";
        console.log(Console);
      `,
    },
    target: "browser",
    bundleErrors: {
      "/entry.js": [`Browser polyfill for module "node:console" doesn't have a matching export named "Console"`],
    },
  });
  // `import x from "node:x"` must build for every polyfilled builtin, and the default export has every named
  // export. `buffer` and `string_decoder` default to their class, which browser/NodeBuffer#12272 relies on.
  const polyfilled = Object.keys(nodePolyfillList).filter(name => nodePolyfillList[name] === "polyfill");
  const classDefault = ["buffer", "string_decoder"];
  const defaultImports = JSON.stringify(
    Object.fromEntries(
      polyfilled.map(name => [
        name,
        ["assert", "events", "stream", ...classDefault].includes(name) ? "function" : "object",
      ]),
    ),
  );
  itBundled("browser/NodePolyfillDefaultImports", {
    files: {
      "/entry.js":
        polyfilled.map((name, i) => `import m${i}, * as n${i} from "node:${name}";`).join("\n") +
        `\nconst check = (name, def, ns) => {
          const missing = Object.keys(ns).filter(key => key !== "default" && def[key] !== ns[key]);
          return ${JSON.stringify(classDefault)}.includes(name) || missing.length === 0 ? typeof def : "default lacks " + missing;
        };` +
        `\nconsole.log(JSON.stringify({ ${polyfilled.map((name, i) => `${JSON.stringify(name)}: check(${JSON.stringify(name)}, m${i}, n${i})`).join(", ")} }));`,
    },
    runtimeFiles: { ...withoutNodeGlobals, ...asClassicScript },
    target: "browser",
    // The third run has every polyfill in one classic script: none may replace a global of the page.
    run: ["/out.js", "/without-node-globals.js", "/classic-script.js"].map(file => ({ file, stdout: defaultImports })),
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

  itBundled("browser/NodeStreamWithoutGlobalProcess", {
    files: {
      "/entry.js": /* js */ `
        import { Readable } from "node:stream";
        const r = Readable.from(["a", "b"]);
        const chunks = [];
        console.log(await new Promise((resolve, reject) => {
          r.on("data", d => chunks.push(d));
          r.on("end", () => resolve("got:" + chunks.join(",")));
          r.on("error", reject);
        }));
      `,
    },
    runtimeFiles: {
      ...withoutNodeGlobals,
      // A host's process can lack what the packages call. A sandboxed Electron preload has `versions.node`.
      "/trimmed-process.js": /* js */ `
        globalThis.process = { versions: { node: "22.0.0" }, env: {} };
        await import("./out.js");
      `,
    },
    target: "browser",
    run: ["/out.js", "/without-node-globals.js", "/trimmed-process.js"].map(file => ({ file, stdout: "got:a,b" })),
    onAfterBundle(api) {
      api.expectFile("out.js").not.toInclude("import ");
    },
  });
  // Under node or bun, the packages in a polyfill keep the host's process. readable-stream compares a pipe's
  // destination with process.stdout, and ends every other destination with the source.
  itBundled("browser/NodeStreamPipeKeepsHostStdoutOpen", {
    files: {
      "/entry.js": /* js */ `
        import { Readable } from "node:stream";
        const source = Readable.from(["a\\n", "b\\n"]);
        source.pipe(process.stdout);
        source.on("end", () => setTimeout(() => process.stdout.write("stdout is still open\\n"), 0));
      `,
    },
    target: "browser",
    run: { stdout: "a\nb\nstdout is still open" },
  });
  // The host's nextTick keeps the AsyncLocalStorage store of each caller. One shared microtask drain cannot.
  itBundled("browser/NodeStreamKeepsHostAsyncContext", {
    files: {
      "/entry.js": /* js */ `
        import { PassThrough } from "node:stream";
        globalThis.makeStream = () => new PassThrough().resume();
      `,
    },
    target: "browser",
    runtimeFiles: {
      "/exec.js": /* js */ `
        import { AsyncLocalStorage } from "node:async_hooks";
        await import("./out.js");
        const store = new AsyncLocalStorage();
        const seen = [];
        const streams = { A: makeStream(), B: makeStream() };
        const closed = Promise.all(Object.values(streams).map(stream => new Promise(resolve => stream.on("close", resolve))));
        for (const [name, stream] of Object.entries(streams)) {
          store.run(name, () => {
            stream.on("finish", () => seen.push(name + " finished in " + store.getStore()));
            stream.end("x");
          });
        }
        await closed;
        console.log(seen.join(", "));
      `,
    },
    run: { file: "/exec.js", stdout: "A finished in A, B finished in B" },
  });
  itBundled("browser/NodeProcessNextTickForwardsArgs", {
    files: {
      "/entry.js": /* js */ `
        import { nextTick } from "node:process";
        console.log(await new Promise(resolve => nextTick((a, b, c) => resolve(a + b + c), "x", "y", "z")));
      `,
    },
    target: "browser",
    run: { stdout: "xyz" },
  });
  // No promise job runs between a tick and the tick that it queues, as in node. The full order differs from node in
  // one case: from a script, a timer or an event, node runs a tick before the promise jobs that are already queued.
  // A browser has no hook for that, so the polyfill queues one microtask for the drain.
  itBundled("browser/NodeProcessNextTickOrder", {
    files: {
      "/entry.js": /* js */ `
        import process, { nextTick } from "node:process";
        const log = [];
        await new Promise(resolve => {
          setTimeout(() => { log.push("timeout"); resolve(); }, 0);
          nextTick(tag => { log.push(tag); process.nextTick(tag => log.push(tag), "nested tick"); }, "tick");
          Promise.resolve().then(() => log.push("promise job"));
        });
        console.log(log.join(" < "));
        try {
          nextTick(null);
        } catch (e) {
          console.log(e.name + " " + e.code + ": " + e.message);
        }
        // The message must not coerce the value: this one has no toString.
        try {
          nextTick(Object.create(null));
        } catch (e) {
          console.log(e.name + " " + e.code);
        }
      `,
    },
    target: "browser",
    run: {
      stdout:
        "tick < nested tick < promise job < timeout\n" +
        'TypeError ERR_INVALID_ARG_TYPE: The "callback" argument must be of type function. Received null\n' +
        "TypeError ERR_INVALID_ARG_TYPE",
    },
  });
  // A tick that throws drops only itself. The ticks behind it, and the ticks they queue, still run before a timer.
  itBundled("browser/NodeProcessNextTickThrow", {
    files: {
      "/entry.js": /* js */ `
        import { nextTick } from "node:process";
        const log = (globalThis.log = []);
        setTimeout(() => console.log(log.concat("timeout").join(",")), 0);
        nextTick(tag => { log.push(tag); nextTick(tag => log.push(tag), "a2"); }, "a");
        nextTick(() => { throw new Error("boom"); });
        nextTick(tag => {
          log.push(tag);
          nextTick(tag => log.push(tag), "c2");
          nextTick(() => { throw new Error("last"); });
        }, "c");
      `,
    },
    target: "browser",
    runtimeFiles: {
      "/exec.js": /* js */ `
        process.on("uncaughtException", error => globalThis.log.push("caught:" + error.message));
        await import("./out.js");
      `,
    },
    run: { file: "/exec.js", stdout: "a,caught:boom,c,a2,c2,caught:last,timeout" },
  });
  // In a browser, `({ setTimeout }).setTimeout(fn)` throws "Illegal invocation". The default export and
  // `require("timers")` call the timers as methods. The third run loads the bundle as a classic script, where a
  // top-level `var setTimeout` in the bundle would replace the page's own.
  itBundled("browser/NodeTimersCalledAsMethods", {
    files: {
      "/entry.js": /* js */ `
        import timers from "node:timers";
        import dep from "dep";
        (async () => {
          const interval = await new Promise(resolve => {
            const id = timers.setInterval(() => { timers.clearInterval(id); resolve("interval"); }, 0);
          });
          const timeout = await new Promise(resolve => timers.setTimeout(resolve, 0, "timeout"));
          timers.clearTimeout(timers.setTimeout(() => console.log("a cleared timeout ran"), 0));
          timers.clearImmediate(timers.setImmediate(() => console.log("a cleared immediate ran")));
          const immediate = await new Promise(resolve => timers.setImmediate(resolve, "immediate"));
          console.log(JSON.stringify([interval, timeout, immediate, await dep]));
        })();
      `,
      "/node_modules/dep/package.json": `{ "name": "dep", "main": "index.js" }`,
      "/node_modules/dep/index.js": /* js */ `
        module.exports = new Promise(resolve => require("timers").setTimeout(resolve, 0, "required"));
      `,
    },
    runtimeFiles: { ...withoutNodeGlobals, ...asClassicScript },
    target: "browser",
    run: ["/out.js", "/without-node-globals.js", "/classic-script.js"].map(file => ({
      file,
      stdout: '["interval","timeout","immediate","required"]',
    })),
    onAfterBundle(api) {
      // If the bundler ever binds this call directly, the dependency no longer calls the timer as a method.
      api.expectFile("/out.js").toContain('.setTimeout(resolve, 0, "required")');
    },
  });
  // node gives setTimeout and setImmediate a util.promisify.custom function. Without it, promisify passes the
  // callback last and a browser takes the delay as the handler. A page's own setTimeout has no such function.
  const promisifiedTimers = JSON.stringify([
    "timeout value",
    null,
    "immediate value",
    "AbortError:ABORT_ERR",
    "AbortError:ABORT_ERR",
    "AbortError:ABORT_ERR",
    "global timeout value",
  ]);
  itBundled("browser/NodeTimersPromisify", {
    files: {
      "/entry.js": /* js */ `
        import { promisify } from "node:util";
        import timers, { setTimeout as timersSetTimeout, setImmediate as timersSetImmediate } from "node:timers";
        (async () => {
          const sleep = promisify(timersSetTimeout);
          const describe = promise => promise.then(value => "resolved " + value, error => error.name + ":" + error.code);
          const controller = new AbortController();
          const aborted = describe(sleep(60_000, "never", { signal: controller.signal }));
          controller.abort();
          console.log(JSON.stringify([
            await sleep(1, "timeout value"),
            await promisify(timers.setTimeout)(1),
            await promisify(timersSetImmediate)("immediate value"),
            await aborted,
            await describe(sleep(1, "never", { signal: AbortSignal.abort() })),
            await describe(promisify(timersSetImmediate)("never", { signal: AbortSignal.abort() })),
            await promisify(setTimeout)(1, "global timeout value"),
          ]));
        })();
      `,
    },
    runtimeFiles: { ...withoutNodeGlobals, ...asClassicScript },
    target: "browser",
    run: ["/out.js", "/without-node-globals.js", "/classic-script.js"].map(file => ({
      file,
      stdout: promisifiedTimers,
    })),
  });
  // In a page, a stream schedules its events on the queue of the process polyfill. So they run in tick order with
  // the page's own ticks, and before timers.
  itBundled("browser/NodeStreamUsesProcessPolyfillTickQueue", {
    files: {
      "/entry.js": /* js */ `
        import { Readable } from "node:stream";
        import { nextTick } from "node:process";
        const log = [];
        console.log(await new Promise(resolve => {
          setTimeout(() => { log.push("timeout"); resolve(log.join(" < ")); }, 0);
          const stream = new Readable({ read() {} });
          stream.on("data", () => log.push("stream data"));
          stream.push("x");
          nextTick(() => log.push("process tick"));
        }));
      `,
    },
    runtimeFiles: withoutNodeGlobals,
    target: "browser",
    run: { file: "/without-node-globals.js", stdout: "stream data < process tick < timeout" },
  });
  // Each tick queues the next and forwards its payload as an argument, so the
  // whole chain runs in one drain. A tick that already ran must not stay
  // reachable until the chain ends.
  itBundled("browser/NodeProcessNextTickChainReleasesCallbacks", {
    files: {
      "/entry.js": /* js */ `
        import { nextTick } from "node:process";
        globalThis.DONE = new Promise(resolve => {
          function step(remaining, payload) {
            if (typeof remaining !== "number") return resolve("nextTick dropped its arguments");
            if (remaining === 0) return resolve(globalThis.liveAfterGC());
            nextTick(step, remaining - 1, new Float64Array(1));
          }
          step(5000);
        });
      `,
    },
    target: "browser",
    runtimeFiles: {
      "/exec.js": /* js */ `
        import { heapStats } from "bun:jsc";
        const count = () => heapStats().objectTypeCounts.Float64Array ?? 0;
        Bun.gc(true);
        const before = count();
        globalThis.liveAfterGC = () => (Bun.gc(true), count() - before);
        await import("./out.js");
        const live = await globalThis.DONE;
        console.log(typeof live !== "number" ? live : live < 100 ? "released" : "retained " + live);
      `,
    },
    run: {
      file: "/exec.js",
      stdout: "released",
    },
  });
  // The util polyfill is a hand conversion of the npm `util` package. Each of
  // these exports had a bug from that conversion: an undeclared identifier, a
  // spread into Function#apply, or a dependency on a Node-only global.
  itBundled("browser/NodeUtilPolyfill", {
    files: {
      "/entry.js": /* js */ `
        import util, { promisify, callbackify, deprecate, isBuffer, debuglog } from "node:util";
        import * as utilNamespace from "node:util";
        import { Buffer } from "node:buffer";
        import { resolve as resolvePath } from "node:path";

        const host = globalThis.hostProcess;
        const results = [];

        results.push(await promisify((a, b, cb) => cb(null, a + b))(40, 2));
        results.push(await promisify(cb => cb(new Error("cb failed")))().then(() => "resolved", e => e.message));
        const withCustom = () => {};
        withCustom[promisify.custom] = () => Promise.resolve("custom");
        results.push(promisify(withCustom) === withCustom[promisify.custom] ? await promisify(withCustom)() : "custom ignored");

        results.push(await new Promise(resolve => callbackify(async x => x * 2)(21, (err, value) => resolve(err + "," + value))));
        results.push(await new Promise(resolve => callbackify(async () => { throw new Error("rejected"); })(err => resolve(err.message))));
        results.push(await new Promise(resolve => callbackify(() => Promise.reject(null))(err => resolve(err.message + "," + err.reason))));
        // As in node, a throw inside the callback is an uncaught exception, not a rejection.
        const uncaught = new Promise(resolve => host.once("uncaughtException", err => resolve("uncaughtException: " + err.message)));
        callbackify(async () => 1)(() => { throw new Error("in callback"); });
        results.push(await uncaught);

        // Without a process there is no deprecation config: the function comes back as is.
        const plain = () => {};
        results.push(deprecate(plain, "old") === plain);
        // With one, the wrapper warns once and forwards this and the arguments.
        globalThis.process = host;
        const warnings = [];
        const consoleError = console.error;
        console.error = msg => warnings.push(msg);
        const target = { base: 1, old: deprecate(function (a, b) { return this.base + a + b; }, "old is deprecated") };
        results.push(target.old(2, 3) + "," + target.old(4, 5) + "," + warnings.join("|"));
        // NODE_DEBUG is set for this run. A browser build has no debug sections, as before.
        debuglog("util-test")("never printed");
        results.push(typeof debuglog("anything") + "," + warnings.length);
        console.error = consoleError;
        delete globalThis.process;

        results.push([isBuffer(Buffer.from("x")), isBuffer(new Uint8Array(1)), isBuffer(null), isBuffer("str")].join(","));
        results.push(resolvePath("relative/x"));
        const missing = Object.keys(utilNamespace).filter(name => name !== "default" && util[name] !== utilNamespace[name]);
        results.push("missing from default export: " + missing.join(","));
        console.log(results.join("\\n"));
      `,
    },
    target: "browser",
    runtimeFiles: {
      ...withoutNodeGlobals,
      // The entry needs the host's process for two checks. Exit on an unhandled rejection, so that a polyfill
      // which reaches for a missing global fails fast and does not hang.
      "/exec.js": /* js */ `
        globalThis.hostProcess = process;
        process.on("unhandledRejection", err => {
          console.log("unhandledRejection: " + err.message);
          process.exit(1);
        });
        await import("./without-node-globals.js");
      `,
    },
    run: {
      file: "/exec.js",
      env: { NODE_DEBUG: "util-test,anything" },
      stdout: [
        "42",
        "cb failed",
        "custom",
        "null,42",
        "rejected",
        "Promise was rejected with a falsy value,null",
        "uncaughtException: in callback",
        "true",
        "6,10,old is deprecated",
        "function,1",
        "true,false,false,false",
        "/relative/x",
        "missing from default export: ",
      ].join("\n"),
    },
  });
  // A browser has no process, Buffer, or setImmediate global. The packages in a polyfill take the first two from
  // the sibling polyfills. The same bundle also runs under a host that has them.
  const withoutGlobals = JSON.stringify({
    stream: "data:a",
    assert: "true:ERR_ASSERTION",
    util: [null, 5],
    inspect: "{ a: [ 1, 'b' ] }",
    path: "/x",
    timers: ["function", "immediate:ok"],
    zlib: "hello",
    gzip: "hi",
    base64: ["aGk=", "hi"],
  });
  itBundled("browser/NodePolyfillsRunWithoutNodeGlobals", {
    files: {
      "/entry.js": /* js */ `
        import { Readable } from "node:stream";
        import * as assert from "node:assert";
        import { callbackify, inspect } from "node:util";
        import { resolve } from "node:path";
        import { setImmediate, clearImmediate } from "node:timers";
        import { gzipSync, gunzipSync, gzip, gunzip } from "node:zlib";
        import base64 from "base64";
        const out = {};
        out.stream = await new Promise(r => Readable.from(["a", "b"]).on("data", c => r("data:" + c)));
        try { assert.strictEqual(1, 2); } catch (e) { out.assert = (e instanceof assert.AssertionError) + ":" + e.code; }
        out.util = await new Promise(r => callbackify(async () => 5)((e, v) => r([e, v])));
        out.inspect = inspect({ a: [1, "b"] });
        out.path = resolve("/x");
        out.timers = [typeof clearImmediate, await new Promise(r => setImmediate(v => r("immediate:" + v), "ok"))];
        out.zlib = gunzipSync(gzipSync("hello")).toString();
        out.gzip = await new Promise(r => gzip("hi", (e, zipped) => (e ? r(String(e)) : gunzip(zipped, (e, text) => r(String(e || text))))));
        out.base64 = base64;
        console.log(JSON.stringify(out));
      `,
      "/node_modules/base64/package.json": `{ "name": "base64", "main": "index.js" }`,
      "/node_modules/base64/index.js": /* js */ `
        module.exports = [require("buffer").btoa("hi"), require("buffer").atob("aGk=")];
      `,
    },
    runtimeFiles: withoutNodeGlobals,
    target: "browser",
    run: [{ stdout: withoutGlobals }, { file: "/without-node-globals.js", stdout: withoutGlobals }],
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain('.btoa("hi")');
    },
  });

  // zlib, punycode and console wrap a CommonJS package; assert and events must
  // be callable from `require()`. A `require()` from a dependency and a named
  // ESM import must both see the real exports. The second dependency has the
  // helpers that tsc and Babel emit for a default import and a namespace import.
  const interopExports = JSON.stringify([
    ["function", "function", 9, 9, "xn--maana-pta.com", "function", "function", "function", "pong"],
    ["function", "function", true, "function", 2],
    1,
    2,
    true,
  ]);
  itBundled("browser/NodeZlibPunycodeConsoleAssertEventsExports", {
    files: {
      "/entry.js": /* js */ `
        import zlib, { gzipSync, gunzipSync, Z_BEST_SPEED, constants } from "node:zlib";
        import { toASCII, toUnicode } from "node:punycode";
        import { log } from "node:console";
        import assert, { strictEqual, AssertionError } from "node:assert";
        import EventEmitter, { once } from "node:events";
        import dep from "dep";
        import compiled from "compiled";
        assert(new EventEmitter() instanceof EventEmitter && EventEmitter.once === once);
        assert(gunzipSync(gzipSync("round trip")).toString() === "round trip");
        strictEqual(toUnicode(toASCII("mañana.com")), "mañana.com");
        let threw = false;
        try { assert(false, "boom"); } catch (e) { threw = e instanceof AssertionError && e.message === "boom"; }
        log(JSON.stringify([dep, compiled.default ?? compiled, Z_BEST_SPEED, zlib.constants === constants && constants.Z_SYNC_FLUSH, threw]));
      `,
      "/node_modules/dep/package.json": `{ "name": "dep", "main": "index.js" }`,
      "/node_modules/dep/index.js": /* js */ `
        const zlib = require("zlib");
        const punycode = require("punycode");
        const con = require("console");
        const assert = require("assert");
        const EventEmitter = require("events");
        assert(typeof assert.strictEqual === "function");
        const emitter = new EventEmitter();
        let emitted;
        emitter.on("ping", value => (emitted = value));
        emitter.emit("ping", "pong");
        module.exports = [
          typeof zlib.createGzip,
          typeof zlib.gzipSync,
          zlib.Z_BEST_COMPRESSION,
          zlib.constants.Z_BEST_COMPRESSION,
          punycode.toASCII("mañana.com"),
          typeof con.log,
          typeof assert,
          EventEmitter === EventEmitter.EventEmitter && typeof require("events").once,
          emitted,
        ];
      `,
      "/node_modules/compiled/package.json": `{ "name": "compiled", "main": "index.js" }`,
      "/node_modules/compiled/index.js": /* js */ `
        "use strict";
        var __importDefault = (this && this.__importDefault) || function (mod) {
          return (mod && mod.__esModule) ? mod : { "default": mod };
        };
        function _interopRequireWildcard(e, t) {
          if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap();
          return (_interopRequireWildcard = function (e, t) {
            if (!t && e && e.__esModule) return e;
            var o, i, f = { __proto__: null, default: e };
            if (null === e || "object" != typeof e && "function" != typeof e) return f;
            if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); }
            for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]);
            return f;
          })(e, t);
        }
        Object.defineProperty(exports, "__esModule", { value: true });
        const events_1 = __importDefault(require("events"));
        const events_2 = _interopRequireWildcard(require("node:events"));
        const assert_1 = __importDefault(require("assert"));
        const process_1 = __importDefault(require("process"));
        const os_1 = __importDefault(require("os"));
        const zlib_1 = _interopRequireWildcard(require("zlib"));
        class Sub extends events_1.default {}
        (0, assert_1.default)(new Sub() instanceof events_2.EventEmitter);
        exports.default = [
          typeof process_1.default.nextTick,
          typeof os_1.default.platform,
          events_2.default === events_1.default,
          typeof events_2.once,
          zlib_1.constants.Z_SYNC_FLUSH,
        ];
      `,
    },
    runtimeFiles: withoutNodeGlobals,
    target: "browser",
    run: [{ stdout: interopExports }, { file: "/without-node-globals.js", stdout: interopExports }],
  });
});
