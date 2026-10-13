// Runs every operation that the calling thread computes for a small input, on the largest input it
// takes, and prints how many threads of the pool exist afterwards. Linux only: it reads /proc.
import { readdirSync, readFileSync } from "node:fs";

const poolThreads = () =>
  readdirSync("/proc/self/task").filter(id => readFileSync(`/proc/self/task/${id}/comm`, "utf8").startsWith("Bun Pool"))
    .length;

const data = (size: number) => new Uint8Array(size).fill(7);
const raw = new Uint8Array(32).fill(1);
const iv12 = new Uint8Array(12);
const iv16 = new Uint8Array(16);
const key = (name: string | object, usages: KeyUsage[], format = "raw", bytes = raw) =>
  crypto.subtle.importKey(format as "raw", bytes, name as string, false, usages);

const hmac = await key({ name: "HMAC", hash: "SHA-256" }, ["sign", "verify"]);
const longHmac = await key({ name: "HMAC", hash: "SHA-256" }, ["sign"], "raw", data(200));
const gcm = { name: "AES-GCM", iv: iv12 };
const cbc = { name: "AES-CBC", iv: iv16 };
const ctr = { name: "AES-CTR", counter: iv16, length: 64 };
const cfb = { name: "AES-CFB-8", iv: iv16 };
const chacha = { name: "ChaCha20-Poly1305", iv: iv12 };
const gcmKey = await key("AES-GCM", ["encrypt", "decrypt"]);
const cbcKey = await key("AES-CBC", ["encrypt", "decrypt"]);
const ctrKey = await key("AES-CTR", ["encrypt", "decrypt"]);
const cfbKey = await key("AES-CFB-8", ["encrypt", "decrypt"]);
const chachaKey = await key("ChaCha20-Poly1305", ["encrypt", "decrypt"], "raw-secret");

const { subtle } = crypto;
// [the operation on an input of `size` bytes, the largest size the calling thread computes]
const operations: [(size: number) => Promise<unknown>, number][] = [
  [size => subtle.digest("SHA-1", data(size)), 1024],
  [size => subtle.digest("SHA-224", data(size)), 1024],
  [size => subtle.digest("SHA-256", data(size)), 1024],
  [size => subtle.digest("SHA-384", data(size)), 256],
  [size => subtle.digest("SHA-512", data(size)), 256],
  [size => subtle.digest("SHA3-256", data(size)), 64],
  [size => subtle.digest("SHA3-384", data(size)), 64],
  [size => subtle.digest("SHA3-512", data(size)), 64],
  // HMAC hashes three 64-byte blocks on top of the message, and a key that is longer than a block.
  [size => subtle.sign("HMAC", hmac, data(size)), 832],
  [size => subtle.verify("HMAC", hmac, new Uint8Array(32), data(size)), 832],
  [size => subtle.sign("HMAC", longHmac, data(size)), 632],
  // The IV counts, and what is decrypted ends in a 16-byte tag, or in padding.
  [size => subtle.encrypt(gcm, gcmKey, data(size)), 1012],
  [async size => subtle.decrypt(gcm, gcmKey, await subtle.encrypt(gcm, gcmKey, data(size - 16))), 1012],
  [size => subtle.encrypt(cbc, cbcKey, data(size)), 1024],
  [async size => subtle.decrypt(cbc, cbcKey, await subtle.encrypt(cbc, cbcKey, data(size - 1))), 1024],
  [size => subtle.encrypt(ctr, ctrKey, data(size)), 1024],
  [size => subtle.decrypt(ctr, ctrKey, data(size)), 1024],
  [size => subtle.encrypt(cfb, cfbKey, data(size)), 1024],
  [size => subtle.decrypt(cfb, cfbKey, data(size)), 1024],
  [size => subtle.encrypt(chacha, chachaKey, data(size)), 1024],
  [async size => subtle.decrypt(chacha, chachaKey, await subtle.encrypt(chacha, chachaKey, data(size - 16))), 1024],
];

for (const [run, limit] of operations) await run(limit);
const within = poolThreads();
await subtle.digest("SHA-256", data(1025));
console.log(JSON.stringify({ within, over: poolThreads() > 0 }));
