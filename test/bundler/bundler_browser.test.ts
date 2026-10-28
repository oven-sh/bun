import assert from "assert";
import type { BunPlugin } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, readdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import { bun, layouts, table } from "./browser-field-matrix";
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
        "{\n  assert: {\n    AssertionError: [Getter/Setter],\n    CallTracker: [Getter/Setter],\n    deepEqual: [Getter/Setter],\n    deepStrictEqual: [Getter/Setter],\n    default: [Getter/Setter],\n    doesNotMatch: [Getter/Setter],\n    doesNotReject: [Getter/Setter],\n    doesNotThrow: [Getter/Setter],\n    equal: [Getter/Setter],\n    fail: [Getter/Setter],\n    ifError: [Getter/Setter],\n    match: [Getter/Setter],\n    notDeepEqual: [Getter/Setter],\n    notDeepStrictEqual: [Getter/Setter],\n    notEqual: [Getter/Setter],\n    notStrictEqual: [Getter/Setter],\n    ok: [Getter/Setter],\n    rejects: [Getter/Setter],\n    strict: [Getter/Setter],\n    strictEqual: [Getter/Setter],\n    throws: [Getter/Setter],\n  },\n  buffer: {\n    Blob: [Getter/Setter],\n    Buffer: [Getter/Setter],\n    File: [Getter/Setter],\n    INSPECT_MAX_BYTES: [Getter/Setter],\n    atob: [Getter/Setter],\n    btoa: [Getter/Setter],\n    constants: [Getter/Setter],\n    default: [Getter/Setter],\n    isAscii: [Getter/Setter],\n    isUtf8: [Getter/Setter],\n    kMaxLength: [Getter/Setter],\n    kStringMaxLength: [Getter/Setter],\n    resolveObjectURL: [Getter/Setter],\n    transcode: [Getter/Setter],\n  },\n  child_process: [Function: child_process],\n  cluster: [Function: cluster],\n  console2: {\n    default: [Getter/Setter],\n  },\n  constants: {\n    DH_CHECK_P_NOT_PRIME: [Getter/Setter],\n    DH_CHECK_P_NOT_SAFE_PRIME: [Getter/Setter],\n    DH_NOT_SUITABLE_GENERATOR: [Getter/Setter],\n    DH_UNABLE_TO_CHECK_GENERATOR: [Getter/Setter],\n    E2BIG: [Getter/Setter],\n    EACCES: [Getter/Setter],\n    EADDRINUSE: [Getter/Setter],\n    EADDRNOTAVAIL: [Getter/Setter],\n    EAFNOSUPPORT: [Getter/Setter],\n    EAGAIN: [Getter/Setter],\n    EALREADY: [Getter/Setter],\n    EBADF: [Getter/Setter],\n    EBADMSG: [Getter/Setter],\n    EBUSY: [Getter/Setter],\n    ECANCELED: [Getter/Setter],\n    ECHILD: [Getter/Setter],\n    ECONNABORTED: [Getter/Setter],\n    ECONNREFUSED: [Getter/Setter],\n    ECONNRESET: [Getter/Setter],\n    EDEADLK: [Getter/Setter],\n    EDESTADDRREQ: [Getter/Setter],\n    EDOM: [Getter/Setter],\n    EDQUOT: [Getter/Setter],\n    EEXIST: [Getter/Setter],\n    EFAULT: [Getter/Setter],\n    EFBIG: [Getter/Setter],\n    EHOSTUNREACH: [Getter/Setter],\n    EIDRM: [Getter/Setter],\n    EILSEQ: [Getter/Setter],\n    EINPROGRESS: [Getter/Setter],\n    EINTR: [Getter/Setter],\n    EINVAL: [Getter/Setter],\n    EIO: [Getter/Setter],\n    EISCONN: [Getter/Setter],\n    EISDIR: [Getter/Setter],\n    ELOOP: [Getter/Setter],\n    EMFILE: [Getter/Setter],\n    EMLINK: [Getter/Setter],\n    EMSGSIZE: [Getter/Setter],\n    EMULTIHOP: [Getter/Setter],\n    ENAMETOOLONG: [Getter/Setter],\n    ENETDOWN: [Getter/Setter],\n    ENETRESET: [Getter/Setter],\n    ENETUNREACH: [Getter/Setter],\n    ENFILE: [Getter/Setter],\n    ENGINE_METHOD_ALL: [Getter/Setter],\n    ENGINE_METHOD_CIPHERS: [Getter/Setter],\n    ENGINE_METHOD_DH: [Getter/Setter],\n    ENGINE_METHOD_DIGESTS: [Getter/Setter],\n    ENGINE_METHOD_DSA: [Getter/Setter],\n    ENGINE_METHOD_ECDH: [Getter/Setter],\n    ENGINE_METHOD_ECDSA: [Getter/Setter],\n    ENGINE_METHOD_NONE: [Getter/Setter],\n    ENGINE_METHOD_PKEY_ASN1_METHS: [Getter/Setter],\n    ENGINE_METHOD_PKEY_METHS: [Getter/Setter],\n    ENGINE_METHOD_RAND: [Getter/Setter],\n    ENGINE_METHOD_STORE: [Getter/Setter],\n    ENOBUFS: [Getter/Setter],\n    ENODATA: [Getter/Setter],\n    ENODEV: [Getter/Setter],\n    ENOENT: [Getter/Setter],\n    ENOEXEC: [Getter/Setter],\n    ENOLCK: [Getter/Setter],\n    ENOLINK: [Getter/Setter],\n    ENOMEM: [Getter/Setter],\n    ENOMSG: [Getter/Setter],\n    ENOPROTOOPT: [Getter/Setter],\n    ENOSPC: [Getter/Setter],\n    ENOSR: [Getter/Setter],\n    ENOSTR: [Getter/Setter],\n    ENOSYS: [Getter/Setter],\n    ENOTCONN: [Getter/Setter],\n    ENOTDIR: [Getter/Setter],\n    ENOTEMPTY: [Getter/Setter],\n    ENOTSOCK: [Getter/Setter],\n    ENOTSUP: [Getter/Setter],\n    ENOTTY: [Getter/Setter],\n    ENXIO: [Getter/Setter],\n    EOPNOTSUPP: [Getter/Setter],\n    EOVERFLOW: [Getter/Setter],\n    EPERM: [Getter/Setter],\n    EPIPE: [Getter/Setter],\n    EPROTO: [Getter/Setter],\n    EPROTONOSUPPORT: [Getter/Setter],\n    EPROTOTYPE: [Getter/Setter],\n    ERANGE: [Getter/Setter],\n    EROFS: [Getter/Setter],\n    ESPIPE: [Getter/Setter],\n    ESRCH: [Getter/Setter],\n    ESTALE: [Getter/Setter],\n    ETIME: [Getter/Setter],\n    ETIMEDOUT: [Getter/Setter],\n    ETXTBSY: [Getter/Setter],\n    EWOULDBLOCK: [Getter/Setter],\n    EXDEV: [Getter/Setter],\n    F_OK: [Getter/Setter],\n    NPN_ENABLED: [Getter/Setter],\n    O_APPEND: [Getter/Setter],\n    O_CREAT: [Getter/Setter],\n    O_DIRECTORY: [Getter/Setter],\n    O_EXCL: [Getter/Setter],\n    O_NOCTTY: [Getter/Setter],\n    O_NOFOLLOW: [Getter/Setter],\n    O_NONBLOCK: [Getter/Setter],\n    O_RDONLY: [Getter/Setter],\n    O_RDWR: [Getter/Setter],\n    O_SYMLINK: [Getter/Setter],\n    O_SYNC: [Getter/Setter],\n    O_TRUNC: [Getter/Setter],\n    O_WRONLY: [Getter/Setter],\n    POINT_CONVERSION_COMPRESSED: [Getter/Setter],\n    POINT_CONVERSION_HYBRID: [Getter/Setter],\n    POINT_CONVERSION_UNCOMPRESSED: [Getter/Setter],\n    RSA_NO_PADDING: [Getter/Setter],\n    RSA_PKCS1_OAEP_PADDING: [Getter/Setter],\n    RSA_PKCS1_PADDING: [Getter/Setter],\n    RSA_PKCS1_PSS_PADDING: [Getter/Setter],\n    RSA_SSLV23_PADDING: [Getter/Setter],\n    RSA_X931_PADDING: [Getter/Setter],\n    R_OK: [Getter/Setter],\n    SIGABRT: [Getter/Setter],\n    SIGALRM: [Getter/Setter],\n    SIGBUS: [Getter/Setter],\n    SIGCHLD: [Getter/Setter],\n    SIGCONT: [Getter/Setter],\n    SIGFPE: [Getter/Setter],\n    SIGHUP: [Getter/Setter],\n    SIGILL: [Getter/Setter],\n    SIGINT: [Getter/Setter],\n    SIGIO: [Getter/Setter],\n    SIGIOT: [Getter/Setter],\n    SIGKILL: [Getter/Setter],\n    SIGPIPE: [Getter/Setter],\n    SIGPROF: [Getter/Setter],\n    SIGQUIT: [Getter/Setter],\n    SIGSEGV: [Getter/Setter],\n    SIGSTOP: [Getter/Setter],\n    SIGSYS: [Getter/Setter],\n    SIGTERM: [Getter/Setter],\n    SIGTRAP: [Getter/Setter],\n    SIGTSTP: [Getter/Setter],\n    SIGTTIN: [Getter/Setter],\n    SIGTTOU: [Getter/Setter],\n    SIGURG: [Getter/Setter],\n    SIGUSR1: [Getter/Setter],\n    SIGUSR2: [Getter/Setter],\n    SIGVTALRM: [Getter/Setter],\n    SIGWINCH: [Getter/Setter],\n    SIGXCPU: [Getter/Setter],\n    SIGXFSZ: [Getter/Setter],\n    SSL_OP_ALL: [Getter/Setter],\n    SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION: [Getter/Setter],\n    SSL_OP_CIPHER_SERVER_PREFERENCE: [Getter/Setter],\n    SSL_OP_CISCO_ANYCONNECT: [Getter/Setter],\n    SSL_OP_COOKIE_EXCHANGE: [Getter/Setter],\n    SSL_OP_CRYPTOPRO_TLSEXT_BUG: [Getter/Setter],\n    SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS: [Getter/Setter],\n    SSL_OP_EPHEMERAL_RSA: [Getter/Setter],\n    SSL_OP_LEGACY_SERVER_CONNECT: [Getter/Setter],\n    SSL_OP_MICROSOFT_BIG_SSLV3_BUFFER: [Getter/Setter],\n    SSL_OP_MICROSOFT_SESS_ID_BUG: [Getter/Setter],\n    SSL_OP_MSIE_SSLV2_RSA_PADDING: [Getter/Setter],\n    SSL_OP_NETSCAPE_CA_DN_BUG: [Getter/Setter],\n    SSL_OP_NETSCAPE_CHALLENGE_BUG: [Getter/Setter],\n    SSL_OP_NETSCAPE_DEMO_CIPHER_CHANGE_BUG: [Getter/Setter],\n    SSL_OP_NETSCAPE_REUSE_CIPHER_CHANGE_BUG: [Getter/Setter],\n    SSL_OP_NO_COMPRESSION: [Getter/Setter],\n    SSL_OP_NO_QUERY_MTU: [Getter/Setter],\n    SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION: [Getter/Setter],\n    SSL_OP_NO_SSLv2: [Getter/Setter],\n    SSL_OP_NO_SSLv3: [Getter/Setter],\n    SSL_OP_NO_TICKET: [Getter/Setter],\n    SSL_OP_NO_TLSv1: [Getter/Setter],\n    SSL_OP_NO_TLSv1_1: [Getter/Setter],\n    SSL_OP_NO_TLSv1_2: [Getter/Setter],\n    SSL_OP_PKCS1_CHECK_1: [Getter/Setter],\n    SSL_OP_PKCS1_CHECK_2: [Getter/Setter],\n    SSL_OP_SINGLE_DH_USE: [Getter/Setter],\n    SSL_OP_SINGLE_ECDH_USE: [Getter/Setter],\n    SSL_OP_SSLEAY_080_CLIENT_DH_BUG: [Getter/Setter],\n    SSL_OP_SSLREF2_REUSE_CERT_TYPE_BUG: [Getter/Setter],\n    SSL_OP_TLS_BLOCK_PADDING_BUG: [Getter/Setter],\n    SSL_OP_TLS_D5_BUG: [Getter/Setter],\n    SSL_OP_TLS_ROLLBACK_BUG: [Getter/Setter],\n    S_IFBLK: [Getter/Setter],\n    S_IFCHR: [Getter/Setter],\n    S_IFDIR: [Getter/Setter],\n    S_IFIFO: [Getter/Setter],\n    S_IFLNK: [Getter/Setter],\n    S_IFMT: [Getter/Setter],\n    S_IFREG: [Getter/Setter],\n    S_IFSOCK: [Getter/Setter],\n    S_IRGRP: [Getter/Setter],\n    S_IROTH: [Getter/Setter],\n    S_IRUSR: [Getter/Setter],\n    S_IRWXG: [Getter/Setter],\n    S_IRWXO: [Getter/Setter],\n    S_IRWXU: [Getter/Setter],\n    S_IWGRP: [Getter/Setter],\n    S_IWOTH: [Getter/Setter],\n    S_IWUSR: [Getter/Setter],\n    S_IXGRP: [Getter/Setter],\n    S_IXOTH: [Getter/Setter],\n    S_IXUSR: [Getter/Setter],\n    UV_UDP_REUSEADDR: [Getter/Setter],\n    W_OK: [Getter/Setter],\n    X_OK: [Getter/Setter],\n  },\n  crypto: {\n    Cipher: [Getter/Setter],\n    Cipheriv: [Getter/Setter],\n    DEFAULT_ENCODING: [Getter/Setter],\n    Decipher: [Getter/Setter],\n    Decipheriv: [Getter/Setter],\n    DiffieHellman: [Getter/Setter],\n    DiffieHellmanGroup: [Getter/Setter],\n    Hash: [Getter/Setter],\n    Hmac: [Getter/Setter],\n    Sign: [Getter/Setter],\n    Verify: [Getter/Setter],\n    constants: [Getter/Setter],\n    createCipher: [Getter/Setter],\n    createCipheriv: [Getter/Setter],\n    createCredentials: [Getter/Setter],\n    createDecipher: [Getter/Setter],\n    createDecipheriv: [Getter/Setter],\n    createDiffieHellman: [Getter/Setter],\n    createDiffieHellmanGroup: [Getter/Setter],\n    createECDH: [Getter/Setter],\n    createHash: [Getter/Setter],\n    createHmac: [Getter/Setter],\n    createSign: [Getter/Setter],\n    createVerify: [Getter/Setter],\n    default: [Getter/Setter],\n    getCiphers: [Getter/Setter],\n    getCurves: [Getter/Setter],\n    getDiffieHellman: [Getter/Setter],\n    getHashes: [Getter/Setter],\n    getRandomValues: [Getter/Setter],\n    listCiphers: [Getter/Setter],\n    pbkdf2: [Getter/Setter],\n    pbkdf2Sync: [Getter/Setter],\n    privateDecrypt: [Getter/Setter],\n    privateEncrypt: [Getter/Setter],\n    prng: [Getter/Setter],\n    pseudoRandomBytes: [Getter/Setter],\n    publicDecrypt: [Getter/Setter],\n    publicEncrypt: [Getter/Setter],\n    randomBytes: [Getter/Setter],\n    randomFill: [Getter/Setter],\n    randomFillSync: [Getter/Setter],\n    randomUUID: [Getter/Setter],\n    rng: [Getter/Setter],\n    webcrypto: [Getter/Setter],\n  },\n  dgram: [Function: dgram],\n  dns: [Function: dns],\n  domain: {\n    create: [Getter/Setter],\n    createDomain: [Getter/Setter],\n  },\n  events: {\n    EventEmitter: [Getter/Setter],\n    addAbortListener: [Getter/Setter],\n    captureRejectionSymbol: [Getter/Setter],\n    default: [Getter/Setter],\n    getEventListeners: [Getter/Setter],\n    getMaxListeners: [Getter/Setter],\n    init: [Getter/Setter],\n    listenerCount: [Getter/Setter],\n    once: [Getter/Setter],\n    setMaxListeners: [Getter/Setter],\n  },\n  fs: [Function: fs],\n  http: {\n    Agent: [Getter/Setter],\n    ClientRequest: [Getter/Setter],\n    IncomingMessage: [Getter/Setter],\n    METHODS: [Getter/Setter],\n    STATUS_CODES: [Getter/Setter],\n    default: [Getter/Setter],\n    get: [Getter/Setter],\n    globalAgent: [Getter/Setter],\n    request: [Getter/Setter],\n  },\n  https: {\n    Agent: [Getter/Setter],\n    ClientRequest: [Getter/Setter],\n    IncomingMessage: [Getter/Setter],\n    METHODS: [Getter/Setter],\n    OutgoingMessage: [Getter/Setter],\n    STATUS_CODES: [Getter/Setter],\n    Server: [Getter/Setter],\n    ServerResponse: [Getter/Setter],\n    createServer: [Getter/Setter],\n    default: [Getter/Setter],\n    get: [Getter/Setter],\n    globalAgent: [Getter/Setter],\n    maxHeaderSize: [Getter/Setter],\n    request: [Getter/Setter],\n    setMaxIdleHTTPParsers: [Getter/Setter],\n    validateHeaderName: [Getter/Setter],\n    validateHeaderValue: [Getter/Setter],\n  },\n  module: [Function: module2],\n  net: {\n    default: [Getter/Setter],\n    isIP: [Getter/Setter],\n    isIPv4: [Getter/Setter],\n    isIPv6: [Getter/Setter],\n  },\n  os: {\n    EOL: [Getter/Setter],\n    arch: [Getter/Setter],\n    cpus: [Getter/Setter],\n    endianness: [Getter/Setter],\n    freemem: [Getter/Setter],\n    getNetworkInterfaces: [Getter/Setter],\n    homedir: [Getter/Setter],\n    hostname: [Getter/Setter],\n    loadavg: [Getter/Setter],\n    networkInterfaces: [Getter/Setter],\n    platform: [Getter/Setter],\n    release: [Getter/Setter],\n    tmpDir: [Getter/Setter],\n    tmpdir: [Getter/Setter],\n    totalmem: [Getter/Setter],\n    type: [Getter/Setter],\n    uptime: [Getter/Setter],\n  },\n  path: {\n    _makeLong: [Getter/Setter],\n    basename: [Getter/Setter],\n    default: [Getter/Setter],\n    delimiter: [Getter/Setter],\n    dirname: [Getter/Setter],\n    extname: [Getter/Setter],\n    format: [Getter/Setter],\n    isAbsolute: [Getter/Setter],\n    join: [Getter/Setter],\n    normalize: [Getter/Setter],\n    parse: [Getter/Setter],\n    posix: [Getter/Setter],\n    relative: [Getter/Setter],\n    resolve: [Getter/Setter],\n    sep: [Getter/Setter],\n  },\n  perf_hooks: [Function: perf_hooks],\n  process: {\n    addListener: [Getter/Setter],\n    argv: [Getter/Setter],\n    binding: [Getter/Setter],\n    browser: [Getter/Setter],\n    chdir: [Getter/Setter],\n    cwd: [Getter/Setter],\n    emit: [Getter/Setter],\n    env: [Getter/Setter],\n    listeners: [Getter/Setter],\n    nextTick: [Getter/Setter],\n    off: [Getter/Setter],\n    on: [Getter/Setter],\n    once: [Getter/Setter],\n    prependListener: [Getter/Setter],\n    prependOnceListener: [Getter/Setter],\n    removeAllListeners: [Getter/Setter],\n    removeListener: [Getter/Setter],\n    title: [Getter/Setter],\n    umask: [Getter/Setter],\n    version: [Getter/Setter],\n    versions: [Getter/Setter],\n  },\n  punycode: {\n    default: [Getter/Setter],\n  },\n  querystring: {\n    decode: [Getter/Setter],\n    default: [Getter/Setter],\n    encode: [Getter/Setter],\n    escape: [Getter/Setter],\n    parse: [Getter/Setter],\n    stringify: [Getter/Setter],\n    unescape: [Getter/Setter],\n    unescapeBuffer: [Getter/Setter],\n  },\n  readline: [Function: readline],\n  repl: [Function: repl],\n  stream: Function {\n    default: [Stream: Readable],\n    length: [Getter],\n    name: [Getter],\n    prototype: [Getter],\n    ReadableState: [Getter],\n    _fromList: [Getter],\n    from: [Getter],\n    fromWeb: [Getter],\n    toWeb: [Getter],\n    wrap: [Getter],\n    _uint8ArrayToBuffer: [Getter],\n    _isUint8Array: [Getter],\n    isDisturbed: [Getter],\n    isErrored: [Getter],\n    isReadable: [Getter],\n    Readable: [Getter],\n    Writable: [Getter],\n    Duplex: [Getter],\n    Transform: [Getter],\n    PassThrough: [Getter],\n    addAbortSignal: [Getter],\n    finished: [Getter],\n    destroy: [Getter],\n    pipeline: [Getter],\n    compose: [Getter],\n    Stream: [Getter],\n    isDestroyed: [Function: isDestroyed],\n    isWritable: [Function: isWritable],\n    setDefaultHighWaterMark: [Function: setDefaultHighWaterMark],\n    getDefaultHighWaterMark: [Function: getDefaultHighWaterMark],\n    promises: [Getter],\n  },\n  string_decoder: {\n    StringDecoder: [Getter/Setter],\n    default: [Getter/Setter],\n  },\n  sys: {\n    TextDecoder: [Getter/Setter],\n    TextEncoder: [Getter/Setter],\n    _extend: [Getter/Setter],\n    callbackify: [Getter/Setter],\n    callbackifyOnRejected: [Getter/Setter],\n    debuglog: [Getter/Setter],\n    default: [Getter/Setter],\n    deprecate: [Getter/Setter],\n    format: [Getter/Setter],\n    inherits: [Getter/Setter],\n    inspect: [Getter/Setter],\n    isArray: [Getter/Setter],\n    isBoolean: [Getter/Setter],\n    isBuffer: [Getter/Setter],\n    isDate: [Getter/Setter],\n    isError: [Getter/Setter],\n    isFunction: [Getter/Setter],\n    isNull: [Getter/Setter],\n    isNullOrUndefined: [Getter/Setter],\n    isNumber: [Getter/Setter],\n    isObject: [Getter/Setter],\n    isPrimitive: [Getter/Setter],\n    isRegExp: [Getter/Setter],\n    isString: [Getter/Setter],\n    isSymbol: [Getter/Setter],\n    isUndefined: [Getter/Setter],\n    log: [Getter/Setter],\n    promisify: [Getter/Setter],\n    types: [Getter/Setter],\n  },\n  timers: {\n    _unrefActive: [Getter/Setter],\n    clearImmediate: [Getter/Setter],\n    clearInterval: [Getter/Setter],\n    clearTimeout: [Getter/Setter],\n    promises: [Getter/Setter],\n    setImmediate: [Getter/Setter],\n    setInterval: [Getter/Setter],\n    setTimeout: [Getter/Setter],\n  },\n  tls: [Function: tls],\n  tty: {\n    ReadStream: [Getter/Setter],\n    WriteStream: [Getter/Setter],\n    default: [Getter/Setter],\n    isatty: [Getter/Setter],\n  },\n  url: {\n    URL: [Getter/Setter],\n    URLSearchParams: [Getter/Setter],\n    Url: [Getter/Setter],\n    default: [Getter/Setter],\n    format: [Getter/Setter],\n    parse: [Getter/Setter],\n    resolve: [Getter/Setter],\n    resolveObject: [Getter/Setter],\n  },\n  util: {\n    TextDecoder: [Getter/Setter],\n    TextEncoder: [Getter/Setter],\n    _extend: [Getter/Setter],\n    callbackify: [Getter/Setter],\n    callbackifyOnRejected: [Getter/Setter],\n    debuglog: [Getter/Setter],\n    default: [Getter/Setter],\n    deprecate: [Getter/Setter],\n    format: [Getter/Setter],\n    inherits: [Getter/Setter],\n    inspect: [Getter/Setter],\n    isArray: [Getter/Setter],\n    isBoolean: [Getter/Setter],\n    isBuffer: [Getter/Setter],\n    isDate: [Getter/Setter],\n    isError: [Getter/Setter],\n    isFunction: [Getter/Setter],\n    isNull: [Getter/Setter],\n    isNullOrUndefined: [Getter/Setter],\n    isNumber: [Getter/Setter],\n    isObject: [Getter/Setter],\n    isPrimitive: [Getter/Setter],\n    isRegExp: [Getter/Setter],\n    isString: [Getter/Setter],\n    isSymbol: [Getter/Setter],\n    isUndefined: [Getter/Setter],\n    log: [Getter/Setter],\n    promisify: [Getter/Setter],\n    types: [Getter/Setter],\n  },\n  v8: [Function: v8],\n  vm: [Function: vm],\n  zlib: {\n    default: [Getter/Setter],\n  },\n}",

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

  // A path that a package.json "browser" map sets to false is one empty CommonJS
  // module, `(disabled):<path>`, as in esbuild. Bun's own stubs for Node.js
  // builtins (see "browser/NodeFS") are not that module.
  itBundled("browser/BrowserFieldDisabledModuleIsNotTheBuiltinStub", {
    skipOnEsbuild: true, // esbuild has no stubs for Node.js builtins
    files: {
      "/entry.js": /* js */ `
        import fromPackage from "pkg";
        const own = require("fs");
        console.log(typeof fromPackage, Object.keys(fromPackage).length, own === fromPackage);
      `,
      "/node_modules/pkg/package.json": `{ "main": "./index.js", "browser": { "fs": false } }`,
      "/node_modules/pkg/index.js": `module.exports = require("fs");`,
    },
    target: "browser",
    onAfterBundle(api) {
      expect(api.readFile("out.js").match(/^\/\/ \(disabled\):.*$/gm)).toEqual(["// (disabled):fs"]);
    },
    run: {
      stdout: "object 0 false",
    },
  });

  // A bare name that the map disables is the empty module. The same file is
  // also live when another import reaches it by its path. Both are in the
  // bundle, whatever the order of the two imports.
  for (const order of ["DisabledFirst", "LiveFirst"] as const) {
    const requires = [
      `const empty = require("nodeonly");`,
      `const live = require("./node_modules/nodeonly/index.js");`,
    ];
    if (order === "LiveFirst") requires.reverse();
    itBundled(`browser/BrowserFieldDisabledAndLiveFileInOneImporter${order}`, {
      files: {
        "/entry.js": /* js */ `
          ${requires.join("\n")}
          console.log(JSON.stringify([empty, live]), empty === require("nodeonly"));
        `,
        "/package.json": `{ "browser": { "nodeonly": false } }`,
        "/node_modules/nodeonly/index.js": `module.exports = "live";`,
      },
      target: "browser",
      onAfterBundle(api) {
        api.expectFile("out.js").toMatch(/\/\/ \(disabled\):\S*node_modules\/nodeonly\/index\.js\n/);
        api.expectFile("out.js").toMatch(/\/\/ (?!\(disabled\):)\S*node_modules\/nodeonly\/index\.js\n/);
      },
      run: {
        stdout: `[{},"live"] true`,
      },
    });
    // One importer each: the dependency has a map of its own, so the name is live there.
    const importers = [`const empty = require("./app.js");`, `const live = require("dep");`];
    if (order === "LiveFirst") importers.reverse();
    itBundled(`browser/BrowserFieldDisabledAndLiveFileInTwoImporters${order}`, {
      files: {
        "/entry.js": /* js */ `
          ${importers.join("\n")}
          console.log(JSON.stringify([empty, live]));
        `,
        "/app.js": `module.exports = require("nodeonly");`,
        "/package.json": `{ "browser": { "nodeonly": false } }`,
        "/node_modules/dep/package.json": `{ "main": "./index.js", "browser": { "./unused.js": "./index.js" } }`,
        "/node_modules/dep/index.js": `module.exports = require("nodeonly");`,
        "/node_modules/nodeonly/index.js": `module.exports = "live";`,
      },
      target: "browser",
      run: {
        stdout: `[{},"live"]`,
      },
    });
  }

  // One `false` entry is one empty module, with and without a slash after the
  // directory, so the bundle does not depend on which import is seen first.
  itBundled("browser/BrowserFieldDisabledDirectoryTrailingSlash", {
    files: {
      "/entry.js": /* js */ `
        const a = require("./a.js"), b = require("./b.js");
        console.log(a.dir === b.noSlash, b.slash === b.noSlash, a.pkg === b.pkgSlash, JSON.stringify(a.dir));
      `,
      "/a.js": `exports.dir = require("./dir"); exports.pkg = require("pkg/dir");`,
      "/b.js": `exports.slash = require("./dir/"); exports.noSlash = require("./dir"); exports.pkgSlash = require("pkg/dir/");`,
      "/package.json": `{ "browser": { "./dir/index.js": false } }`,
      "/dir/index.js": `throw "fail";`,
      "/node_modules/pkg/package.json": `{ "browser": { "./dir/index.js": false } }`,
      "/node_modules/pkg/dir/index.js": `throw "fail";`,
    },
    target: "browser",
    run: {
      stdout: "true true true {}",
    },
  });

  // An import that does not use the value of the empty module leaves nothing in the bundle.
  itBundled("browser/BrowserFieldDisabledModuleUnusedImportIsDropped", {
    files: {
      "/entry.js": /* js */ `
        import unusedDefault from "./node.js";
        import * as unusedStar from "./node.js";
        import "./node.js";
        console.log("done");
      `,
      "/package.json": `{ "browser": { "./node.js": false } }`,
      "/node.js": `throw "fail";`,
    },
    target: "browser",
    onAfterBundle(api) {
      api.expectFile("out.js").not.toInclude("(disabled):");
    },
    run: {
      stdout: "done",
    },
  });

  // Only an `import`, a `require()` or an `import()` loads the empty module.
  // `require.resolve` of a disabled path stays as written, as on main.
  itBundled("browser/BrowserFieldDisabledRequireResolveStaysAsWritten", {
    files: {
      "/entry.js": `module.exports = () => require.resolve("./node.js");`,
      "/package.json": `{ "browser": { "./node.js": false } }`,
      "/node.js": `throw "fail";`,
    },
    target: "browser",
    onAfterBundle(api) {
      api.expectFile("out.js").toInclude(`.resolve("./node.js")`);
      api.expectFile("out.js").not.toInclude("(disabled):");
    },
  });

  // A script tag that names a disabled path stays as written, as on main.
  itBundled("browser/BrowserFieldDisabledHtmlScriptStaysAsWritten", {
    skipOnEsbuild: true, // esbuild has no HTML entry points
    files: {
      "/index.html": `<!doctype html><html><head><script type="module" src="./node.js"></script><script type="module" src="./ok.js"></script></head></html>`,
      "/ok.js": `console.log("ok");`,
      "/node.js": `throw "fail";`,
      "/package.json": `{ "browser": { "./node.js": false } }`,
    },
    entryPoints: ["/index.html"],
    outdir: "/out",
    target: "browser",
    onAfterBundle(api) {
      const html = api.readFile("/out/index.html");
      expect(html).toContain(`<script type="module" src="./node.js">`);
      for (const name of readdirSync(api.outdir)) {
        if (name.endsWith(".js")) api.expectFile(`/out/${name}`).not.toInclude("fail");
      }
    },
  });

  // A name that only `export *` from a disabled file can give is undefined. In a
  // dependency that is not the user's to fix, so the build says nothing. This
  // is the shape of @smithy/shared-ini-file-loader in a browser build.
  itBundled("browser/BrowserFieldExportStarFromDisabledInNodeModules", {
    skipOnEsbuild: true, // esbuild fails the build
    files: {
      "/entry.js": /* js */ `
        import { fromSso } from "user";
        console.log(JSON.stringify(fromSso()));
      `,
      "/node_modules/user/package.json": `{ "main": "./index.js" }`,
      "/node_modules/user/index.js": /* js */ `
        import { fromFile, home } from "loader";
        export const fromSso = () => [home, typeof fromFile];
      `,
      "/node_modules/loader/package.json": `{ "main": "./index.js", "browser": { "./fromFile.js": false } }`,
      "/node_modules/loader/index.js": /* js */ `
        export * from "./home.js";
        export * from "./fromFile.js";
      `,
      "/node_modules/loader/home.js": `export const home = "home";`,
      "/node_modules/loader/fromFile.js": `throw "fail";`,
    },
    target: "browser",
    bundleWarnings: {},
    run: {
      stdout: `["home","undefined"]`,
    },
  });

  // The default resolver runs from the importer's parse, and from the answer of
  // an onResolve plugin that declines. Both make the same bundle.
  test("browser/BrowserFieldSameOutputWithDecliningOnResolvePlugin", async () => {
    using dir = tempDir("browser-field-declining-plugin", {
      "entry.js": /* js */ `
        import info from "pkg";
        import "fs";
        console.log(JSON.stringify(info));
      `,
      "node_modules/pkg/package.json": `{ "main": "index.js", "browser": { "./node.js": false, "nodeonly": false, "no-file": false } }`,
      "node_modules/pkg/index.js": /* js */ `
        import * as ns from "./node.js";
        import nodeonly from "nodeonly";
        import { named } from "./node.js";
        export default [typeof ns, typeof ns.default, typeof nodeonly, typeof named, require("./node.js") === require("./node.js"), typeof require("no-file")];
      `,
      "node_modules/pkg/node.js": `throw 'fail'`,
      "node_modules/nodeonly/index.js": `throw 'fail'`,
    });
    const declined: string[] = [];
    const build = async (plugins: BunPlugin[]) => {
      const result = await Bun.build({
        entrypoints: [path.join(String(dir), "entry.js")],
        target: "browser",
        plugins,
      });
      expect(result.success).toBe(true);
      return await result.outputs[0].text();
    };
    const plain = await build([]);
    const withPlugin = await build([
      {
        name: "decline",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, args => {
            declined.push(args.path);
            return undefined;
          });
        },
      },
    ]);
    expect(declined).toContain("./node.js");
    expect(declined).toContain("nodeonly");
    expect(withPlugin).toBe(plain);
    expect(plain).toMatch(/^\/\/ \(disabled\):.*node_modules\/pkg\/node\.js$/m);

    await Bun.write(path.join(String(dir), "out.js"), plain);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "out.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe(`["object","object","object","undefined",true,"object"]\n`);
    expect(exitCode).toBe(0);
  });

  // An onLoad plugin never gets a disabled module. Its filter matches the real
  // path, so loading it would put the Node-only file back into the bundle, and
  // a disabled bare name has no file to load at all.
  itBundled("browser/BrowserFieldDisabledModuleSkipsOnLoadPlugin", ({ root }) => {
    const loaded: string[] = [];
    return {
      files: {
        "/entry.js": `console.log(require("pkg").join(" "));`,
        "/node_modules/pkg/package.json": `{ "main": "index.js", "browser": { "./node.js": false, "nodeonly": false } }`,
        "/node_modules/pkg/index.js": `module.exports = [JSON.stringify(require("./node.js")), JSON.stringify(require("nodeonly"))];`,
        "/node_modules/pkg/node.js": `module.exports = "node-only contents";`,
      },
      skipOnEsbuild: true, // esbuild calls the plugin for a disabled path
      target: "browser",
      plugins: [
        {
          name: "read-from-disk",
          setup(builder) {
            builder.onLoad({ filter: /.*/ }, async args => {
              loaded.push(path.relative(root, args.path).replaceAll("\\", "/"));
              return { contents: await Bun.file(args.path).text(), loader: "js" };
            });
          },
        },
      ],
      onAfterBundle() {
        expect(loaded.sort()).toEqual(["entry.js", "node_modules/pkg/index.js"]);
      },
      run: {
        stdout: "{} {}",
      },
    };
  });

  // Only a JavaScript import of a disabled path loads the empty module. A
  // stylesheet that names one builds, and does not bundle it. The "@import"
  // and the "url()" stay in the output as on main. esbuild drops them.
  itBundled("browser/BrowserFieldDisabledCssImportIsNotBundled", {
    skipOnEsbuild: true, // esbuild drops the import
    files: {
      "/entry.js": `import "pkg";`,
      "/node_modules/pkg/package.json": `{ "main": "index.js", "browser": { "./node.css": false, "./img.png": false } }`,
      "/node_modules/pkg/index.js": `import "./style.css";`,
      "/node_modules/pkg/style.css": `@import "./node.css";\n.a { color: red; background: url("./img.png"); }`,
      "/node_modules/pkg/node.css": `.node { color: blue; }`,
      "/node_modules/pkg/img.png": `x`,
    },
    target: "browser",
    outdir: "/out",
    onAfterBundle(api) {
      const css = api.readFile("/out/entry.css");
      expect(css).toContain("color: red");
      expect(css).not.toContain("blue");
      expect(readdirSync(api.outdir).sort()).toEqual(["entry.css", "entry.js"]);
    },
  });

  // `--check` checks the file as written. The empty module that stands in for a
  // disabled file in the bundle has no exports, and is not what the types are of.
  test("browser/BrowserFieldDisabledModuleIsTypeCheckedAsWritten", async () => {
    using dir = tempDir("browser-field-check", {
      "package.json": JSON.stringify({ name: "project", browser: { "./src/node-only.ts": false } }),
      // No DOM or Node.js type definitions to load, which keeps the check fast.
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: "esnext",
          moduleResolution: "bundler",
          lib: ["esnext"],
          types: [],
        },
      }),
      "src/node-only.ts": `export const x: number = 1;`,
      "entry.ts": `import { x } from "./src/node-only";\nexport const y: number = x;\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--check", "--target=browser", "entry.ts", "--outdir", "out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout + stderr).not.toContain("TS2305");
    expect(exitCode).toBe(0);
  });

  // A disabled file that the imports name with its extension is one empty
  // module, also when one import reaches it through a symlinked package
  // directory and another through its real path.
  test("browser/BrowserFieldDisabledModuleBehindSymlink", async () => {
    using dir = tempDir("browser-field-symlink", {
      "entry.js": /* js */ `
        import viaLink from "pkg/node.js";
        import viaPackage from "pkg";
        console.log(viaLink === viaPackage, JSON.stringify(viaLink));
      `,
      "packages/pkg/package.json": `{ "name": "pkg", "main": "./index.js", "browser": { "./node.js": false } }`,
      "packages/pkg/index.js": `module.exports = require("./node.js");`,
      "packages/pkg/node.js": `throw "fail";`,
    });
    mkdirSync(path.join(String(dir), "node_modules"));
    symlinkSync(path.join(String(dir), "packages", "pkg"), path.join(String(dir), "node_modules", "pkg"), "junction");

    const result = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      target: "browser",
    });
    expect(result.success).toBe(true);
    const out = await result.outputs[0].text();
    const disabledModules = out.match(/^\/\/ \(disabled\):.*$/gm) ?? [];
    expect(disabledModules).toHaveLength(1);
    expect(disabledModules[0]).toEndWith("/packages/pkg/node.js");

    await Bun.write(path.join(String(dir), "out.js"), out);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "out.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("true {}\n");
    expect(exitCode).toBe(0);
  });

  // A named import of a disabled module is always undefined. Like esbuild, the
  // build warns when the import is in the project and stays quiet when it is in
  // a dependency, where the user cannot change it.
  itBundled("browser/BrowserFieldDisabledNamedImportWarnsInProject", {
    files: {
      "/entry.js": /* js */ `
        import { named } from "./node.js";
        console.log(typeof named);
      `,
      "/package.json": `{ "browser": { "./node.js": false } }`,
      "/node.js": `throw 'fail'`,
    },
    target: "browser",
    bundleWarnings: {
      "/entry.js": [`Import "named" will always be undefined because the file "(disabled):node.js" has no exports`],
    },
    run: {
      stdout: "undefined",
    },
  });
  itBundled("browser/BrowserFieldDisabledNamedImportIsQuietInNodeModules", {
    files: {
      "/entry.js": /* js */ `
        import kind from "pkg";
        console.log(kind);
      `,
      "/node_modules/pkg/package.json": `{ "main": "./index.js", "browser": { "./node.js": false } }`,
      "/node_modules/pkg/index.js": /* js */ `
        import { named } from "./node.js";
        export default typeof named;
      `,
      "/node_modules/pkg/node.js": `throw 'fail'`,
    },
    target: "browser",
    bundleWarnings: {},
    run: {
      stdout: "undefined",
    },
  });

  // With code splitting, a disabled module that only import() reaches gets its
  // own chunk. The promise resolves to `{ default: {} }`, the same as without
  // splitting. This differs from esbuild on purpose: esbuild resolves to `{}`
  // here, but only with splitting and only when nothing else requires the module.
  itBundled("browser/BrowserFieldDisabledModuleDynamicImportSplitting", {
    skipOnEsbuild: true, // esbuild resolves to `{}` here
    files: {
      "/entry.js": /* js */ `
        import { load } from "pkg";
        const m = await load();
        console.log(typeof m.default, Object.keys(m.default).length, Object.keys(m).join(","));
      `,
      "/node_modules/pkg/package.json": `{ "main": "./index.js", "browser": { "./node.js": false } }`,
      "/node_modules/pkg/index.js": `export const load = () => import("./node.js");`,
      "/node_modules/pkg/node.js": `throw new Error("fail");`,
    },
    target: "browser",
    splitting: true,
    outdir: "/out",
    onAfterBundle(api) {
      const chunks = readdirSync(api.outdir).filter(name => name !== "entry.js");
      expect(chunks.length).toBe(1);
      api.expectFile("/out/entry.js").toInclude(`import("./${chunks[0]}")`);
      api.expectFile(`/out/${chunks[0]}`).toInclude("(disabled):node_modules/pkg/node.js");
    },
    run: {
      file: "/out/entry.js",
      stdout: "object 0 default",
    },
  });
  // A static import that does not use the value of the disabled module adds no
  // shared chunk: the empty module has no side effects.
  itBundled("browser/BrowserFieldDisabledModuleUnusedStaticImportSplitting", {
    files: {
      "/a.js": `import { lib } from "pkg"; console.log("a", lib);`,
      "/b.js": `import { lib } from "pkg"; console.log("b", lib);`,
      "/node_modules/pkg/package.json": `{ "main": "./index.js", "browser": { "./node.js": false, "fs": false } }`,
      "/node_modules/pkg/index.js": /* js */ `
        import "./node.js";
        import { readFileSync } from "fs";
        export const lib = typeof readFileSync;
      `,
      "/node_modules/pkg/node.js": `throw new Error("fail");`,
    },
    entryPoints: ["/a.js", "/b.js"],
    target: "browser",
    splitting: true,
    outdir: "/out",
    onAfterBundle(api) {
      for (const name of readdirSync(api.outdir)) {
        api.expectFile(`/out/${name}`).not.toInclude("(disabled):");
      }
    },
    run: [
      { file: "/out/a.js", stdout: "a undefined" },
      { file: "/out/b.js", stdout: "b undefined" },
    ],
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
  itBundled("browser/EntryPointDisabledByPackageSubpathBrowserField", {
    // The package's map disables a subpath that is named as the entry point.
    skipOnEsbuild: true,
    backend: "cli",
    files: {
      "/node_modules/pkg/package.json": /* json */ `
        { "name": "pkg", "browser": { "./node": false } }
      `,
      "/node_modules/pkg/node.js": /* js */ `
        console.log("node only");
      `,
    },
    entryPointsRaw: ["pkg/node"],
    root: "/",
    target: "browser",
    bundleErrors: {
      "<bun>": ['"pkg/node" is disabled due to "browser" field in package.json (entry point)'],
    },
  });
  itBundled("browser/EntryPointDisabledModuleFieldBuildsMain", {
    // The map disables the "module" file of the package and not its "main" file,
    // so "main" is the entry point. A `require` of the package gets the same file.
    skipOnEsbuild: true,
    backend: "cli",
    files: {
      "/other.js": /* js */ `
        console.log(require("pkg"));
      `,
      "/node_modules/pkg/package.json": /* json */ `
        { "name": "pkg", "main": "./main.js", "module": "./module.js", "browser": { "./module.js": false } }
      `,
      "/node_modules/pkg/main.js": /* js */ `
        module.exports = "main";
      `,
      "/node_modules/pkg/module.js": /* js */ `
        throw "fail";
      `,
    },
    entryPointsRaw: ["pkg", "./other.js"],
    target: "browser",
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/node_modules/pkg/main.js").toContain(`"main"`);
      api.expectFile("/out/node_modules/pkg/main.js").not.toContain("(disabled):");
    },
    run: {
      file: "/out/other.js",
      stdout: "main",
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

  // A "browser" map key with a slash ("pkg/sub", "@scope/pkg") matches the
  // import specifier on Windows too. The keys were stored with the native
  // separator there, so "pkg/sub" became "pkg\sub" and matched nothing.
  itBundled("browser/BrowserFieldDisablesPackageSubpath", {
    files: {
      "/entry.js": /* js */ `
        const sub = require("pkg/sub");
        const scoped = require("@scope/pkg");
        console.log(typeof sub.value, typeof scoped.value);
      `,
      "/package.json": /* json */ `
        { "name": "app", "browser": { "pkg/sub": false, "@scope/pkg": false } }
      `,
      "/node_modules/pkg/package.json": /* json */ `
        { "name": "pkg" }
      `,
      "/node_modules/pkg/sub.js": /* js */ `
        module.exports = { value: "node-only-sub" };
      `,
      "/node_modules/@scope/pkg/package.json": /* json */ `
        { "name": "@scope/pkg" }
      `,
      "/node_modules/@scope/pkg/index.js": /* js */ `
        module.exports = { value: "node-only-scoped" };
      `,
    },
    target: "browser",
    run: {
      stdout: "undefined undefined",
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      assert(!out.includes("node-only-sub"), 'browser:{"pkg/sub":false} should keep pkg/sub.js out of the bundle');
      assert(
        !out.includes("node-only-scoped"),
        'browser:{"@scope/pkg":false} should keep @scope/pkg out of the bundle',
      );
    },
  });
  itBundled("browser/BrowserFieldRemapsPackageSubpath", {
    files: {
      "/entry.js": /* js */ `
        console.log(require("pkg/sub").value);
      `,
      "/package.json": /* json */ `
        { "name": "app", "browser": { "pkg/sub": "./sub-shim.js" } }
      `,
      "/sub-shim.js": /* js */ `
        module.exports = { value: "shim" };
      `,
      "/node_modules/pkg/package.json": /* json */ `
        { "name": "pkg" }
      `,
      "/node_modules/pkg/sub.js": /* js */ `
        module.exports = { value: "node-only-sub" };
      `,
    },
    target: "browser",
    run: {
      stdout: "shim",
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      assert(
        !out.includes("node-only-sub"),
        'browser:{"pkg/sub":"./sub-shim.js"} should keep pkg/sub.js out of the bundle',
      );
    },
  });

  // Which files each import of browser-field-matrix.ts loads. scripts/browser-field-matrix.ts compares the tables
  // with esbuild's. They differ where Bun applies the map to the target of "exports".
  for (const [group, all] of Object.entries(Object.groupBy(layouts(), layout => layout.group))) {
    test(`browser/BrowserFieldMatrix: ${group}`, async () => {
      using dir = tempDir("browser-field-matrix", {});
      expect(await table(String(dir), all!, bun)).toMatchSnapshot();
    });
  }

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
