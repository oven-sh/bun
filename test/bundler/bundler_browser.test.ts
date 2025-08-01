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
        "{\n  assert: {\n    throws: [Getter/Setter],\n    strictEqual: [Getter/Setter],\n    strict: [Getter/Setter],\n    rejects: [Getter/Setter],\n    ok: [Getter/Setter],\n    notStrictEqual: [Getter/Setter],\n    notEqual: [Getter/Setter],\n    notDeepStrictEqual: [Getter/Setter],\n    notDeepEqual: [Getter/Setter],\n    match: [Getter/Setter],\n    ifError: [Getter/Setter],\n    fail: [Getter/Setter],\n    equal: [Getter/Setter],\n    doesNotThrow: [Getter/Setter],\n    doesNotReject: [Getter/Setter],\n    doesNotMatch: [Getter/Setter],\n    default: [Getter/Setter],\n    deepStrictEqual: [Getter/Setter],\n    deepEqual: [Getter/Setter],\n    CallTracker: [Getter/Setter],\n    AssertionError: [Getter/Setter],\n  },\n  buffer: {\n    transcode: [Getter/Setter],\n    resolveObjectURL: [Getter/Setter],\n    kStringMaxLength: [Getter/Setter],\n    kMaxLength: [Getter/Setter],\n    isUtf8: [Getter/Setter],\n    isAscii: [Getter/Setter],\n    default: [Getter/Setter],\n    constants: [Getter/Setter],\n    btoa: [Getter/Setter],\n    atob: [Getter/Setter],\n    INSPECT_MAX_BYTES: [Getter/Setter],\n    File: [Getter/Setter],\n    Buffer: [Getter/Setter],\n    Blob: [Getter/Setter],\n  },\n  child_process: [Function: child_process],\n  cluster: [Function: cluster],\n  console2: {\n    default: [Getter/Setter],\n  },\n  constants: {\n    X_OK: [Getter/Setter],\n    W_OK: [Getter/Setter],\n    UV_UDP_REUSEADDR: [Getter/Setter],\n    S_IXUSR: [Getter/Setter],\n    S_IXOTH: [Getter/Setter],\n    S_IXGRP: [Getter/Setter],\n    S_IWUSR: [Getter/Setter],\n    S_IWOTH: [Getter/Setter],\n    S_IWGRP: [Getter/Setter],\n    S_IRWXU: [Getter/Setter],\n    S_IRWXO: [Getter/Setter],\n    S_IRWXG: [Getter/Setter],\n    S_IRUSR: [Getter/Setter],\n    S_IROTH: [Getter/Setter],\n    S_IRGRP: [Getter/Setter],\n    S_IFSOCK: [Getter/Setter],\n    S_IFREG: [Getter/Setter],\n    S_IFMT: [Getter/Setter],\n    S_IFLNK: [Getter/Setter],\n    S_IFIFO: [Getter/Setter],\n    S_IFDIR: [Getter/Setter],\n    S_IFCHR: [Getter/Setter],\n    S_IFBLK: [Getter/Setter],\n    SSL_OP_TLS_ROLLBACK_BUG: [Getter/Setter],\n    SSL_OP_TLS_D5_BUG: [Getter/Setter],\n    SSL_OP_TLS_BLOCK_PADDING_BUG: [Getter/Setter],\n    SSL_OP_SSLREF2_REUSE_CERT_TYPE_BUG: [Getter/Setter],\n    SSL_OP_SSLEAY_080_CLIENT_DH_BUG: [Getter/Setter],\n    SSL_OP_SINGLE_ECDH_USE: [Getter/Setter],\n    SSL_OP_SINGLE_DH_USE: [Getter/Setter],\n    SSL_OP_PKCS1_CHECK_2: [Getter/Setter],\n    SSL_OP_PKCS1_CHECK_1: [Getter/Setter],\n    SSL_OP_NO_TLSv1_2: [Getter/Setter],\n    SSL_OP_NO_TLSv1_1: [Getter/Setter],\n    SSL_OP_NO_TLSv1: [Getter/Setter],\n    SSL_OP_NO_TICKET: [Getter/Setter],\n    SSL_OP_NO_SSLv3: [Getter/Setter],\n    SSL_OP_NO_SSLv2: [Getter/Setter],\n    SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION: [Getter/Setter],\n    SSL_OP_NO_QUERY_MTU: [Getter/Setter],\n    SSL_OP_NO_COMPRESSION: [Getter/Setter],\n    SSL_OP_NETSCAPE_REUSE_CIPHER_CHANGE_BUG: [Getter/Setter],\n    SSL_OP_NETSCAPE_DEMO_CIPHER_CHANGE_BUG: [Getter/Setter],\n    SSL_OP_NETSCAPE_CHALLENGE_BUG: [Getter/Setter],\n    SSL_OP_NETSCAPE_CA_DN_BUG: [Getter/Setter],\n    SSL_OP_MSIE_SSLV2_RSA_PADDING: [Getter/Setter],\n    SSL_OP_MICROSOFT_SESS_ID_BUG: [Getter/Setter],\n    SSL_OP_MICROSOFT_BIG_SSLV3_BUFFER: [Getter/Setter],\n    SSL_OP_LEGACY_SERVER_CONNECT: [Getter/Setter],\n    SSL_OP_EPHEMERAL_RSA: [Getter/Setter],\n    SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS: [Getter/Setter],\n    SSL_OP_CRYPTOPRO_TLSEXT_BUG: [Getter/Setter],\n    SSL_OP_COOKIE_EXCHANGE: [Getter/Setter],\n    SSL_OP_CISCO_ANYCONNECT: [Getter/Setter],\n    SSL_OP_CIPHER_SERVER_PREFERENCE: [Getter/Setter],\n    SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION: [Getter/Setter],\n    SSL_OP_ALL: [Getter/Setter],\n    SIGXFSZ: [Getter/Setter],\n    SIGXCPU: [Getter/Setter],\n    SIGWINCH: [Getter/Setter],\n    SIGVTALRM: [Getter/Setter],\n    SIGUSR2: [Getter/Setter],\n    SIGUSR1: [Getter/Setter],\n    SIGURG: [Getter/Setter],\n    SIGTTOU: [Getter/Setter],\n    SIGTTIN: [Getter/Setter],\n    SIGTSTP: [Getter/Setter],\n    SIGTRAP: [Getter/Setter],\n    SIGTERM: [Getter/Setter],\n    SIGSYS: [Getter/Setter],\n    SIGSTOP: [Getter/Setter],\n    SIGSEGV: [Getter/Setter],\n    SIGQUIT: [Getter/Setter],\n    SIGPROF: [Getter/Setter],\n    SIGPIPE: [Getter/Setter],\n    SIGKILL: [Getter/Setter],\n    SIGIOT: [Getter/Setter],\n    SIGIO: [Getter/Setter],\n    SIGINT: [Getter/Setter],\n    SIGILL: [Getter/Setter],\n    SIGHUP: [Getter/Setter],\n    SIGFPE: [Getter/Setter],\n    SIGCONT: [Getter/Setter],\n    SIGCHLD: [Getter/Setter],\n    SIGBUS: [Getter/Setter],\n    SIGALRM: [Getter/Setter],\n    SIGABRT: [Getter/Setter],\n    R_OK: [Getter/Setter],\n    RSA_X931_PADDING: [Getter/Setter],\n    RSA_SSLV23_PADDING: [Getter/Setter],\n    RSA_PKCS1_PSS_PADDING: [Getter/Setter],\n    RSA_PKCS1_PADDING: [Getter/Setter],\n    RSA_PKCS1_OAEP_PADDING: [Getter/Setter],\n    RSA_NO_PADDING: [Getter/Setter],\n    POINT_CONVERSION_UNCOMPRESSED: [Getter/Setter],\n    POINT_CONVERSION_HYBRID: [Getter/Setter],\n    POINT_CONVERSION_COMPRESSED: [Getter/Setter],\n    O_WRONLY: [Getter/Setter],\n    O_TRUNC: [Getter/Setter],\n    O_SYNC: [Getter/Setter],\n    O_SYMLINK: [Getter/Setter],\n    O_RDWR: [Getter/Setter],\n    O_RDONLY: [Getter/Setter],\n    O_NONBLOCK: [Getter/Setter],\n    O_NOFOLLOW: [Getter/Setter],\n    O_NOCTTY: [Getter/Setter],\n    O_EXCL: [Getter/Setter],\n    O_DIRECTORY: [Getter/Setter],\n    O_CREAT: [Getter/Setter],\n    O_APPEND: [Getter/Setter],\n    NPN_ENABLED: [Getter/Setter],\n    F_OK: [Getter/Setter],\n    EXDEV: [Getter/Setter],\n    EWOULDBLOCK: [Getter/Setter],\n    ETXTBSY: [Getter/Setter],\n    ETIMEDOUT: [Getter/Setter],\n    ETIME: [Getter/Setter],\n    ESTALE: [Getter/Setter],\n    ESRCH: [Getter/Setter],\n    ESPIPE: [Getter/Setter],\n    EROFS: [Getter/Setter],\n    ERANGE: [Getter/Setter],\n    EPROTOTYPE: [Getter/Setter],\n    EPROTONOSUPPORT: [Getter/Setter],\n    EPROTO: [Getter/Setter],\n    EPIPE: [Getter/Setter],\n    EPERM: [Getter/Setter],\n    EOVERFLOW: [Getter/Setter],\n    EOPNOTSUPP: [Getter/Setter],\n    ENXIO: [Getter/Setter],\n    ENOTTY: [Getter/Setter],\n    ENOTSUP: [Getter/Setter],\n    ENOTSOCK: [Getter/Setter],\n    ENOTEMPTY: [Getter/Setter],\n    ENOTDIR: [Getter/Setter],\n    ENOTCONN: [Getter/Setter],\n    ENOSYS: [Getter/Setter],\n    ENOSTR: [Getter/Setter],\n    ENOSR: [Getter/Setter],\n    ENOSPC: [Getter/Setter],\n    ENOPROTOOPT: [Getter/Setter],\n    ENOMSG: [Getter/Setter],\n    ENOMEM: [Getter/Setter],\n    ENOLINK: [Getter/Setter],\n    ENOLCK: [Getter/Setter],\n    ENOEXEC: [Getter/Setter],\n    ENOENT: [Getter/Setter],\n    ENODEV: [Getter/Setter],\n    ENODATA: [Getter/Setter],\n    ENOBUFS: [Getter/Setter],\n    ENGINE_METHOD_STORE: [Getter/Setter],\n    ENGINE_METHOD_RAND: [Getter/Setter],\n    ENGINE_METHOD_PKEY_METHS: [Getter/Setter],\n    ENGINE_METHOD_PKEY_ASN1_METHS: [Getter/Setter],\n    ENGINE_METHOD_NONE: [Getter/Setter],\n    ENGINE_METHOD_ECDSA: [Getter/Setter],\n    ENGINE_METHOD_ECDH: [Getter/Setter],\n    ENGINE_METHOD_DSA: [Getter/Setter],\n    ENGINE_METHOD_DIGESTS: [Getter/Setter],\n    ENGINE_METHOD_DH: [Getter/Setter],\n    ENGINE_METHOD_CIPHERS: [Getter/Setter],\n    ENGINE_METHOD_ALL: [Getter/Setter],\n    ENFILE: [Getter/Setter],\n    ENETUNREACH: [Getter/Setter],\n    ENETRESET: [Getter/Setter],\n    ENETDOWN: [Getter/Setter],\n    ENAMETOOLONG: [Getter/Setter],\n    EMULTIHOP: [Getter/Setter],\n    EMSGSIZE: [Getter/Setter],\n    EMLINK: [Getter/Setter],\n    EMFILE: [Getter/Setter],\n    ELOOP: [Getter/Setter],\n    EISDIR: [Getter/Setter],\n    EISCONN: [Getter/Setter],\n    EIO: [Getter/Setter],\n    EINVAL: [Getter/Setter],\n    EINTR: [Getter/Setter],\n    EINPROGRESS: [Getter/Setter],\n    EILSEQ: [Getter/Setter],\n    EIDRM: [Getter/Setter],\n    EHOSTUNREACH: [Getter/Setter],\n    EFBIG: [Getter/Setter],\n    EFAULT: [Getter/Setter],\n    EEXIST: [Getter/Setter],\n    EDQUOT: [Getter/Setter],\n    EDOM: [Getter/Setter],\n    EDESTADDRREQ: [Getter/Setter],\n    EDEADLK: [Getter/Setter],\n    ECONNRESET: [Getter/Setter],\n    ECONNREFUSED: [Getter/Setter],\n    ECONNABORTED: [Getter/Setter],\n    ECHILD: [Getter/Setter],\n    ECANCELED: [Getter/Setter],\n    EBUSY: [Getter/Setter],\n    EBADMSG: [Getter/Setter],\n    EBADF: [Getter/Setter],\n    EALREADY: [Getter/Setter],\n    EAGAIN: [Getter/Setter],\n    EAFNOSUPPORT: [Getter/Setter],\n    EADDRNOTAVAIL: [Getter/Setter],\n    EADDRINUSE: [Getter/Setter],\n    EACCES: [Getter/Setter],\n    E2BIG: [Getter/Setter],\n    DH_UNABLE_TO_CHECK_GENERATOR: [Getter/Setter],\n    DH_NOT_SUITABLE_GENERATOR: [Getter/Setter],\n    DH_CHECK_P_NOT_SAFE_PRIME: [Getter/Setter],\n    DH_CHECK_P_NOT_PRIME: [Getter/Setter],\n  },\n  crypto: {\n    webcrypto: [Getter/Setter],\n    rng: [Getter/Setter],\n    randomUUID: [Getter/Setter],\n    randomFillSync: [Getter/Setter],\n    randomFill: [Getter/Setter],\n    randomBytes: [Getter/Setter],\n    publicEncrypt: [Getter/Setter],\n    publicDecrypt: [Getter/Setter],\n    pseudoRandomBytes: [Getter/Setter],\n    prng: [Getter/Setter],\n    privateEncrypt: [Getter/Setter],\n    privateDecrypt: [Getter/Setter],\n    pbkdf2Sync: [Getter/Setter],\n    pbkdf2: [Getter/Setter],\n    listCiphers: [Getter/Setter],\n    getRandomValues: [Getter/Setter],\n    getHashes: [Getter/Setter],\n    getDiffieHellman: [Getter/Setter],\n    getCurves: [Getter/Setter],\n    getCiphers: [Getter/Setter],\n    default: [Getter/Setter],\n    createVerify: [Getter/Setter],\n    createSign: [Getter/Setter],\n    createHmac: [Getter/Setter],\n    createHash: [Getter/Setter],\n    createECDH: [Getter/Setter],\n    createDiffieHellmanGroup: [Getter/Setter],\n    createDiffieHellman: [Getter/Setter],\n    createDecipheriv: [Getter/Setter],\n    createDecipher: [Getter/Setter],\n    createCredentials: [Getter/Setter],\n    createCipheriv: [Getter/Setter],\n    createCipher: [Getter/Setter],\n    constants: [Getter/Setter],\n    Verify: [Getter/Setter],\n    Sign: [Getter/Setter],\n    Hmac: [Getter/Setter],\n    Hash: [Getter/Setter],\n    DiffieHellmanGroup: [Getter/Setter],\n    DiffieHellman: [Getter/Setter],\n    Decipheriv: [Getter/Setter],\n    Decipher: [Getter/Setter],\n    DEFAULT_ENCODING: [Getter/Setter],\n    Cipheriv: [Getter/Setter],\n    Cipher: [Getter/Setter],\n  },\n  dgram: [Function: dgram],\n  dns: [Function: dns],\n  domain: {\n    createDomain: [Getter/Setter],\n    create: [Getter/Setter],\n  },\n  events: {\n    setMaxListeners: [Getter/Setter],\n    once: [Getter/Setter],\n    listenerCount: [Getter/Setter],\n    init: [Getter/Setter],\n    getMaxListeners: [Getter/Setter],\n    getEventListeners: [Getter/Setter],\n    default: [Getter/Setter],\n    captureRejectionSymbol: [Getter/Setter],\n    addAbortListener: [Getter/Setter],\n    EventEmitter: [Getter/Setter],\n  },\n  fs: [Function: fs],\n  http: {\n    request: [Getter/Setter],\n    globalAgent: [Getter/Setter],\n    get: [Getter/Setter],\n    default: [Getter/Setter],\n    STATUS_CODES: [Getter/Setter],\n    METHODS: [Getter/Setter],\n    IncomingMessage: [Getter/Setter],\n    ClientRequest: [Getter/Setter],\n    Agent: [Getter/Setter],\n  },\n  https: {\n    validateHeaderValue: [Getter/Setter],\n    validateHeaderName: [Getter/Setter],\n    setMaxIdleHTTPParsers: [Getter/Setter],\n    request: [Getter/Setter],\n    maxHeaderSize: [Getter/Setter],\n    globalAgent: [Getter/Setter],\n    get: [Getter/Setter],\n    default: [Getter/Setter],\n    createServer: [Getter/Setter],\n    ServerResponse: [Getter/Setter],\n    Server: [Getter/Setter],\n    STATUS_CODES: [Getter/Setter],\n    OutgoingMessage: [Getter/Setter],\n    METHODS: [Getter/Setter],\n    IncomingMessage: [Getter/Setter],\n    ClientRequest: [Getter/Setter],\n    Agent: [Getter/Setter],\n  },\n  module: [Function: module2],\n  net: {\n    isIPv6: [Getter/Setter],\n    isIPv4: [Getter/Setter],\n    isIP: [Getter/Setter],\n    default: [Getter/Setter],\n  },\n  os: {\n    uptime: [Getter/Setter],\n    type: [Getter/Setter],\n    totalmem: [Getter/Setter],\n    tmpdir: [Getter/Setter],\n    tmpDir: [Getter/Setter],\n    release: [Getter/Setter],\n    platform: [Getter/Setter],\n    networkInterfaces: [Getter/Setter],\n    loadavg: [Getter/Setter],\n    hostname: [Getter/Setter],\n    homedir: [Getter/Setter],\n    getNetworkInterfaces: [Getter/Setter],\n    freemem: [Getter/Setter],\n    endianness: [Getter/Setter],\n    cpus: [Getter/Setter],\n    arch: [Getter/Setter],\n    EOL: [Getter/Setter],\n  },\n  path: {\n    sep: [Getter/Setter],\n    resolve: [Getter/Setter],\n    relative: [Getter/Setter],\n    posix: [Getter/Setter],\n    parse: [Getter/Setter],\n    normalize: [Getter/Setter],\n    join: [Getter/Setter],\n    isAbsolute: [Getter/Setter],\n    format: [Getter/Setter],\n    extname: [Getter/Setter],\n    dirname: [Getter/Setter],\n    delimiter: [Getter/Setter],\n    default: [Getter/Setter],\n    basename: [Getter/Setter],\n    _makeLong: [Getter/Setter],\n  },\n  perf_hooks: [Function: perf_hooks],\n  process: {\n    versions: [Getter/Setter],\n    version: [Getter/Setter],\n    umask: [Getter/Setter],\n    title: [Getter/Setter],\n    removeListener: [Getter/Setter],\n    removeAllListeners: [Getter/Setter],\n    prependOnceListener: [Getter/Setter],\n    prependListener: [Getter/Setter],\n    once: [Getter/Setter],\n    on: [Getter/Setter],\n    off: [Getter/Setter],\n    nextTick: [Getter/Setter],\n    listeners: [Getter/Setter],\n    env: [Getter/Setter],\n    emit: [Getter/Setter],\n    cwd: [Getter/Setter],\n    chdir: [Getter/Setter],\n    browser: [Getter/Setter],\n    binding: [Getter/Setter],\n    argv: [Getter/Setter],\n    addListener: [Getter/Setter],\n  },\n  punycode: {\n    default: [Getter/Setter],\n  },\n  querystring: {\n    unescapeBuffer: [Getter/Setter],\n    unescape: [Getter/Setter],\n    stringify: [Getter/Setter],\n    parse: [Getter/Setter],\n    escape: [Getter/Setter],\n    encode: [Getter/Setter],\n    default: [Getter/Setter],\n    decode: [Getter/Setter],\n  },\n  readline: [Function: readline],\n  repl: [Function: repl],\n  stream: Function {\n    default: [Stream: Readable],\n    length: [Getter],\n    name: [Getter],\n    prototype: [Getter],\n    ReadableState: [Getter],\n    _fromList: [Getter],\n    from: [Getter],\n    fromWeb: [Getter],\n    toWeb: [Getter],\n    wrap: [Getter],\n    _uint8ArrayToBuffer: [Getter],\n    _isUint8Array: [Getter],\n    isDisturbed: [Getter],\n    isErrored: [Getter],\n    isReadable: [Getter],\n    Readable: [Getter],\n    Writable: [Getter],\n    Duplex: [Getter],\n    Transform: [Getter],\n    PassThrough: [Getter],\n    addAbortSignal: [Getter],\n    finished: [Getter],\n    destroy: [Getter],\n    pipeline: [Getter],\n    compose: [Getter],\n    Stream: [Getter],\n    isDestroyed: [Function: isDestroyed],\n    isWritable: [Function: isWritable],\n    setDefaultHighWaterMark: [Function: setDefaultHighWaterMark],\n    getDefaultHighWaterMark: [Function: getDefaultHighWaterMark],\n    promises: [Getter],\n  },\n  string_decoder: {\n    default: [Getter/Setter],\n    StringDecoder: [Getter/Setter],\n  },\n  sys: {\n    types: [Getter/Setter],\n    promisify: [Getter/Setter],\n    log: [Getter/Setter],\n    isUndefined: [Getter/Setter],\n    isSymbol: [Getter/Setter],\n    isString: [Getter/Setter],\n    isRegExp: [Getter/Setter],\n    isPrimitive: [Getter/Setter],\n    isObject: [Getter/Setter],\n    isNumber: [Getter/Setter],\n    isNullOrUndefined: [Getter/Setter],\n    isNull: [Getter/Setter],\n    isFunction: [Getter/Setter],\n    isError: [Getter/Setter],\n    isDate: [Getter/Setter],\n    isBuffer: [Getter/Setter],\n    isBoolean: [Getter/Setter],\n    isArray: [Getter/Setter],\n    inspect: [Getter/Setter],\n    inherits: [Getter/Setter],\n    format: [Getter/Setter],\n    deprecate: [Getter/Setter],\n    default: [Getter/Setter],\n    debuglog: [Getter/Setter],\n    callbackifyOnRejected: [Getter/Setter],\n    callbackify: [Getter/Setter],\n    _extend: [Getter/Setter],\n    TextEncoder: [Getter/Setter],\n    TextDecoder: [Getter/Setter],\n  },\n  timers: {\n    setTimeout: [Getter/Setter],\n    setInterval: [Getter/Setter],\n    setImmediate: [Getter/Setter],\n    promises: [Getter/Setter],\n    clearTimeout: [Getter/Setter],\n    clearInterval: [Getter/Setter],\n    clearImmediate: [Getter/Setter],\n    _unrefActive: [Getter/Setter],\n  },\n  tls: [Function: tls],\n  tty: {\n    isatty: [Getter/Setter],\n    default: [Getter/Setter],\n    WriteStream: [Getter/Setter],\n    ReadStream: [Getter/Setter],\n  },\n  url: {\n    resolveObject: [Getter/Setter],\n    resolve: [Getter/Setter],\n    parse: [Getter/Setter],\n    format: [Getter/Setter],\n    default: [Getter/Setter],\n    Url: [Getter/Setter],\n    URLSearchParams: [Getter/Setter],\n    URL: [Getter/Setter],\n  },\n  util: {\n    types: [Getter/Setter],\n    promisify: [Getter/Setter],\n    log: [Getter/Setter],\n    isUndefined: [Getter/Setter],\n    isSymbol: [Getter/Setter],\n    isString: [Getter/Setter],\n    isRegExp: [Getter/Setter],\n    isPrimitive: [Getter/Setter],\n    isObject: [Getter/Setter],\n    isNumber: [Getter/Setter],\n    isNullOrUndefined: [Getter/Setter],\n    isNull: [Getter/Setter],\n    isFunction: [Getter/Setter],\n    isError: [Getter/Setter],\n    isDate: [Getter/Setter],\n    isBuffer: [Getter/Setter],\n    isBoolean: [Getter/Setter],\n    isArray: [Getter/Setter],\n    inspect: [Getter/Setter],\n    inherits: [Getter/Setter],\n    format: [Getter/Setter],\n    deprecate: [Getter/Setter],\n    default: [Getter/Setter],\n    debuglog: [Getter/Setter],\n    callbackifyOnRejected: [Getter/Setter],\n    callbackify: [Getter/Setter],\n    _extend: [Getter/Setter],\n    TextEncoder: [Getter/Setter],\n    TextDecoder: [Getter/Setter],\n  },\n  v8: [Function: v8],\n  vm: [Function: vm],\n  zlib: {\n    default: [Getter/Setter],\n  },\n}",

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
