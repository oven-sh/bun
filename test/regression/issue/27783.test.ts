import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("undici cacheStores export is available", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { cacheStores } = require('undici');
      if (!cacheStores) throw new Error('cacheStores is undefined');
      if (!cacheStores.MemoryCacheStore) throw new Error('MemoryCacheStore is undefined');
      if (!cacheStores.SqliteCacheStore) throw new Error('SqliteCacheStore is undefined');
      const store = new cacheStores.MemoryCacheStore();
      console.log(JSON.stringify({ size: store.size, isFull: store.isFull() }));
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe('{"size":0,"isFull":false}');
  expect(exitCode).toBe(0);
});

test("undici cacheStores available via ESM import", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import { cacheStores } from 'undici';
      if (!cacheStores) throw new Error('cacheStores is undefined');
      const store = new cacheStores.MemoryCacheStore();
      console.log('ok');
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

test("MemoryCacheStore write and read", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { cacheStores } = require('undici');
      const store = new cacheStores.MemoryCacheStore();
      const key = { origin: 'https://example.com', method: 'GET', path: '/test' };
      const val = {
        statusCode: 200,
        statusMessage: 'OK',
        headers: { 'content-type': 'text/plain' },
        cachedAt: Date.now(),
        staleAt: Date.now() + 60000,
        deleteAt: Date.now() + 120000,
      };
      const ws = store.createWriteStream(key, val);
      ws.write(Buffer.from('hello'));
      ws.end();
      ws.on('finish', () => {
        const result = store.get(key);
        console.log(JSON.stringify({
          found: result !== undefined,
          statusCode: result?.statusCode,
          bodyChunks: result?.body?.length,
        }));
      });
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe('{"found":true,"statusCode":200,"bodyChunks":1}');
  expect(exitCode).toBe(0);
});

test("SqliteCacheStore basic operations", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { cacheStores } = require('undici');
      const store = new cacheStores.SqliteCacheStore();
      console.log(JSON.stringify({ size: store.size }));
      store.close();
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe('{"size":0}');
  expect(exitCode).toBe(0);
});
