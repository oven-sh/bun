// What each operation that takes keyUsages does with the values below, and the user code that the conversion runs.
// Bun and Node.js both run this file. web-crypto.test.ts holds what they answer.
import { createSecretKey, generateKeyPairSync } from "node:crypto";

const { subtle } = crypto;
const hmac = { name: "HMAC", hash: "SHA-256" };
const aes = { name: "AES-GCM", length: 256 };
const ecdsa = { name: "ECDSA", namedCurve: "P-256" };

// Every operation that takes keyUsages, with a usage that it takes.
export const usages = {
  generateKey: "sign",
  deriveKey: "encrypt",
  importKey: "sign",
  unwrapKey: "sign",
  getPublicKey: "verify",
  encapsulateKey: "encrypt",
  decapsulateKey: "encrypt",
  "SecretKeyObject.toCryptoKey": "sign",
  "PrivateKeyObject.toCryptoKey": "sign",
  "PublicKeyObject.toCryptoKey": "verify",
};

// The call of each operation with `keyUsages`, as a promise of the key.
async function operations() {
  const raw = new Uint8Array(32);
  const wrappingKey = await subtle.generateKey({ name: "AES-KW", length: 256 }, true, ["wrapKey", "unwrapKey"]);
  const imported = await subtle.importKey("raw", raw, hmac, true, ["sign"]);
  const wrapped = await subtle.wrapKey("raw", imported, wrappingKey, "AES-KW");
  const ecdh = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
  const signing = await subtle.generateKey(ecdsa, true, ["sign", "verify"]);
  const kem = await subtle.generateKey("ML-KEM-768", true, ["encapsulateKey", "decapsulateKey"]);
  const { ciphertext } = await subtle.encapsulateKey("ML-KEM-768", kem.publicKey, aes, true, ["encrypt"]);
  const secret = createSecretKey(raw);
  const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    generateKey: keyUsages => subtle.generateKey(hmac, true, keyUsages),
    deriveKey: keyUsages =>
      subtle.deriveKey({ name: "ECDH", public: ecdh.publicKey }, ecdh.privateKey, aes, true, keyUsages),
    importKey: keyUsages => subtle.importKey("raw", raw, hmac, true, keyUsages),
    unwrapKey: keyUsages => subtle.unwrapKey("raw", wrapped, wrappingKey, "AES-KW", hmac, true, keyUsages),
    getPublicKey: keyUsages => subtle.getPublicKey(signing.privateKey, keyUsages),
    encapsulateKey: keyUsages =>
      subtle.encapsulateKey("ML-KEM-768", kem.publicKey, aes, true, keyUsages).then(result => result.sharedKey),
    decapsulateKey: keyUsages => subtle.decapsulateKey("ML-KEM-768", kem.privateKey, ciphertext, aes, true, keyUsages),
    "SecretKeyObject.toCryptoKey": async keyUsages => secret.toCryptoKey(hmac, true, keyUsages),
    "PrivateKeyObject.toCryptoKey": async keyUsages => pair.privateKey.toCryptoKey(ecdsa, true, keyUsages),
    "PublicKeyObject.toCryptoKey": async keyUsages => pair.publicKey.toCryptoKey(ecdsa, true, keyUsages),
  };
}

