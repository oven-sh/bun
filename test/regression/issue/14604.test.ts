// https://github.com/oven-sh/bun/issues/14604
import { expect, test } from "bun:test";
import { tls } from "harness";
import { once } from "node:events";
import tls_mod from "node:tls";

test("tls.Server.getTicketKeys returns 48-byte Buffer", async () => {
  await using server = tls_mod.createServer(tls);
  server.listen(0);
  await once(server, "listening");

  const keys = server.getTicketKeys();
  expect(keys).toBeInstanceOf(Buffer);
  expect(keys.byteLength).toBe(48);
});

test("tls.Server.setTicketKeys sets and persists keys", async () => {
  await using server = tls_mod.createServer(tls);
  server.listen(0);
  await once(server, "listening");

  const newKeys = Buffer.alloc(48);
  // Fill with a recognizable pattern
  for (let i = 0; i < 48; i++) newKeys[i] = i;

  server.setTicketKeys(newKeys);

  const retrieved = server.getTicketKeys();
  expect(retrieved).toBeInstanceOf(Buffer);
  expect(retrieved.byteLength).toBe(48);
  expect(Buffer.compare(retrieved, newKeys)).toBe(0);
});

test("tls.Server.setTicketKeys validates key length", async () => {
  await using server = tls_mod.createServer(tls);
  server.listen(0);
  await once(server, "listening");

  expect(() => server.setTicketKeys(Buffer.alloc(32))).toThrow();
  expect(() => server.setTicketKeys(Buffer.alloc(64))).toThrow();
});

test("tls.Server.setTicketKeys validates key type", () => {
  const server = tls_mod.createServer(tls);
  expect(() => (server as any).setTicketKeys("not a buffer")).toThrow();
  expect(() => (server as any).setTicketKeys(123)).toThrow();
  server.close();
});

test("tls.Server.setTicketKeys accepts Uint8Array", async () => {
  await using server = tls_mod.createServer(tls);
  server.listen(0);
  await once(server, "listening");

  const keys = new Uint8Array(48);
  keys.fill(0xab);
  server.setTicketKeys(keys);

  const retrieved = server.getTicketKeys();
  expect(retrieved.byteLength).toBe(48);
  expect(retrieved[0]).toBe(0xab);
  expect(retrieved[47]).toBe(0xab);
});

test("tls.Server.setTicketKeys accepts DataView", async () => {
  await using server = tls_mod.createServer(tls);
  server.listen(0);
  await once(server, "listening");

  const ab = new ArrayBuffer(48);
  new Uint8Array(ab).fill(0xcd);
  server.setTicketKeys(new DataView(ab));

  const retrieved = server.getTicketKeys();
  expect(retrieved.byteLength).toBe(48);
  expect(retrieved[0]).toBe(0xcd);
  expect(retrieved[47]).toBe(0xcd);
});

test("tls.Server ticket key methods before listening", () => {
  const server = tls_mod.createServer(tls);
  // Node.js silently ignores setTicketKeys if no handle
  expect(() => server.setTicketKeys(Buffer.alloc(48))).not.toThrow();
  // getTicketKeys throws ERR_SERVER_NOT_RUNNING when not listening
  expect(() => server.getTicketKeys()).toThrow();
  server.close();
});
