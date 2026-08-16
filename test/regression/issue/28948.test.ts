// https://github.com/oven-sh/bun/issues/28948

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const VALID_ORDERS = ["ipv4first", "ipv6first", "verbatim"];

async function run(src: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("dns.getDefaultResultOrder is a function returning a string", async () => {
  const { stdout, stderr, exitCode } = await run(`
    const dns = require("node:dns");
    const v = dns.getDefaultResultOrder();
    console.log(typeof dns.getDefaultResultOrder, typeof v, v);
  `);
  const [kind, valueType, value] = stdout.trim().split(" ");
  expect(kind).toBe("function");
  expect(valueType).toBe("string");
  expect(VALID_ORDERS).toContain(value);
  expect(stderr).not.toContain("TypeError");
  expect(exitCode).toBe(0);
});

test.concurrent("dns.promises.getDefaultResultOrder is a function returning a string", async () => {
  const { stdout, stderr, exitCode } = await run(`
    const dns = require("node:dns");
    const v = dns.promises.getDefaultResultOrder();
    console.log(typeof dns.promises.getDefaultResultOrder, typeof v, v);
  `);
  const [kind, valueType, value] = stdout.trim().split(" ");
  expect(kind).toBe("function");
  expect(valueType).toBe("string");
  expect(VALID_ORDERS).toContain(value);
  expect(stderr).not.toContain("TypeError");
  expect(exitCode).toBe(0);
});

test.concurrent("node:dns/promises exports getDefaultResultOrder", async () => {
  const { stdout, stderr, exitCode } = await run(`
    const dnsp = require("node:dns/promises");
    const v = dnsp.getDefaultResultOrder();
    console.log(typeof dnsp.getDefaultResultOrder, typeof v, v);
  `);
  const [kind, valueType, value] = stdout.trim().split(" ");
  expect(kind).toBe("function");
  expect(valueType).toBe("string");
  expect(VALID_ORDERS).toContain(value);
  expect(stderr).not.toContain("TypeError");
  expect(exitCode).toBe(0);
});

test.concurrent("ESM named import { promises } from 'node:dns' exposes getDefaultResultOrder", async () => {
  // This is exactly what Vite 8 does.
  const { stdout, stderr, exitCode } = await run(`
    import { promises } from "node:dns";
    const v = promises.getDefaultResultOrder();
    console.log(typeof promises.getDefaultResultOrder, typeof v, v);
  `);
  const [kind, valueType, value] = stdout.trim().split(" ");
  expect(kind).toBe("function");
  expect(valueType).toBe("string");
  expect(VALID_ORDERS).toContain(value);
  expect(stderr).not.toContain("TypeError");
  expect(exitCode).toBe(0);
});

test.concurrent("setDefaultResultOrder on dns affects getDefaultResultOrder everywhere", async () => {
  const { stdout, stderr, exitCode } = await run(`
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
  expect(stderr).not.toContain("TypeError");
  expect(exitCode).toBe(0);
});

test.concurrent("setDefaultResultOrder on dns.promises affects dns too", async () => {
  const { stdout, stderr, exitCode } = await run(`
    const dns = require("node:dns");
    dns.promises.setDefaultResultOrder("ipv4first");
    console.log(dns.getDefaultResultOrder());
    console.log(dns.promises.getDefaultResultOrder());
    dns.promises.setDefaultResultOrder("verbatim");
    console.log(dns.getDefaultResultOrder());
    console.log(dns.promises.getDefaultResultOrder());
  `);
  expect(stdout.trim().split("\n")).toEqual(["ipv4first", "ipv4first", "verbatim", "verbatim"]);
  expect(stderr).not.toContain("TypeError");
  expect(exitCode).toBe(0);
});

test.concurrent("dns.promises.getServers is defined", async () => {
  // Node exposes getServers on the promises object too.
  const { stdout, stderr, exitCode } = await run(`
    const dns = require("node:dns");
    const dnsp = require("node:dns/promises");
    console.log(typeof dns.promises.getServers);
    console.log(typeof dnsp.getServers);
    console.log(Array.isArray(dns.promises.getServers()));
    console.log(Array.isArray(dnsp.getServers()));
  `);
  expect(stdout.trim().split("\n")).toEqual(["function", "function", "true", "true"]);
  expect(stderr).not.toContain("TypeError");
  expect(exitCode).toBe(0);
});
