import { expect, test } from "bun:test";
import { tempDir } from "harness";

test("new Blob([Bun.file(), buffer]) includes file contents", async () => {
  using dir = tempDir("blob-file-concat", {
    "testfile.txt": "HELLO_FROM_FILE",
  });

  const file = Bun.file(`${dir}/testfile.txt`);
  const buffer = Buffer.from("BUFFER_DATA");

  // file + buffer
  const r1 = await new Blob([file, buffer]).text();
  expect(r1).toBe("HELLO_FROM_FILEBUFFER_DATA");

  // buffer + file
  const r2 = await new Blob([buffer, file]).text();
  expect(r2).toBe("BUFFER_DATAHELLO_FROM_FILE");

  // file + file
  const r3 = await new Blob([file, file]).text();
  expect(r3).toBe("HELLO_FROM_FILEHELLO_FROM_FILE");

  // single file still works
  const r4 = await new Blob([file]).text();
  expect(r4).toBe("HELLO_FROM_FILE");

  // size should be correct
  expect(new Blob([file, buffer]).size).toBe(26);
  expect(new Blob([buffer, file]).size).toBe(26);
  expect(new Blob([file, file]).size).toBe(30);
});

test("new Blob([Bun.file(), string]) includes file contents", async () => {
  using dir = tempDir("blob-file-string", {
    "testfile.txt": "FILE_CONTENT",
  });

  const file = Bun.file(`${dir}/testfile.txt`);

  const r1 = await new Blob([file, "STRING_DATA"]).text();
  expect(r1).toBe("FILE_CONTENTSTRING_DATA");

  const r2 = await new Blob(["STRING_DATA", file]).text();
  expect(r2).toBe("STRING_DATAFILE_CONTENT");
});

test("new Blob([Bun.file(), Uint8Array]) includes file contents", async () => {
  using dir = tempDir("blob-file-uint8", {
    "testfile.txt": "FILE_DATA",
  });

  const file = Bun.file(`${dir}/testfile.txt`);
  const uint8 = new Uint8Array([65, 66, 67]); // "ABC"

  const r1 = await new Blob([file, uint8]).text();
  expect(r1).toBe("FILE_DATAABC");

  const r2 = await new Blob([uint8, file]).text();
  expect(r2).toBe("ABCFILE_DATA");
});

test("new Blob([Bun.file(), Blob]) includes file contents", async () => {
  using dir = tempDir("blob-file-blob", {
    "testfile.txt": "FILE_DATA",
  });

  const file = Bun.file(`${dir}/testfile.txt`);
  const otherBlob = new Blob(["BLOB_DATA"]);

  const r1 = await new Blob([file, otherBlob]).text();
  expect(r1).toBe("FILE_DATABLOB_DATA");

  const r2 = await new Blob([otherBlob, file]).text();
  expect(r2).toBe("BLOB_DATAFILE_DATA");
});
