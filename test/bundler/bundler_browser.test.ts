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
        "{\n  assert: {\n    AssertionError: [Getter],\n    CallTracker: [Getter],\n    deepEqual: [Getter],\n    deepStrictEqual: [Getter],\n    default: [Getter],\n    doesNotMatch: [Getter],\n    doesNotReject: [Getter],\n    doesNotThrow: [Getter],\n    equal: [Getter],\n    fail: [Getter],\n    ifError: [Getter],\n    match: [Getter],\n    notDeepEqual: [Getter],\n    notDeepStrictEqual: [Getter],\n    notEqual: [Getter],\n    notStrictEqual: [Getter],\n    ok: [Getter],\n    rejects: [Getter],\n    strict: [Getter],\n    strictEqual: [Getter],\n    throws: [Getter],\n  },\n  buffer: {\n    Blob: [Getter],\n    Buffer: [Getter],\n    File: [Getter],\n    INSPECT_MAX_BYTES: [Getter],\n    atob: [Getter],\n    btoa: [Getter],\n    constants: [Getter],\n    default: [Getter],\n    isAscii: [Getter],\n    isUtf8: [Getter],\n    kMaxLength: [Getter],\n    kStringMaxLength: [Getter],\n    resolveObjectURL: [Getter],\n    transcode: [Getter],\n  },\n  child_process: [Function: child_process],\n  cluster: [Function: cluster],\n  console2: {\n    default: [Getter],\n  },\n  constants: {\n    DH_CHECK_P_NOT_PRIME: [Getter],\n    DH_CHECK_P_NOT_SAFE_PRIME: [Getter],\n    DH_NOT_SUITABLE_GENERATOR: [Getter],\n    DH_UNABLE_TO_CHECK_GENERATOR: [Getter],\n    E2BIG: [Getter],\n    EACCES: [Getter],\n    EADDRINUSE: [Getter],\n    EADDRNOTAVAIL: [Getter],\n    EAFNOSUPPORT: [Getter],\n    EAGAIN: [Getter],\n    EALREADY: [Getter],\n    EBADF: [Getter],\n    EBADMSG: [Getter],\n    EBUSY: [Getter],\n    ECANCELED: [Getter],\n    ECHILD: [Getter],\n    ECONNABORTED: [Getter],\n    ECONNREFUSED: [Getter],\n    ECONNRESET: [Getter],\n    EDEADLK: [Getter],\n    EDESTADDRREQ: [Getter],\n    EDOM: [Getter],\n    EDQUOT: [Getter],\n    EEXIST: [Getter],\n    EFAULT: [Getter],\n    EFBIG: [Getter],\n    EHOSTUNREACH: [Getter],\n    EIDRM: [Getter],\n    EILSEQ: [Getter],\n    EINPROGRESS: [Getter],\n    EINTR: [Getter],\n    EINVAL: [Getter],\n    EIO: [Getter],\n    EISCONN: [Getter],\n    EISDIR: [Getter],\n    ELOOP: [Getter],\n    EMFILE: [Getter],\n    EMLINK: [Getter],\n    EMSGSIZE: [Getter],\n    EMULTIHOP: [Getter],\n    ENAMETOOLONG: [Getter],\n    ENETDOWN: [Getter],\n    ENETRESET: [Getter],\n    ENETUNREACH: [Getter],\n    ENFILE: [Getter],\n    ENGINE_METHOD_ALL: [Getter],\n    ENGINE_METHOD_CIPHERS: [Getter],\n    ENGINE_METHOD_DH: [Getter],\n    ENGINE_METHOD_DIGESTS: [Getter],\n    ENGINE_METHOD_DSA: [Getter],\n    ENGINE_METHOD_ECDH: [Getter],\n    ENGINE_METHOD_ECDSA: [Getter],\n    ENGINE_METHOD_NONE: [Getter],\n    ENGINE_METHOD_PKEY_ASN1_METHS: [Getter],\n    ENGINE_METHOD_PKEY_METHS: [Getter],\n    ENGINE_METHOD_RAND: [Getter],\n    ENGINE_METHOD_STORE: [Getter],\n    ENOBUFS: [Getter],\n    ENODATA: [Getter],\n    ENODEV: [Getter],\n    ENOENT: [Getter],\n    ENOEXEC: [Getter],\n    ENOLCK: [Getter],\n    ENOLINK: [Getter],\n    ENOMEM: [Getter],\n    ENOMSG: [Getter],\n    ENOPROTOOPT: [Getter],\n    ENOSPC: [Getter],\n    ENOSR: [Getter],\n    ENOSTR: [Getter],\n    ENOSYS: [Getter],\n    ENOTCONN: [Getter],\n    ENOTDIR: [Getter],\n    ENOTEMPTY: [Getter],\n    ENOTSOCK: [Getter],\n    ENOTSUP: [Getter],\n    ENOTTY: [Getter],\n    ENXIO: [Getter],\n    EOPNOTSUPP: [Getter],\n    EOVERFLOW: [Getter],\n    EPERM: [Getter],\n    EPIPE: [Getter],\n    EPROTO: [Getter],\n    EPROTONOSUPPORT: [Getter],\n    EPROTOTYPE: [Getter],\n    ERANGE: [Getter],\n    EROFS: [Getter],\n    ESPIPE: [Getter],\n    ESRCH: [Getter],\n    ESTALE: [Getter],\n    ETIME: [Getter],\n    ETIMEDOUT: [Getter],\n    ETXTBSY: [Getter],\n    EWOULDBLOCK: [Getter],\n    EXDEV: [Getter],\n    F_OK: [Getter],\n    NPN_ENABLED: [Getter],\n    O_APPEND: [Getter],\n    O_CREAT: [Getter],\n    O_DIRECTORY: [Getter],\n    O_EXCL: [Getter],\n    O_NOCTTY: [Getter],\n    O_NOFOLLOW: [Getter],\n    O_NONBLOCK: [Getter],\n    O_RDONLY: [Getter],\n    O_RDWR: [Getter],\n    O_SYMLINK: [Getter],\n    O_SYNC: [Getter],\n    O_TRUNC: [Getter],\n    O_WRONLY: [Getter],\n    POINT_CONVERSION_COMPRESSED: [Getter],\n    POINT_CONVERSION_HYBRID: [Getter],\n    POINT_CONVERSION_UNCOMPRESSED: [Getter],\n    RSA_NO_PADDING: [Getter],\n    RSA_PKCS1_OAEP_PADDING: [Getter],\n    RSA_PKCS1_PADDING: [Getter],\n    RSA_PKCS1_PSS_PADDING: [Getter],\n    RSA_SSLV23_PADDING: [Getter],\n    RSA_X931_PADDING: [Getter],\n    R_OK: [Getter],\n    SIGABRT: [Getter],\n    SIGALRM: [Getter],\n    SIGBUS: [Getter],\n    SIGCHLD: [Getter],\n    SIGCONT: [Getter],\n    SIGFPE: [Getter],\n    SIGHUP: [Getter],\n    SIGILL: [Getter],\n    SIGINT: [Getter],\n    SIGIO: [Getter],\n    SIGIOT: [Getter],\n    SIGKILL: [Getter],\n    SIGPIPE: [Getter],\n    SIGPROF: [Getter],\n    SIGQUIT: [Getter],\n    SIGSEGV: [Getter],\n    SIGSTOP: [Getter],\n    SIGSYS: [Getter],\n    SIGTERM: [Getter],\n    SIGTRAP: [Getter],\n    SIGTSTP: [Getter],\n    SIGTTIN: [Getter],\n    SIGTTOU: [Getter],\n    SIGURG: [Getter],\n    SIGUSR1: [Getter],\n    SIGUSR2: [Getter],\n    SIGVTALRM: [Getter],\n    SIGWINCH: [Getter],\n    SIGXCPU: [Getter],\n    SIGXFSZ: [Getter],\n    SSL_OP_ALL: [Getter],\n    SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION: [Getter],\n    SSL_OP_CIPHER_SERVER_PREFERENCE: [Getter],\n    SSL_OP_CISCO_ANYCONNECT: [Getter],\n    SSL_OP_COOKIE_EXCHANGE: [Getter],\n    SSL_OP_CRYPTOPRO_TLSEXT_BUG: [Getter],\n    SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS: [Getter],\n    SSL_OP_EPHEMERAL_RSA: [Getter],\n    SSL_OP_LEGACY_SERVER_CONNECT: [Getter],\n    SSL_OP_MICROSOFT_BIG_SSLV3_BUFFER: [Getter],\n    SSL_OP_MICROSOFT_SESS_ID_BUG: [Getter],\n    SSL_OP_MSIE_SSLV2_RSA_PADDING: [Getter],\n    SSL_OP_NETSCAPE_CA_DN_BUG: [Getter],\n    SSL_OP_NETSCAPE_CHALLENGE_BUG: [Getter],\n    SSL_OP_NETSCAPE_DEMO_CIPHER_CHANGE_BUG: [Getter],\n    SSL_OP_NETSCAPE_REUSE_CIPHER_CHANGE_BUG: [Getter],\n    SSL_OP_NO_COMPRESSION: [Getter],\n    SSL_OP_NO_QUERY_MTU: [Getter],\n    SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION: [Getter],\n    SSL_OP_NO_SSLv2: [Getter],\n    SSL_OP_NO_SSLv3: [Getter],\n    SSL_OP_NO_TICKET: [Getter],\n    SSL_OP_NO_TLSv1: [Getter],\n    SSL_OP_NO_TLSv1_1: [Getter],\n    SSL_OP_NO_TLSv1_2: [Getter],\n    SSL_OP_PKCS1_CHECK_1: [Getter],\n    SSL_OP_PKCS1_CHECK_2: [Getter],\n    SSL_OP_SINGLE_DH_USE: [Getter],\n    SSL_OP_SINGLE_ECDH_USE: [Getter],\n    SSL_OP_SSLEAY_080_CLIENT_DH_BUG: [Getter],\n    SSL_OP_SSLREF2_REUSE_CERT_TYPE_BUG: [Getter],\n    SSL_OP_TLS_BLOCK_PADDING_BUG: [Getter],\n    SSL_OP_TLS_D5_BUG: [Getter],\n    SSL_OP_TLS_ROLLBACK_BUG: [Getter],\n    S_IFBLK: [Getter],\n    S_IFCHR: [Getter],\n    S_IFDIR: [Getter],\n    S_IFIFO: [Getter],\n    S_IFLNK: [Getter],\n    S_IFMT: [Getter],\n    S_IFREG: [Getter],\n    S_IFSOCK: [Getter],\n    S_IRGRP: [Getter],\n    S_IROTH: [Getter],\n    S_IRUSR: [Getter],\n    S_IRWXG: [Getter],\n    S_IRWXO: [Getter],\n    S_IRWXU: [Getter],\n    S_IWGRP: [Getter],\n    S_IWOTH: [Getter],\n    S_IWUSR: [Getter],\n    S_IXGRP: [Getter],\n    S_IXOTH: [Getter],\n    S_IXUSR: [Getter],\n    UV_UDP_REUSEADDR: [Getter],\n    W_OK: [Getter],\n    X_OK: [Getter],\n  },\n  crypto: {\n    Cipher: [Getter],\n    Cipheriv: [Getter],\n    DEFAULT_ENCODING: [Getter],\n    Decipher: [Getter],\n    Decipheriv: [Getter],\n    DiffieHellman: [Getter],\n    DiffieHellmanGroup: [Getter],\n    Hash: [Getter],\n    Hmac: [Getter],\n    Sign: [Getter],\n    Verify: [Getter],\n    constants: [Getter],\n    createCipher: [Getter],\n    createCipheriv: [Getter],\n    createCredentials: [Getter],\n    createDecipher: [Getter],\n    createDecipheriv: [Getter],\n    createDiffieHellman: [Getter],\n    createDiffieHellmanGroup: [Getter],\n    createECDH: [Getter],\n    createHash: [Getter],\n    createHmac: [Getter],\n    createSign: [Getter],\n    createVerify: [Getter],\n    default: [Getter],\n    getCiphers: [Getter],\n    getCurves: [Getter],\n    getDiffieHellman: [Getter],\n    getHashes: [Getter],\n    getRandomValues: [Getter],\n    listCiphers: [Getter],\n    pbkdf2: [Getter],\n    pbkdf2Sync: [Getter],\n    privateDecrypt: [Getter],\n    privateEncrypt: [Getter],\n    prng: [Getter],\n    pseudoRandomBytes: [Getter],\n    publicDecrypt: [Getter],\n    publicEncrypt: [Getter],\n    randomBytes: [Getter],\n    randomFill: [Getter],\n    randomFillSync: [Getter],\n    randomUUID: [Getter],\n    rng: [Getter],\n    webcrypto: [Getter],\n  },\n  dgram: [Function: dgram],\n  dns: [Function: dns],\n  domain: {\n    create: [Getter],\n    createDomain: [Getter],\n  },\n  events: {\n    EventEmitter: [Getter],\n    addAbortListener: [Getter],\n    captureRejectionSymbol: [Getter],\n    default: [Getter],\n    getEventListeners: [Getter],\n    getMaxListeners: [Getter],\n    init: [Getter],\n    listenerCount: [Getter],\n    once: [Getter],\n    setMaxListeners: [Getter],\n  },\n  fs: [Function: fs],\n  http: {\n    Agent: [Getter],\n    ClientRequest: [Getter],\n    IncomingMessage: [Getter],\n    METHODS: [Getter],\n    STATUS_CODES: [Getter],\n    default: [Getter],\n    get: [Getter],\n    globalAgent: [Getter],\n    request: [Getter],\n  },\n  https: {\n    Agent: [Getter],\n    ClientRequest: [Getter],\n    IncomingMessage: [Getter],\n    METHODS: [Getter],\n    OutgoingMessage: [Getter],\n    STATUS_CODES: [Getter],\n    Server: [Getter],\n    ServerResponse: [Getter],\n    createServer: [Getter],\n    default: [Getter],\n    get: [Getter],\n    globalAgent: [Getter],\n    maxHeaderSize: [Getter],\n    request: [Getter],\n    setMaxIdleHTTPParsers: [Getter],\n    validateHeaderName: [Getter],\n    validateHeaderValue: [Getter],\n  },\n  module: [Function: module2],\n  net: {\n    default: [Getter],\n    isIP: [Getter],\n    isIPv4: [Getter],\n    isIPv6: [Getter],\n  },\n  os: {\n    EOL: [Getter],\n    arch: [Getter],\n    cpus: [Getter],\n    endianness: [Getter],\n    freemem: [Getter],\n    getNetworkInterfaces: [Getter],\n    homedir: [Getter],\n    hostname: [Getter],\n    loadavg: [Getter],\n    networkInterfaces: [Getter],\n    platform: [Getter],\n    release: [Getter],\n    tmpDir: [Getter],\n    tmpdir: [Getter],\n    totalmem: [Getter],\n    type: [Getter],\n    uptime: [Getter],\n  },\n  path: {\n    _makeLong: [Getter],\n    basename: [Getter],\n    default: [Getter],\n    delimiter: [Getter],\n    dirname: [Getter],\n    extname: [Getter],\n    format: [Getter],\n    isAbsolute: [Getter],\n    join: [Getter],\n    normalize: [Getter],\n    parse: [Getter],\n    posix: [Getter],\n    relative: [Getter],\n    resolve: [Getter],\n    sep: [Getter],\n  },\n  perf_hooks: [Function: perf_hooks],\n  process: {\n    addListener: [Getter],\n    argv: [Getter],\n    binding: [Getter],\n    browser: [Getter],\n    chdir: [Getter],\n    cwd: [Getter],\n    emit: [Getter],\n    env: [Getter],\n    listeners: [Getter],\n    nextTick: [Getter],\n    off: [Getter],\n    on: [Getter],\n    once: [Getter],\n    prependListener: [Getter],\n    prependOnceListener: [Getter],\n    removeAllListeners: [Getter],\n    removeListener: [Getter],\n    title: [Getter],\n    umask: [Getter],\n    version: [Getter],\n    versions: [Getter],\n  },\n  punycode: {\n    default: [Getter],\n  },\n  querystring: {\n    decode: [Getter],\n    default: [Getter],\n    encode: [Getter],\n    escape: [Getter],\n    parse: [Getter],\n    stringify: [Getter],\n    unescape: [Getter],\n    unescapeBuffer: [Getter],\n  },\n  readline: [Function: readline],\n  repl: [Function: repl],\n  stream: Function {\n    default: [Stream: Readable],\n    length: [Getter],\n    name: [Getter],\n    prototype: [Getter],\n    ReadableState: [Getter],\n    _fromList: [Getter],\n    from: [Getter],\n    fromWeb: [Getter],\n    toWeb: [Getter],\n    wrap: [Getter],\n    _uint8ArrayToBuffer: [Getter],\n    _isUint8Array: [Getter],\n    isDisturbed: [Getter],\n    isErrored: [Getter],\n    isReadable: [Getter],\n    Readable: [Getter],\n    Writable: [Getter],\n    Duplex: [Getter],\n    Transform: [Getter],\n    PassThrough: [Getter],\n    addAbortSignal: [Getter],\n    finished: [Getter],\n    destroy: [Getter],\n    pipeline: [Getter],\n    compose: [Getter],\n    Stream: [Getter],\n    isDestroyed: [Function: isDestroyed],\n    isWritable: [Function: isWritable],\n    setDefaultHighWaterMark: [Function: setDefaultHighWaterMark],\n    getDefaultHighWaterMark: [Function: getDefaultHighWaterMark],\n    promises: [Getter],\n  },\n  string_decoder: {\n    StringDecoder: [Getter],\n    default: [Getter],\n  },\n  sys: {\n    TextDecoder: [Getter],\n    TextEncoder: [Getter],\n    _extend: [Getter],\n    callbackify: [Getter],\n    callbackifyOnRejected: [Getter],\n    debuglog: [Getter],\n    default: [Getter],\n    deprecate: [Getter],\n    format: [Getter],\n    inherits: [Getter],\n    inspect: [Getter],\n    isArray: [Getter],\n    isBoolean: [Getter],\n    isBuffer: [Getter],\n    isDate: [Getter],\n    isError: [Getter],\n    isFunction: [Getter],\n    isNull: [Getter],\n    isNullOrUndefined: [Getter],\n    isNumber: [Getter],\n    isObject: [Getter],\n    isPrimitive: [Getter],\n    isRegExp: [Getter],\n    isString: [Getter],\n    isSymbol: [Getter],\n    isUndefined: [Getter],\n    log: [Getter],\n    promisify: [Getter],\n    types: [Getter],\n  },\n  timers: {\n    _unrefActive: [Getter],\n    clearImmediate: [Getter],\n    clearInterval: [Getter],\n    clearTimeout: [Getter],\n    promises: [Getter],\n    setImmediate: [Getter],\n    setInterval: [Getter],\n    setTimeout: [Getter],\n  },\n  tls: [Function: tls],\n  tty: {\n    ReadStream: [Getter],\n    WriteStream: [Getter],\n    default: [Getter],\n    isatty: [Getter],\n  },\n  url: {\n    URL: [Getter],\n    URLSearchParams: [Getter],\n    Url: [Getter],\n    default: [Getter],\n    format: [Getter],\n    parse: [Getter],\n    resolve: [Getter],\n    resolveObject: [Getter],\n  },\n  util: {\n    TextDecoder: [Getter],\n    TextEncoder: [Getter],\n    _extend: [Getter],\n    callbackify: [Getter],\n    callbackifyOnRejected: [Getter],\n    debuglog: [Getter],\n    default: [Getter],\n    deprecate: [Getter],\n    format: [Getter],\n    inherits: [Getter],\n    inspect: [Getter],\n    isArray: [Getter],\n    isBoolean: [Getter],\n    isBuffer: [Getter],\n    isDate: [Getter],\n    isError: [Getter],\n    isFunction: [Getter],\n    isNull: [Getter],\n    isNullOrUndefined: [Getter],\n    isNumber: [Getter],\n    isObject: [Getter],\n    isPrimitive: [Getter],\n    isRegExp: [Getter],\n    isString: [Getter],\n    isSymbol: [Getter],\n    isUndefined: [Getter],\n    log: [Getter],\n    promisify: [Getter],\n    types: [Getter],\n  },\n  v8: [Function: v8],\n  vm: [Function: vm],\n  zlib: {\n    default: [Getter],\n  },\n}",

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
        `Cannot use Node.js builtin "fs" as an entry point`,
        `Cannot use Node.js builtin "node:fs" as an entry point`,
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
