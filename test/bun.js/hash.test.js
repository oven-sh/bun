import fs from "fs";
import { it, expect } from "bun:test";
import path from "path";
import { gcTick } from "gc";

it(`Bun.hash()`, () => {
  gcTick();
  Bun.hash("hello world");
  Bun.hash(new TextEncoder().encode("hello world"));
});
it(`Bun.hash.wyhash()`, () => {
  Bun.hash.wyhash("hello world");
  gcTick();
  Bun.hash.wyhash(new TextEncoder().encode("hello world"));
});
it(`Bun.hash.adler32()`, () => {
  Bun.hash.adler32("hello world");
  gcTick();
  Bun.hash.adler32(new TextEncoder().encode("hello world"));
});
it(`Bun.hash.crc32()`, () => {
  Bun.hash.crc32("hello world");
  gcTick();
  Bun.hash.crc32(new TextEncoder().encode("hello world"));
});
it(`Bun.hash.cityHash32()`, () => {
  Bun.hash.cityHash32("hello world");
  gcTick();
  Bun.hash.cityHash32(new TextEncoder().encode("hello world"));
  gcTick();
});
it(`Bun.hash.cityHash64()`, () => {
  Bun.hash.cityHash64("hello world");
  gcTick();
  Bun.hash.cityHash64(new TextEncoder().encode("hello world"));
  gcTick();
});
it(`Bun.hash.murmur32v3()`, () => {
  Bun.hash.murmur32v3("hello world");
  gcTick();
  Bun.hash.murmur32v3(new TextEncoder().encode("hello world"));
});
it(`Bun.hash.murmur64v2()`, () => {
  Bun.hash.murmur64v2("hello world");
  gcTick();
  Bun.hash.murmur64v2(new TextEncoder().encode("hello world"));
});
