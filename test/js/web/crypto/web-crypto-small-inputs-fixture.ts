// Runs every operation that the calling thread computes for a small input, on the largest input it
// takes and on one byte more, and prints the operations that ran on the wrong side of their limit.
import { getEventLoopStats } from "bun:internal-for-testing";

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
// [name, the operation on an input of `size` bytes, the largest size the calling thread computes]
const operations: [string, (size: number) => Promise<unknown>, number][] = [
  ["digest SHA-1", size => subtle.digest("SHA-1", data(size)), 1024],
  ["digest SHA-224", size => subtle.digest("SHA-224", data(size)), 1024],
  ["digest SHA-256", size => subtle.digest("SHA-256", data(size)), 1024],
  ["digest SHA-384", size => subtle.digest("SHA-384", data(size)), 256],
  ["digest SHA-512", size => subtle.digest("SHA-512", data(size)), 256],
  ["digest SHA3-256", size => subtle.digest("SHA3-256", data(size)), 64],
  ["digest SHA3-384", size => subtle.digest("SHA3-384", data(size)), 64],
  ["digest SHA3-512", size => subtle.digest("SHA3-512", data(size)), 64],
  // HMAC hashes three 64-byte blocks on top of the message, and a key that is longer than a block.
  ["HMAC sign", size => subtle.sign("HMAC", hmac, data(size)), 832],
  ["HMAC verify", size => subtle.verify("HMAC", hmac, new Uint8Array(32), data(size)), 832],
  ["HMAC sign, 200-byte key", size => subtle.sign("HMAC", longHmac, data(size)), 632],
  // The IV counts. What is decrypted was never encrypted: its size has decided where it is decrypted
  // by the time its tag, or its padding, is found to be wrong.
  ["AES-GCM encrypt", size => subtle.encrypt(gcm, gcmKey, data(size)), 1012],
  ["AES-GCM decrypt", size => subtle.decrypt(gcm, gcmKey, data(size)).catch(() => {}), 1012],
  ["AES-CBC encrypt", size => subtle.encrypt(cbc, cbcKey, data(size)), 1024],
  ["AES-CBC decrypt", size => subtle.decrypt(cbc, cbcKey, data(size)).catch(() => {}), 1024],
  ["AES-CTR encrypt", size => subtle.encrypt(ctr, ctrKey, data(size)), 1024],
  ["AES-CTR decrypt", size => subtle.decrypt(ctr, ctrKey, data(size)), 1024],
  // AES-CFB-8 encrypts a block for every byte.
  ["AES-CFB-8 encrypt", size => subtle.encrypt(cfb, cfbKey, data(size)), 64],
  ["AES-CFB-8 decrypt", size => subtle.decrypt(cfb, cfbKey, data(size)), 64],
  ["ChaCha20-Poly1305 encrypt", size => subtle.encrypt(chacha, chachaKey, data(size)), 1024],
  ["ChaCha20-Poly1305 decrypt", size => subtle.decrypt(chacha, chachaKey, data(size)).catch(() => {}), 1024],
];

// A call counts the operation it gives to the pool in numPolls before it returns. What the pool's
// thread gives back once it is done waits in concurrentRef for the next tick of this thread.
const idle = getEventLoopStats().numPolls;
const isIdle = () => {
  const { numPolls, concurrentRef } = getEventLoopStats();
  return numPolls === idle && concurrentRef === 0;
};
async function givenToThePool(run: (size: number) => Promise<unknown>, size: number) {
  const result = run(size);
  const given = getEventLoopStats().numPolls - idle;
  await result;
  while (!isIdle()) await new Promise(resolve => setImmediate(resolve));
  return given;
}

const wrong: string[] = [];
for (const [name, run, limit] of operations) {
  if ((await givenToThePool(run, limit)) !== 0) wrong.push(`${name} of ${limit} bytes went to the pool`);
  if ((await givenToThePool(run, limit + 1)) !== 1) wrong.push(`${name} of ${limit + 1} bytes did not`);
}
console.log(JSON.stringify(wrong));
