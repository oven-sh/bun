// This file is a .cjs file so you can run it in node+jest to verify node behaves exactly the same.
const { expect, test } = require("bun:test");
const fs = require("fs");
const { tmpdir, devNull } = require("os");
const { fsStreamInternals } = require("bun:internal-for-testing");

function getMaxFd() {
  const dev_null = fs.openSync(devNull, "r");
  fs.closeSync(dev_null);
  return dev_null;
}

test("createWriteStream does not leak file descriptors", async () => {
  let start = getMaxFd();
  const path = `${tmpdir()}/${Date.now()}.leakTest.txt`;

  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(path, {});

    stream.on("error", reject);

    stream.on("open", () => {
      for (let i = 0; i < 100; i++) {
        stream.write("hello world");
      }
      stream.end();
    });

    stream.on("close", () => {
      resolve();
    });
  });

  // If this is larger than the start value, it means that the file descriptor was not closed
  expect(getMaxFd()).toBe(start);
});

test("createReadStream does not leak file descriptors", async () => {
  let start = getMaxFd();
  const path = `${tmpdir()}/${Date.now()}.leakTest.txt`;
  fs.writeFileSync(path, "hello world\n".repeat(1000));

  let n_bytes = 0;

  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(path, {});

    stream.on("error", reject);

    stream.on("data", chunk => {
      n_bytes += chunk.length;
    });

    stream.on("close", () => {
      resolve();
    });
  });

  // If this is larger than the start value, it means that the file descriptor was not closed
  expect(getMaxFd()).toBe(start);
  expect(n_bytes).toBe("hello world\n".repeat(1000).length);
});

test("createWriteStream file handle does not leak file descriptors", async () => {
  let start = getMaxFd();
  const path = `${tmpdir()}/${Date.now()}.leakTest.txt`;

  const fd = await fs.promises.open(path, "w");
  let closed = false;
  fd.on("close", () => {
    closed = true;
  });

  await new Promise((resolve, reject) => {
    const stream = fd.createWriteStream();
    expect(stream.autoClose).toBe(true);

    stream.on("error", reject);
    stream.on("open", () => {
      reject(new Error("fd is already open. open event should not be called"));
    });

    stream.on("close", () => {
      resolve();
    });

    for (let i = 0; i < 100; i++) {
      stream.write("hello world");
    }
    stream.end();
  });

  expect(closed).toBe(true);

  // If this is larger than the start value, it means that the file descriptor was not closed
  expect(getMaxFd()).toBe(start);
});

test("createReadStream file handle does not leak file descriptors", async () => {
  let start = getMaxFd();
  const path = `${tmpdir()}/${Date.now()}.leakTest.txt`;
  fs.writeFileSync(path, "hello world\n".repeat(1000));

  let n_bytes = 0;

  const fd = await fs.promises.open(path, "r");

  await new Promise((resolve, reject) => {
    const stream = fd.createReadStream({});

    stream.on("error", reject);

    stream.on("data", chunk => {
      n_bytes += chunk.length;
    });

    stream.on("close", () => {
      resolve();
    });
  });

  await fd.close();
  await fd.close();

  // If this is larger than the start value, it means that the file descriptor was not closed
  expect(getMaxFd()).toBe(start);
  expect(n_bytes).toBe("hello world\n".repeat(1000).length);
});
