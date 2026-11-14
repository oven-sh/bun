// Child process for the "a write that the kernel cuts short" tests in fs.test.ts.
// Usage: bun fs-write-short-fixture.ts <mode> <call> [path]. Prints one line of JSON.
import fs from "node:fs";

const [mode, call, path] = process.argv.slice(2);

// The same bytes as `payload` in fs.test.ts.
const size = 4 * 1024 * 1024;
const data = Buffer.alloc(size, Buffer.from(Array.from({ length: 251 }, (_, i) => i)));

// The first `total` bytes of `data`, as buffers of `each` bytes.
const slices = (total: number, each: number) =>
  Array.from({ length: Math.ceil(total / each) }, (_, i) => data.subarray(i * each, Math.min(total, (i + 1) * each)));

const writes: Record<string, (fd: number) => number> = {
  "writeSync(fd, buffer)": fd => fs.writeSync(fd, data),
  "writeSync(fd, buffer, offset, length)": fd =>
    fs.writeSync(fd, Buffer.concat([Buffer.alloc(7), data, Buffer.alloc(9)]), 7, size),
  "writeSync(fd, string)": fd => fs.writeSync(fd, data.toString("latin1"), null, "latin1"),
  // The cut is inside the second buffer, and two whole buffers follow it.
  "writevSync(fd, buffers)": fd =>
    fs.writevSync(fd, [
      data.subarray(0, 1000),
      data.subarray(1000, size - 2000),
      data.subarray(size - 2000, size - 1000),
      data.subarray(size - 1000),
    ]),
  // 2048 divides a page, so the cut is on a buffer boundary.
  "writevSync(fd, more than IOV_MAX buffers)": fd => fs.writevSync(fd, slices(size, 2048)),
  // The cut is inside a buffer, thousands of buffers follow it, and some are empty.
  "writevSync(fd, many small buffers)": fd =>
    fs.writevSync(
      fd,
      slices(size, 1000).flatMap((buffer, i) => (i % 7 === 6 ? [buffer, Buffer.alloc(0)] : [buffer])),
    ),
  "writevSync(fd, 54321 buffers of 13 bytes)": fd => fs.writevSync(fd, slices(54321 * 13, 13)),
  "writevSync(fd, buffers of 4099 bytes)": fd => fs.writevSync(fd, slices(size, 4099)),
  "writeSync(fd, buffer, offset, length, position)": fd => fs.writeSync(fd, data, 0, size, 4),
  "writevSync(fd, buffers, position)": fd => fs.writevSync(fd, [data.subarray(0, 1000), data.subarray(1000)], 4),
};

const codeOf = (fn: () => unknown) => {
  try {
    return fn();
  } catch (e) {
    return (e as NodeJS.ErrnoException).code;
  }
};

switch (mode) {
  case "signal": {
    // With a listener the signal interrupts write(2) and does not end the process.
    process.on("SIGUSR2", () => {});
    console.log(JSON.stringify(writes[call](fs.openSync(path, "w"))));
    break;
  }

  case "nonblocking": {
    // The blocking open waits for the reader, so the next open cannot fail with ENXIO.
    fs.openSync(path, "w");
    const fd = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
    console.log(JSON.stringify({ first: writes[call](fd), second: codeOf(() => writes[call](fd)) }));
    break;
  }

  case "limit": {
    console.log(JSON.stringify(writes[call](fs.openSync(path, "r+"))));
    break;
  }

  case "cap": {
    // The pages of `big` are never touched: /dev/null does not read them.
    const big = new Uint8Array(2 ** 31 - 1);
    // The cap cuts inside the first buffer, and 20 buffers of one byte follow it.
    const head = big.length - 20;
    const tailed = [
      big.subarray(0, head),
      ...Array.from({ length: 20 }, (_, i) => big.subarray(head + i, head + i + 1)),
    ];
    const fd = fs.openSync("/dev/null", "w");
    const callback = (fn: Function, ...args: unknown[]) =>
      new Promise<number>((resolve, reject) =>
        fn(fd, ...args, (err: Error | null, written: number) => (err ? reject(err) : resolve(written))),
      );
    const handle = await fs.promises.open("/dev/null", "w");
    console.log(
      JSON.stringify({
        "writeSync": fs.writeSync(fd, big),
        "writeSync, position": fs.writeSync(fd, big, 0, big.length, 0),
        "writevSync": fs.writevSync(fd, [big]),
        "writevSync, position": fs.writevSync(fd, [big], 0),
        "writevSync, two buffers": fs.writevSync(fd, [big.subarray(0, 10), big.subarray(10)]),
        "writevSync, 21 buffers": fs.writevSync(fd, tailed),
        "writevSync, 21 buffers, position": fs.writevSync(fd, tailed, 0),
        "write": await callback(fs.write, big),
        "write, position": await callback(fs.write, big, 0, big.length, 0),
        "writev": await callback(fs.writev, [big]),
        "writev, position": await callback(fs.writev, [big], 0),
        "FileHandle.write": (await handle.write(big)).bytesWritten,
        "FileHandle.write, position": (await handle.write(big, 0, big.length, 0)).bytesWritten,
        "FileHandle.writev": (await handle.writev([big])).bytesWritten,
        "FileHandle.writev, position": (await handle.writev([big], 0)).bytesWritten,
      }),
    );
    await handle.close();
    break;
  }
}
