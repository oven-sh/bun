// https://github.com/oven-sh/bun/issues/23292
// fs.access() and fs.accessSync() should work with Windows named pipes
import { expect, test } from "bun:test";
import { isWindows } from "harness";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";

test.if(isWindows)("fs.accessSync should work with named pipes", async () => {
  const pipeName = `\\\\.\\pipe\\bun-test-${randomUUID()}`;

  const server = net.createServer();
  server.listen(pipeName);
  await once(server, "listening");

  try {
    // Should not throw - the pipe exists
    fs.accessSync(pipeName, fs.constants.F_OK);

    // Test with R_OK as well
    fs.accessSync(pipeName, fs.constants.R_OK);
  } finally {
    server.close();
  }
});

test.if(isWindows)("fs.access should work with named pipes", async () => {
  const pipeName = `\\\\.\\pipe\\bun-test-${randomUUID()}`;

  const server = net.createServer();
  server.listen(pipeName);
  await once(server, "listening");

  try {
    // Test fs.access with callback
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    fs.access(pipeName, fs.constants.F_OK, err => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
    await promise;
  } finally {
    server.close();
  }
});

test.if(isWindows)("fs.promises.access should work with named pipes", async () => {
  const pipeName = `\\\\.\\pipe\\bun-test-${randomUUID()}`;

  const server = net.createServer();
  server.listen(pipeName);
  await once(server, "listening");

  try {
    // Should not throw - the pipe exists
    await fs.promises.access(pipeName, fs.constants.F_OK);
  } finally {
    server.close();
  }
});

test.if(isWindows)("fs.accessSync should throw ENOENT for non-existent named pipe", () => {
  const pipeName = `\\\\.\\pipe\\bun-test-nonexistent-${randomUUID()}`;

  expect(() => {
    fs.accessSync(pipeName, fs.constants.F_OK);
  }).toThrow();
});
