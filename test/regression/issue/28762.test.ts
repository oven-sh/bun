import { expect, test } from "bun:test";

test("Blob.stream() preserves part boundaries as separate chunks", async () => {
  const part1 = new Uint8Array([
    58, 162, 101, 114, 111, 111, 116, 115, 129, 216, 42, 88, 37, 0, 1, 85, 18, 32, 95, 102, 197, 19, 218, 30, 103, 78,
    133, 139, 57, 105, 28, 11, 0, 246, 124, 167, 41, 140, 239, 220, 248, 168, 136, 35, 196, 72, 236, 184, 232, 89, 103,
    118, 101, 114, 115, 105, 111, 110, 1,
  ]);
  const part2 = new Uint8Array([68]);
  const part3 = new Uint8Array([
    1, 85, 18, 32, 95, 102, 197, 19, 218, 30, 103, 78, 133, 139, 57, 105, 28, 11, 0, 246, 124, 167, 41, 140, 239, 220,
    248, 168, 136, 35, 196, 72, 236, 184, 232, 89,
  ]);
  const part4 = new Uint8Array([
    90, 189, 174, 145, 144, 134, 214, 117, 47, 251, 231, 254, 29, 238, 0, 29, 212, 201, 123, 107, 95, 130, 24, 168, 207,
    139, 134, 177, 187, 88, 167, 36,
  ]);

  const blob = new Blob([part1, part2, part3, part4]);
  const chunks: Uint8Array[] = [];
  await blob.stream().pipeTo(
    new WritableStream({
      write(chunk) {
        chunks.push(new Uint8Array(chunk));
      },
    }),
  );

  expect(chunks).toHaveLength(4);
  expect(chunks[0]).toEqual(part1);
  expect(chunks[1]).toEqual(part2);
  expect(chunks[2]).toEqual(part3);
  expect(chunks[3]).toEqual(part4);
});

test("Blob.stream() with string parts preserves boundaries", async () => {
  const blob = new Blob(["hello", " ", "world"]);
  const chunks: string[] = [];
  await blob.stream().pipeTo(
    new WritableStream({
      write(chunk) {
        chunks.push(new TextDecoder().decode(chunk));
      },
    }),
  );

  expect(chunks).toEqual(["hello", " ", "world"]);
});

test("Blob.stream() single part works normally", async () => {
  const data = new Uint8Array([1, 2, 3, 4, 5]);
  const blob = new Blob([data]);
  const chunks: Uint8Array[] = [];
  await blob.stream().pipeTo(
    new WritableStream({
      write(chunk) {
        chunks.push(new Uint8Array(chunk));
      },
    }),
  );

  expect(chunks).toHaveLength(1);
  expect(chunks[0]).toEqual(data);
});

test("Blob.stream() total content is correct after chunking", async () => {
  const parts = [new Uint8Array([1, 2, 3]), new Uint8Array([4]), new Uint8Array([5, 6])];
  const blob = new Blob(parts);
  const chunks: Uint8Array[] = [];
  await blob.stream().pipeTo(
    new WritableStream({
      write(chunk) {
        chunks.push(new Uint8Array(chunk));
      },
    }),
  );
  expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
});

test("Blob.stream() empty blob works", async () => {
  const blob = new Blob([]);
  const chunks: Uint8Array[] = [];
  await blob.stream().pipeTo(
    new WritableStream({
      write(chunk) {
        chunks.push(new Uint8Array(chunk));
      },
    }),
  );
  expect(chunks).toHaveLength(0);
});

test("Blob.stream() with getReader preserves boundaries", async () => {
  const blob = new Blob([new Uint8Array([1, 2, 3]), new Uint8Array([4]), new Uint8Array([5, 6])]);
  const reader = blob.stream().getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(new Uint8Array(value));
  }
  expect(chunks).toHaveLength(3);
  expect(chunks[0]).toEqual(new Uint8Array([1, 2, 3]));
  expect(chunks[1]).toEqual(new Uint8Array([4]));
  expect(chunks[2]).toEqual(new Uint8Array([5, 6]));
});
