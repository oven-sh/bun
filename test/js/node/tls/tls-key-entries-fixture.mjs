// `key: [{ pem, passphrase }]` at every entry point that makes a SecureContext. report() calls each entry point with
// each row and tells what it threw. node-tls-create-secure-context-args.test.ts runs it in bun and in node, and
// expects the same answers from both.
import { readFileSync } from "node:fs";
import http2 from "node:http2";
import https from "node:https";
import { join } from "node:path";
import { Duplex } from "node:stream";
import tls from "node:tls";

const fixture = name => readFileSync(join(import.meta.dirname, "fixtures", name));
export const plain = fixture("rsa_private.pem");
// The passphrase is "password".
export const encrypted = fixture("rsa_private_encrypted.pem");
export const cert = fixture("rsa_cert.crt");
// Another key and its certificate. The passphrase is "sample".
const pfx = readFileSync(join(import.meta.dirname, "..", "test", "fixtures", "keys", "agent1.pfx"));

export const arrayBufferOf = pem => pem.buffer.slice(pem.byteOffset, pem.byteOffset + pem.byteLength);

function sharedArrayBufferOf(pem) {
  const shared = new SharedArrayBuffer(pem.length);
  new Uint8Array(shared).set(pem);
  return shared;
}

// Node gives the same answer for a row at every entry point.
export const rows = {
  "a passphrase that is a number": () => ({ key: [{ pem: encrypted, passphrase: 5 }] }),
  "a passphrase that is zero": () => ({ key: [{ pem: encrypted, passphrase: 0 }] }),
  "a passphrase that is a Buffer": () => ({ key: [{ pem: encrypted, passphrase: Buffer.from("password") }] }),
  "a passphrase that is a Uint8Array": () => ({
    key: [{ pem: encrypted, passphrase: new Uint8Array(Buffer.from("password")) }],
  }),
  "a passphrase that is a String object": () => ({ key: [{ pem: encrypted, passphrase: new String("password") }] }),
  "a pem that is a number": () => ({ key: [{ pem: 5, passphrase: "x" }] }),
  "a pem that is a number, before its passphrase that is one": () => ({ key: [{ pem: 5, passphrase: 5 }] }),
  "a pem that is a number, after a valid entry": () => ({ key: [{ pem: plain }, { pem: 5 }] }),
  "a pem that is null": () => ({ key: [{ pem: null }] }),
  "a pem that is undefined": () => ({ key: [{ pem: undefined, passphrase: "x" }] }),
  "a pem that is a Blob, with a passphrase": () => ({
    key: [{ pem: new Blob([encrypted]), passphrase: "password" }],
  }),
  "a pem that is a SharedArrayBuffer, with a passphrase": () => ({
    key: [{ pem: sharedArrayBufferOf(encrypted), passphrase: "password" }],
  }),
  "the pem of the first entry, before the passphrase of the second": () => ({
    key: [{ pem: 5 }, { pem: encrypted, passphrase: 5 }],
  }),
  "the passphrase of the first entry, before the pem of the second": () => ({
    key: [{ pem: encrypted, passphrase: 5 }, { pem: 5 }],
  }),
  "the wrong passphrase of the first entry, before the pem of the second": () => ({
    key: [{ pem: encrypted, passphrase: "wrong" }, { pem: 5 }],
  }),
  "the wrong passphrase of the context for the first entry, before the pem of the second": () => ({
    key: [{ pem: encrypted }, { pem: 5 }],
    passphrase: "wrong",
  }),
  "a null passphrase, which does not become the passphrase of the context": () => ({
    key: [{ pem: encrypted, passphrase: null }],
    passphrase: "password",
  }),
  "an empty passphrase, which does not become the passphrase of the context": () => ({
    key: [{ pem: encrypted, passphrase: "" }],
    passphrase: "password",
  }),
  "its own passphrase": () => ({ key: [{ pem: encrypted, passphrase: "password" }] }),
  "its own passphrase, next to a wrong one for the context": () => ({
    key: [{ pem: encrypted, passphrase: "password" }],
    passphrase: "wrong",
  }),
  "the passphrase of the context": () => ({ key: [{ pem: encrypted }], passphrase: "password" }),
  "a null passphrase for a key that is not encrypted": () => ({
    key: [{ pem: plain, passphrase: null }],
    passphrase: "password",
  }),
  "a pem that is a string": () => ({ key: [{ pem: encrypted.toString(), passphrase: "password" }] }),
  "a pem that is a DataView": () => ({
    key: [{ pem: new DataView(arrayBufferOf(encrypted)), passphrase: "password" }],
  }),
};

