import { describe, test, expect } from "bun:test";
import crypto from "node:crypto";

test("rejects fewer than 5 args", () => {
  try {
    crypto.hkdfSync();
    expect(false).toBeTrue();
  } catch (e) {
    expect(e.toString()).toInclude("The \"algorithm\" argument must be of type string");
  }
  try {
    crypto.hkdf();
    expect(false).toBeTrue();
  } catch (e) {
    expect(e.toString()).toInclude("The \"algorithm\" argument must be of type string");
  }
});

test("rejects invalid hash algorithm", () => {
  try {
    crypto.hkdfSync("notahash", "key", "salt", "info", 64)
    expect(false).toBeTrue();
  } catch (e) {
    expect(e.toString()).toInclude("Unsupported algorithm");
  }

  try {
    crypto.hkdf("notahash", "key", "salt", "info", 64, (err, ab) => {})
    expect(false).toBeTrue();
  } catch (e) {
    expect(e.toString()).toInclude("Unsupported algorithm");
  }
});

test('rejects bad callback type', () => {
  try {
    crypto.hkdf("sha512", "key", "salt", "info", 64, "notacallback");
    expect(false).toBeTrue();
  } catch (e){
    expect(e.toString()).toInclude("TypeError");
    expect(e.toString()).toInclude("not a function");
  }
})

test("rejects negative key size", () => {
  try {
    crypto.hkdfSync("sha512", "key", "salt", "info", -10);
    expect(false).toBeTrue();
  } catch (e) {
    expect(e.toString()).toInclude("range");
  }

  try {
    crypto.hkdf("sha512", "key", "salt", "info", -10, (err, ab) => {});
    expect(false).toBeTrue();
  } catch (e) {
    expect(e.toString()).toInclude("range");
  }
});

test("rejects excessive key size", () => {
  try {
    crypto.hkdfSync("sha512", "key", "salt", "info", 200000)
  } catch (e) {
    expect(e.toString()).toInclude("cannot be larger");
  }

  try {
    crypto.hkdfSync("sha512", "key", "salt", "info", 200000, (err, ab) => {})
  } catch (e) {
    expect(e.toString()).toInclude("cannot be larger");
  }
})

