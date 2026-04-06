import { expect, it } from "bun:test";
import { gcTick } from "harness";

it(`Bun.hash()`, () => {
  gcTick();
  expect(Bun.hash("hello world")).toBe(0x668d5e431c3b2573n);
  expect(Bun.hash(new TextEncoder().encode("hello world"))).toBe(0x668d5e431c3b2573n);
});
it(`Bun.hash.wyhash()`, () => {
  expect(Bun.hash.wyhash("hello world")).toBe(0x668d5e431c3b2573n);
  gcTick();
  expect(Bun.hash.wyhash(new TextEncoder().encode("hello world"))).toBe(0x668d5e431c3b2573n);
});
it(`Bun.hash.adler32()`, () => {
  expect(Bun.hash.adler32("hello world")).toBe(0x1a0b045d);
  gcTick();
  expect(Bun.hash.adler32(new TextEncoder().encode("hello world"))).toBe(0x1a0b045d);
});
it(`Bun.hash.crc32()`, () => {
  expect(Bun.hash.crc32("hello world")).toBe(0x0d4a1185);
  gcTick();
  expect(Bun.hash.crc32(new TextEncoder().encode("hello world"))).toBe(0x0d4a1185);
});
it(`Bun.hash.cityHash32()`, () => {
  expect(Bun.hash.cityHash32("hello world")).toBe(0x19a7581a);
  gcTick();
  expect(Bun.hash.cityHash32(new TextEncoder().encode("hello world"))).toBe(0x19a7581a);
  gcTick();
});
it(`Bun.hash.cityHash64()`, () => {
  expect(Bun.hash.cityHash64("hello world")).toBe(0xc7920bbdbecee42fn);
  gcTick();
  expect(Bun.hash.cityHash64(new TextEncoder().encode("hello world"))).toBe(0xc7920bbdbecee42fn);
  gcTick();
});
it(`Bun.hash.xxHash32()`, () => {
  expect(Bun.hash.xxHash32("hello world")).toBe(0xcebb6622);
  gcTick();
  expect(Bun.hash.xxHash32(new TextEncoder().encode("hello world"))).toBe(0xcebb6622);
  gcTick();
});
it(`Bun.hash.xxHash64()`, () => {
  expect(Bun.hash.xxHash64("hello world")).toBe(0x45ab6734b21e6968n);
  gcTick();
  expect(Bun.hash.xxHash64(new TextEncoder().encode("hello world"))).toBe(0x45ab6734b21e6968n);
  gcTick();
  // Test with seed larger than u32
  expect(Bun.hash.xxHash64("", 16269921104521594740n)).toBe(3224619365169652240n);
  gcTick();
});
it(`Bun.hash.xxHash3()`, () => {
  expect(Bun.hash.xxHash3("hello world")).toBe(0xd447b1ea40e6988bn);
  gcTick();
  expect(Bun.hash.xxHash3(new TextEncoder().encode("hello world"))).toBe(0xd447b1ea40e6988bn);
  gcTick();
});
it(`Bun.hash.murmur32v3()`, () => {
  expect(Bun.hash.murmur32v3("hello world")).toBe(0x5e928f0f);
  gcTick();
  expect(Bun.hash.murmur32v3(new TextEncoder().encode("hello world"))).toBe(0x5e928f0f);
});
it(`Bun.hash.murmur32v2()`, () => {
  expect(Bun.hash.murmur32v2("hello world")).toBe(0x44a81419);
  gcTick();
  expect(Bun.hash.murmur32v2(new TextEncoder().encode("hello world"))).toBe(0x44a81419);
});
it(`Bun.hash.murmur64v2()`, () => {
  expect(Bun.hash.murmur64v2("hello world")).toBe(0xd3ba2368a832afcen);
  gcTick();
  expect(Bun.hash.murmur64v2(new TextEncoder().encode("hello world"))).toBe(0xd3ba2368a832afcen);
});
it(`Bun.hash.rapidhash()`, () => {
  expect(Bun.hash.rapidhash("hello world")).toBe(0x58a89bdcee89c08cn);
  gcTick();
  expect(Bun.hash.rapidhash(new TextEncoder().encode("hello world"))).toBe(0x58a89bdcee89c08cn);
});
it("does not crash when changing Int32Array constructor with Bun.hash.xxHash32 as species", () => {
  const arr = new Int32Array();
  function foo(a4) {
    return a4;
  }
  foo[Symbol.species] = Bun.hash.xxHash32;
  arr.constructor = foo;

  expect(() => {
    arr.map(Bun.hash.xxHash32);
  }).toThrow("species is not a constructor");
});
