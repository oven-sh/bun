import { it, expect } from "bun:test";
import { gcTick } from "harness";

it(`Bun.hash()`, () => {
  gcTick();
  expect(Bun.hash("hello world")).toBe(0x668D5E431C3B2573n);
  expect(Bun.hash(new TextEncoder().encode("hello world"))).toBe(0x668D5E431C3B2573n);
});
it(`Bun.hash.wyhash()`, () => {
  expect(Bun.hash.wyhash("hello world")).toBe(0x668D5E431C3B2573n);
  gcTick();
  expect(Bun.hash.wyhash(new TextEncoder().encode("hello world"))).toBe(0x668D5E431C3B2573n);
});
it(`Bun.hash.adler32()`, () => {
  expect(Bun.hash.adler32("hello world")).toBe(0x1A0B045D);
  gcTick();
  expect(Bun.hash.adler32(new TextEncoder().encode("hello world"))).toBe(0x1A0B045D);
});
it(`Bun.hash.crc32()`, () => {
  expect(Bun.hash.crc32("hello world")).toBe(0x0D4A1185);
  gcTick();
  expect(Bun.hash.crc32(new TextEncoder().encode("hello world"))).toBe(0x0D4A1185);
});
it(`Bun.hash.cityHash32()`, () => {
  expect(Bun.hash.cityHash32("hello world")).toBe(0x19A7581A);
  gcTick();
  expect(Bun.hash.cityHash32(new TextEncoder().encode("hello world"))).toBe(0x19A7581A);
  gcTick();
});
it(`Bun.hash.cityHash64()`, () => {
  expect(Bun.hash.cityHash64("hello world")).toBe(0xC7920BBDBECEE42Fn);
  gcTick();
  expect(Bun.hash.cityHash64(new TextEncoder().encode("hello world"))).toBe(0xC7920BBDBECEE42Fn);
  gcTick();
});
it(`Bun.hash.murmur32v3()`, () => {
  expect(Bun.hash.murmur32v3("hello world")).toBe(0x5E928F0F);
  gcTick();
  expect(Bun.hash.murmur32v3(new TextEncoder().encode("hello world"))).toBe(0x5E928F0F);
});
it(`Bun.hash.murmur32v2()`, () => {
  expect(Bun.hash.murmur32v2("hello world")).toBe(0x44A81419);
  gcTick();
  expect(Bun.hash.murmur32v2(new TextEncoder().encode("hello world"))).toBe(0x44A81419);
});
it(`Bun.hash.murmur64v2()`, () => {
  expect(Bun.hash.murmur64v2("hello world")).toBe(0xD3BA2368A832AFCEn);
  gcTick();
  expect(Bun.hash.murmur64v2(new TextEncoder().encode("hello world"))).toBe(0xD3BA2368A832AFCEn);
});