// The keyUsages of each row, for a usage that the operation takes.
const values = {
  // One entry that is the usage after ToString.
  "an object with toString": usage => [{ toString: () => usage }],
  "an array": usage => [[usage]],
  "a String object": usage => [new String(usage)],
  "an object with Symbol.toPrimitive": usage => [{ [Symbol.toPrimitive]: () => usage }],
  "a Set": usage => new Set([{ toString: () => usage }]),
  "a generator": usage =>
    (function* () {
      yield { toString: () => usage };
    })(),
  "an Array subclass": usage => class extends Array {}.of({ toString: () => usage }),
  "an array with its own Symbol.iterator": usage =>
    Object.assign(["bogus"], {
      *[Symbol.iterator]() {
        yield usage;
      },
    }),

  // An entry that is not a usage.
  "a string that is not a usage": usage => [usage, "bogus"],
  "a usage in capitals": usage => [usage.toUpperCase()],
  "a number": () => [1],
  "null": () => [null],
  "a hole": usage => [, usage],
  "an object with only valueOf": usage => [{ valueOf: () => usage }],
  "a symbol": usage => [Symbol(usage)],
  "a toString that throws": () => [
    {
      toString() {
        throw new RangeError("toString");
      },
    },
  ],

  // Not a sequence.
  "a string": usage => usage,
  "undefined": () => undefined,
  "an object that is not iterable": usage => ({ 0: usage, length: 1 }),
  "an array whose Symbol.iterator is not a function": usage => Object.assign([usage], { [Symbol.iterator]: 1 }),
  "an array without a prototype": usage => Object.setPrototypeOf([usage], null),
  "an iterator that is not an object": () => ({ [Symbol.iterator]: () => 1 }),
  "an iterator without next": () => ({ [Symbol.iterator]: () => ({}) }),
  "a step that is not an object": () => ({ [Symbol.iterator]: () => ({ next: () => 1 }) }),
};

// The usages of the key, or the name, code and message of the error.
const settle = promise =>
  promise.then(
    key => key.usages,
    ({ name, code, message }) => ({ name, code, message }),
  );

// { operation: { row: answer } }
async function answers() {
  const all = {};
  for (const [name, call] of Object.entries(await operations())) {
    all[name] = {};
    for (const [row, keyUsages] of Object.entries(values)) {
      all[name][row] = await settle(call(keyUsages(usages[name])));
    }
  }
  return all;
}

// { scenario: { log of the user code that ran, answer } }
async function orders() {
  const log = [];
  const logged = usage => ({
    toString() {
      log.push(`toString ${usage}`);
      return usage;
    },
  });
  // An iterable of `entries` that logs each step of the protocol.
  const iterable = entries => ({
    get [Symbol.iterator]() {
      log.push("get Symbol.iterator");
      return () => ({
        next() {
          log.push("next");
          return entries.length ? { value: entries.shift(), done: false } : { value: undefined, done: true };
        },
        return() {
          log.push("return");
          return {};
        },
      });
    },
  });
  const run = async call => {
    log.length = 0;
    const answer = await settle(Promise.resolve().then(call));
    return { log: [...log], answer };
  };
  // An entry for "sign" whose conversion gives `add` an entry for "verify".
  const adding = add => ({
    toString() {
      log.push("toString sign");
      add(logged("verify"));
      return "sign";
    },
  });
  const array = [adding(entry => array.push(entry))];
  const set = new Set([adding(entry => set.add(entry))]);
  return {
    "an iterable": await run(() => subtle.generateKey(hmac, true, iterable([logged("sign"), logged("verify")]))),
    "an iterable with an entry that is not a usage": await run(() =>
      subtle.generateKey(hmac, true, iterable([logged("bogus"), logged("verify")])),
    ),
    "an array with an entry that is not a usage": await run(() =>
      subtle.generateKey(hmac, true, [logged("bogus"), logged("verify")]),
    ),
    "an array that an entry appends to": await run(() => subtle.generateKey(hmac, true, array)),
    "a Set that an entry adds to": await run(() => subtle.generateKey(hmac, true, set)),
    "SubtleCrypto with an algorithm and a usage that are not known": await run(() =>
      subtle.generateKey({ name: "bogus" }, true, [logged("bogus")]),
    ),
    "KeyObject.toCryptoKey with an algorithm and a usage that are not known": await run(() =>
      createSecretKey(new Uint8Array(32)).toCryptoKey({ name: "bogus" }, true, [logged("bogus")]),
    ),
  };
}

export const report = async () => ({ answers: await answers(), orders: await orders() });

if (import.meta.main) console.log(JSON.stringify(await report()));
