// One producer for each row that src/jsc/bindings/ErrorCode.ts makes with plain(): Node throws the error of such a row with the
// toString() that every error inherits, not with the `name [code]: message` one of its NodeError classes.
// Prints one line for what each producer throws. Node prints the same lines as Bun:
//   node --no-addons --unhandled-rejections=throw --experimental-vm-modules --no-warnings error-code-toString-fixture.cjs
const { MAX_STRING_LENGTH } = require("node:buffer").constants;
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const tls = require("node:tls");
const vm = require("node:vm");
const { MessageChannel, MessagePort, moveMessagePortToContext } = require("node:worker_threads");
const zlib = require("node:zlib");

const rsaPublicKey = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC/TDKqGEOiA0OoQtFCnjUdb7um
fUBc0Lnaa4zvrBGba5rQRvaaK+bFxueGvbzk9A1UW3Mzg83rjIBIEYYWmarV85gT
nSL8z9obv4oH+8IASUlNmk8fQvi5+VMoQl1MLeXdZUNlsFVBkDDK4StQv4yiTNNN
FW2080DhNEfMoLV2GwIDAQAB
-----END PUBLIC KEY-----`;
// No JSON Web Key stands for a DSA key.
const dsaPublicKey = `-----BEGIN PUBLIC KEY-----
MIIBtzCCASsGByqGSM44BAEwggEeAoGBALIddVHyRri9SMQhKQBE9DuFptqGJyI4
gOz53ED01zSzwupRqMhTvSfwZ7nM6HjVolsDiv05PVcvM4xeAUADJMu4Fk/Xjzri
8toKEHgsBG/hdKZ1ybbPKJl1iO+AXlFuv5DkG5mBMylnOX1ZxH1Ix0cYepbymVnX
wFjHnrLL6Pn3AhUA6TW9TnTUZRp47HyXn5BBmxsRd0cCgYBlD741HqboGrBb4Dhd
ppOztcSsDr/E7PDMpUlO+KZ63+0CTa3a5uVPzdn5pN1WvVSvs9v6Wd6MwC+5/F6/
b7lt3D4h0GF3xboL5fPOVQh5b1+Y3At69CVvJH+ALHF4pdR+NNv3phIMFeycJhVH
NjL1VEENuM7znim1CdFuj9Z0mAOBhQACgYEAlroTdVPA6Ipakclz2ZIgBuV4fObN
V/xWnBFGjYYhEe0J19XzfMKgVyArXCiDdFXhE9HCbv4QdEi5lUxgIr9SRskvv1r6
wFY6bT6Mfsi7/0oc+boCnkqkhZyFB1rxfXvY8Ol5OHjBw9XC6WhRFtn3lvyxL8/2
qCZyzXAdX3ejER0=
-----END PUBLIC KEY-----`;

// The producer of ERR_CRYPTO_INVALID_KEYPAIR calls a deprecated method.
process.noDeprecation = true;

const producers = {
  ERR_CLOSED_MESSAGE_PORT: async () => {
    const { port1 } = new MessageChannel();
    const closed = new Promise(resolve => port1.once("close", resolve));
    port1.close();
    await closed;
    moveMessagePortToContext(port1, vm.createContext());
  },
  ERR_CONSTRUCT_CALL_INVALID: () => new MessagePort(),
  ERR_CRYPTO_INVALID_AUTH_TAG: () =>
    crypto.createDecipheriv("aes-256-gcm", Buffer.alloc(32), Buffer.alloc(12)).setAuthTag(Buffer.alloc(1)),
  ERR_CRYPTO_INVALID_CURVE: () => crypto.createECDH("nope"),
  ERR_CRYPTO_INVALID_DIGEST: () => crypto.createHmac("nope", "key"),
  ERR_CRYPTO_INVALID_IV: () => crypto.createCipheriv("aes-256-cbc", Buffer.alloc(32), Buffer.alloc(3)),
  ERR_CRYPTO_INVALID_JWK: () => crypto.createPublicKey({ key: { kty: "RSA" }, format: "jwk" }),
  ERR_CRYPTO_INVALID_KEYLEN: () => crypto.createCipheriv("aes-256-gcm", Buffer.alloc(3), Buffer.alloc(12)),
  ERR_CRYPTO_INVALID_KEYPAIR: () => {
    const ours = crypto.createECDH("prime256v1");
    const theirs = crypto.createECDH("prime256v1");
    ours.generateKeys();
    theirs.generateKeys();
    // The public key of another private key.
    ours.setPublicKey(theirs.getPublicKey());
    ours.computeSecret(theirs.getPublicKey());
  },
  ERR_CRYPTO_INVALID_KEYTYPE: () => crypto.createECDH("prime256v1").setPrivateKey(Buffer.alloc(32)),
  ERR_CRYPTO_INVALID_SCRYPT_PARAMS: () => crypto.scryptSync("password", "salt", 8, { N: 3 }),
  ERR_CRYPTO_JWK_UNSUPPORTED_CURVE: () =>
    crypto.generateKeyPairSync("ec", { namedCurve: "secp224r1" }).publicKey.export({ format: "jwk" }),
  ERR_CRYPTO_JWK_UNSUPPORTED_KEY_TYPE: () => crypto.createPublicKey(dsaPublicKey).export({ format: "jwk" }),
  ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH: () => crypto.timingSafeEqual(Buffer.alloc(1), Buffer.alloc(2)),
  ERR_CRYPTO_UNKNOWN_CIPHER: () => crypto.createCipheriv("nope", Buffer.alloc(32), Buffer.alloc(16)),
  ERR_CRYPTO_UNKNOWN_DH_GROUP: () => crypto.getDiffieHellman("nope"),
  // An Ed25519 key signs in one call only.
  ERR_CRYPTO_UNSUPPORTED_OPERATION: () =>
    crypto.createSign("sha256").update("data").sign(crypto.generateKeyPairSync("ed25519").privateKey),
  ERR_DLOPEN_DISABLED: () => process.dlopen({ exports: {} }, "/nonexistent/addon.node"),
  // This process runs with --no-addons. A child without the flag gets to the load.
  ERR_DLOPEN_FAILED: () => lineOfChild(`process.dlopen({ exports: {} }, "/nonexistent/addon.node")`),
  ERR_INVALID_OBJECT_DEFINE_PROPERTY: () => Object.defineProperty(process.env, "ACCESSOR", { get() {} }),
  ERR_LOAD_SQLITE_EXTENSION: () =>
    new DatabaseSync(":memory:", { allowExtension: true }).loadExtension("/nonexistent/extension"),
  // An encrypted key in DER. For one in PEM, OpenSSL 3 reports an error of its own.
  ERR_MISSING_PASSPHRASE: () => {
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    const key = privateKey.export({ type: "pkcs8", format: "der", cipher: "aes-256-cbc", passphrase: "secret" });
    crypto.createPrivateKey({ key, format: "der", type: "pkcs8" });
  },
  ERR_OSSL_EVP_INVALID_DIGEST: () => crypto.publicEncrypt({ key: rsaPublicKey, oaepHash: "nope" }, Buffer.from("data")),
  ERR_SCRIPT_EXECUTION_TIMEOUT: () => new vm.Script("while (true) {}").runInThisContext({ timeout: 5 }),
  ERR_SQLITE_ERROR: () => new DatabaseSync(":memory:").exec("nope"),
  ERR_SSL_NO_CIPHER_MATCH: () => tls.createServer({ ciphers: "nope" }),
  // Bun refuses the length and reads no page of the 2 GiB. Node copies its 512 MiB first.
  ERR_STRING_TOO_LONG: () => Buffer.allocUnsafe(MAX_STRING_LENGTH + 1).toString(),
  ERR_TLS_INVALID_PROTOCOL_METHOD: () => tls.createSecureContext({ secureProtocol: "nope" }),
  // With --unhandled-rejections=throw and no unhandledRejection listener, the rejection becomes an uncaught exception.
  ERR_UNHANDLED_REJECTION: () =>
    new Promise((_, reject) => {
      process.once("uncaughtException", reject);
      Promise.reject(1);
    }),
  ERR_VM_MODULE_CACHED_DATA_REJECTED: () => new vm.SourceTextModule("1", { cachedData: Buffer.alloc(16) }),
  // This parameter is a flag.
  ERR_ZLIB_INITIALIZATION_FAILED: () =>
    zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING]: 42 } }),
};

// The rows named on the command line are left out: the test drops ERR_STRING_TOO_LONG on a small host.
for (const row of process.argv.slice(2)) delete producers[row];

function lineOf(err) {
  const string = String(err);
  return JSON.stringify({
    code: err.code,
    name: err.name,
    string: string === `${err.name}: ${err.message}` ? "name: message" : string,
    inheritsToString: err.toString === Error.prototype.toString,
    hasOwnToString: Object.hasOwn(err, "toString"),
  });
}

// The line for what `source` throws in a child of this runtime that runs with no flags.
function lineOfChild(source) {
  const script = `${lineOf}\ntry { ${source} } catch (err) { process.stdout.write(lineOf(err)); }`;
  const { stdout, stderr, status } = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
  if (status !== 0 || stdout === "") throw new Error(`the child exited with ${status}: ${stderr}`);
  return stdout;
}

(async () => {
  for (const [row, produce] of Object.entries(producers)) {
    let line;
    try {
      line = await produce();
    } catch (err) {
      line = lineOf(err);
    }
    console.log(typeof line === "string" ? line : `${row}: nothing thrown`);
  }
})();