// Bun makes one list of the keys of `pfx` and of `key`. It takes the only key of that list out of its array, and
// Playwright's `clientCertificates` gives an empty pfx list.
export const rowsNextToAPfx = {
  "its own passphrase, next to an empty pfx list": () => ({
    pfx: [],
    key: [{ pem: encrypted, passphrase: "password" }],
    cert: [cert],
  }),
  "a pem that is a number, next to an empty pfx list": () => ({ pfx: [], key: [{ pem: 5 }], cert: [cert] }),
  "a passphrase that is a number, next to an empty pfx list": () => ({
    pfx: [],
    key: [{ pem: encrypted, passphrase: 5 }],
    cert: [cert],
  }),
  "no passphrase, next to a pfx with a key of its own": () => ({
    pfx: [{ buf: pfx, passphrase: "sample" }],
    key: [{ pem: plain }],
    cert: [cert],
  }),
};

// Rows for which Bun does not give Node's answer yet.
export const rowsBunAnswersInAnotherWay = {
  "a PEM after an entry": () => ({ key: [{ pem: encrypted, passphrase: "password" }, plain] }),
  "an entry with a pem that is a number, after a PEM": () => ({ key: [plain, { pem: 5 }] }),
  "an encrypted key with no passphrase, before the pem of the second": () => ({
    key: [{ pem: encrypted }, { pem: 5 }],
  }),
  "a certificate that does not load, before a passphrase that is a Buffer": () => ({
    cert: "not a certificate",
    key: [{ pem: encrypted, passphrase: Buffer.from("password") }],
  }),
};

const transport = () =>
  new Duplex({
    read() {},
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

export const entryPoints = {
  "tls.createSecureContext()": options => void tls.createSecureContext(options),
  "tls.connect()": options => void tls.connect({ socket: transport(), ...options }).destroy(),
  "new tls.TLSSocket()": options => void new tls.TLSSocket(undefined, options).destroy(),
  "server.addContext()": options => void tls.createServer({}).addContext("a.example", options),
  "tls.createServer()": options => void tls.createServer(options),
  "server.setSecureContext()": options => void tls.createServer({}).setSecureContext(options),
  "https.createServer()": options => void https.createServer(options),
  "http2.createSecureServer()": options => void http2.createSecureServer(options),
};

/** "ok", or what `create` threw. An error of OpenSSL is its code alone: BoringSSL words the message in another way. */
export function answer(create, options) {
  try {
    create({ cert, ...options });
    return "ok";
  } catch (error) {
    const { name, code, message } = error;
    return typeof code === "string" && code.startsWith("ERR_OSSL_") ? { code } : { name, code, message };
  }
}

/** `{ [table]: { [entry point]: { [row]: answer } } }` */
export function report() {
  const tables = { rows, rowsNextToAPfx, rowsBunAnswersInAnotherWay };
  const out = {};
  for (const [table, rowsOfTable] of Object.entries(tables)) {
    const answers = (out[table] = {});
    for (const [entryPoint, create] of Object.entries(entryPoints)) {
      const answersOfEntryPoint = (answers[entryPoint] = {});
      for (const [row, options] of Object.entries(rowsOfTable)) answersOfEntryPoint[row] = answer(create, options());
    }
  }
  return out;
}
