// https://github.com/oven-sh/bun/issues/28948
//
// `node:dns/promises` (and `require("node:dns").promises`) must expose
// `getDefaultResultOrder`. Vite 8's DNS lookup helper calls it and crashed
// with `TypeError: promises.getDefaultResultOrder is not a function`.
//
// Also fix the top-level `dns.getDefaultResultOrder()` which used to return
// the internal function object instead of the actual string value.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const VALID_ORDERS = ["ipv4first", "ipv6first", "verbatim"];

async function run(src: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  // The child must not throw. stderr may contain ASAN/JSC warnings in debug
  // builds, so don't require it to be empty — just check it doesn't contain
  // a TypeError from the code under test.
  expect(stderr).not.toContain("TypeError");
  expect(stderr).not.toContain("is not a function");
  expect(exitCode).toBe(0);
  return stdout;
}

test("dns.getDefaultResultOrder is a function returning a string", async () => {
  const stdout = await run(`
    const dns = require("node:dns");
    const v = dns.getDefaultResultOrder();
    console.log(typeof dns.getDefaultResultOrder, typeof v, v);
  `);
  const [kind, valueType, value] = stdout.trim().split(" ");
  expect(kind).toBe("function");
  expect(valueType).toBe("string");
  expect(VALID_ORDERS).toContain(value);
});

test("dns.promises.getDefaultResultOrder is a function returning a string", async () => {
  const stdout = await run(`
    const dns = require("node:dns");
    const v = dns.promises.getDefaultResultOrder();
    console.log(typeof dns.promises.getDefaultResultOrder, typeof v, v);
  `);
  const [kind, valueType, value] = stdout.trim().split(" ");
  expect(kind).toBe("function");
  expect(valueType).toBe("string");
  expect(VALID_ORDERS).toContain(value);
});

test("node:dns/promises exports getDefaultResultOrder", async () => {
  const stdout = await run(`
    const dnsp = require("node:dns/promises");
    const v = dnsp.getDefaultResultOrder();
    console.log(typeof dnsp.getDefaultResultOrder, typeof v, v);
  `);
  const [kind, valueType, value] = stdout.trim().split(" ");
  expect(kind).toBe("function");
  expect(valueType).toBe("string");
  expect(VALID_ORDERS).toContain(value);
});

test("ESM named import { promises } from 'node:dns' exposes getDefaultResultOrder", async () => {
  // This is exactly what Vite 8 does.
  const stdout = await run(`
    import { promises } from "node:dns";
    const v = promises.getDefaultResultOrder();
    console.log(typeof promises.getDefaultResultOrder, typeof v, v);
  `);
  const [kind, valueType, value] = stdout.trim().split(" ");
  expect(kind).toBe("function");
  expect(valueType).toBe("string");
  expect(VALID_ORDERS).toContain(value);
});

test("setDefaultResultOrder on dns affects getDefaultResultOrder everywhere", async () => {
  const stdout = await run(`
    const dns = require("node:dns");
    const dnsp = require("node:dns/promises");
    dns.setDefaultResultOrder("ipv4first");
    console.log(dns.getDefaultResultOrder());
    console.log(dns.promises.getDefaultResultOrder());
    console.log(dnsp.getDefaultResultOrder());
    dns.setDefaultResultOrder("ipv6first");
    console.log(dns.getDefaultResultOrder());
    console.log(dns.promises.getDefaultResultOrder());
    console.log(dnsp.getDefaultResultOrder());
  `);
  expect(stdout.trim().split("\n")).toEqual([
    "ipv4first",
    "ipv4first",
    "ipv4first",
    "ipv6first",
    "ipv6first",
    "ipv6first",
  ]);
});

test("setDefaultResultOrder on dns.promises affects dns too", async () => {
  const stdout = await run(`
    const dns = require("node:dns");
    dns.promises.setDefaultResultOrder("ipv4first");
    console.log(dns.getDefaultResultOrder());
    console.log(dns.promises.getDefaultResultOrder());
    dns.promises.setDefaultResultOrder("verbatim");
    console.log(dns.getDefaultResultOrder());
    console.log(dns.promises.getDefaultResultOrder());
  `);
  expect(stdout.trim().split("\n")).toEqual([
    "ipv4first",
    "ipv4first",
    "verbatim",
    "verbatim",
  ]);
});

test("dns.promises.getServers is defined", async () => {
  // Node exposes getServers on the promises object too.
  const stdout = await run(`
    const dns = require("node:dns");
    const dnsp = require("node:dns/promises");
    console.log(typeof dns.promises.getServers);
    console.log(typeof dnsp.getServers);
    console.log(Array.isArray(dns.promises.getServers()));
    console.log(Array.isArray(dnsp.getServers()));
  `);
  expect(stdout.trim().split("\n")).toEqual([
    "function",
    "function",
    "true",
    "true",
  ]);
});
