// Runs one operation of the S3 client many times and prints how much the RSS grew:
//
//   bun --smol s3-leak-fixture.ts <operation>
//
// `Bun.s3` and an `s3://` path take the endpoint, the bucket and the credentials from the
// environment. The last line of the output is JSON: {"deltaMiB": <number>}.
import { randomUUID } from "crypto";

const MiB = 1024 * 1024;
const payload = Buffer.alloc(MiB, "A").toString();
const quarter = Buffer.alloc(MiB / 4, "A").toString();
// The object that the two read operations download.
const source = randomUUID() + "-s3-leak-fixture";

// Each operation moves a body of 1 MiB and returns the number of bytes that it moved.
const operations: Record<string, () => Promise<number>> = {
  async stream() {
    const reader = Bun.s3.file(source).stream().getReader();
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) return bytes;
      bytes += value.byteLength;
    }
  },
  async text() {
    return (await Bun.s3.file(source).text()).length;
  },
  async writer() {
    const file = Bun.s3.file(randomUUID());
    const writer = file.writer();
    // The chunks come 10 ms apart, so the writer holds them across turns of the event loop.
    writer.write(quarter);
    await Bun.sleep(10);
    writer.write(quarter);
    await Bun.sleep(10);
    writer.write(quarter);
    await Bun.sleep(10);
    writer.write(quarter);
    const bytes = await writer.end();
    await file.unlink();
    return bytes;
  },
  async write() {
    const file = Bun.s3.file(randomUUID());
    const bytes = await file.write(payload);
    await file.unlink();
    return bytes;
  },
  async "Bun.write"() {
    const dest = `s3://${randomUUID()}`;
    const bytes = await Bun.write(dest, payload);
    await Bun.file(dest).unlink();
    return bytes;
  },
};
const operation = operations[process.argv[2]];
if (!operation) throw new Error(`"${process.argv[2]}" is not one of: ${Object.keys(operations).join(", ")}`);

// A batch is ten operations at the same time, in the warm-up too. The memory that ten bodies need
// at once is then a part of the first reading, and only what an operation keeps adds to the second.
let moved = 0;
async function batches(count: number) {
  for (let i = 0; i < count; i++) {
    await Promise.all(
      Array.from({ length: 10 }, async () => {
        const bytes = await operation();
        moved += bytes;
      }),
    );
  }
}

// A full collection frees the memory of the operations, but not all of the freed pages go back to
// the system at once: the RSS falls for about 200 ms more, by several MiB. So this reads until the
// number stops falling: ten readings in a row that are not below the lowest one.
async function settledRss() {
  Bun.gc(true);
  let lowest = process.memoryUsage.rss();
  for (let steady = 0, readings = 0; steady < 10 && readings < 250; readings++) {
    await Bun.sleep(20);
    const now = process.memoryUsage.rss();
    if (now < lowest) {
      lowest = now;
      steady = 0;
    } else {
      steady++;
    }
  }
  return lowest;
}

await Bun.s3.file(source).write(payload);
await batches(3);
const before = await settledRss();
moved = 0;
await batches(10);
const after = await settledRss();
// The growth says something about a leak only if each of the 100 operations moved its body.
if (moved !== 100 * MiB) throw new Error(`The 100 operations moved ${moved} bytes, not 100 MiB`);
console.log(JSON.stringify({ deltaMiB: (after - before) / MiB }));
