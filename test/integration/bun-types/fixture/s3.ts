import { s3 } from "bun";
import { expectType } from "./utilities";

async function doFileOps(file: Bun.S3File) {
  console.log(file.bucket);
  console.log(file.presign());
  console.log(file.presign({ expiresIn: 1, method: "PUT" }));
  console.log(file.type);

  await file.json();
  await file.arrayBuffer();
  await file.delete();
  await file.formData();

  for await (const chunk of file.readable) {
    console.log(chunk);
  }
}

doFileOps(s3.file("stream.bin"));

doFileOps(
  new Bun.S3Client({
    accessKeyId: "123",
  }).file("stream.bin"),
);

doFileOps(
  s3.file("stream.bin", {
    type: "application/octet-stream",
  }),
);

// The input of the first signature of Bun.write(), the file write. TypeScript fills the `infer`
// slots from the last signature backwards and a spare slot repeats the first one, so this reads
// the first signature for up to ten of them.
type FileWriteInput = typeof Bun.write extends {
  (...args: infer A0): any;
  (...args: infer A1): any;
  (...args: infer A2): any;
  (...args: infer A3): any;
  (...args: infer A4): any;
  (...args: infer A5): any;
  (...args: infer A6): any;
  (...args: infer A7): any;
  (...args: infer A8): any;
  (...args: infer A9): any;
}
  ? A0[1]
  : never;

async function doWrites(
  client: Bun.S3Client,
  s3file: Bun.S3File,
  bunfile: Bun.BunFile,
  either: Bun.BunFile | Bun.S3File,
  options: Bun.S3Options,
  response: Response,
  request: Request,
  stream: ReadableStream,
  fileInput: FileWriteInput,
) {
  // Bun.write() to an S3File takes S3 options, with each kind of input.
  expectType(Bun.write(s3file, "x", { contentDisposition: "inline", acl: "private" })).is<Promise<number>>();
  expectType(Bun.write(s3file, bunfile, { partSize: 5 * 1024 * 1024, queueSize: 2 })).is<Promise<number>>();
  await Bun.write(s3file, "x", options);
  await Bun.write(s3file, response);
  await Bun.write(s3file, response, { storageClass: "STANDARD_IA" });
  await Bun.write(s3file, request);
  await Bun.write(s3file, request, { requestPayer: true });
  await Bun.write(s3file, new Uint8Array(1), { acl: "private" });
  await Bun.write(s3file, new DataView(new ArrayBuffer(1)), { acl: "private" });
  await Bun.write(s3file, new ArrayBuffer(1), { acl: "private" });
  await Bun.write(s3file, new Blob(["x"]), { acl: "private" });
  await Bun.write(s3file, s3file, { acl: "private" });
  await Bun.write(s3file, ["x", new Uint8Array(1)], { acl: "private" });
  await Bun.write(s3file, new Bun.Archive({ "a.txt": "a" }), { retry: 1 });
  await Bun.write(s3file, stream, { queueSize: 2 });
  await Bun.write(s3file.slice(0, 1), "x", { bucket: "other" });
  // Each input of a file write is an input of an S3File write with S3 options.
  await Bun.write(s3file, fileInput, { acl: "private" });

  // The file options still compile for an S3File, alone and beside S3 options.
  await Bun.write(s3file, "x", { mode: 0o600, createPath: false });
  await Bun.write(s3file, "x", { mode: 0o600, acl: "private" });
  await Bun.write(s3file, "x", {});
  await Bun.write(s3file, "x", undefined);

  // An S3File destination still checks its options and its data.
  // @ts-expect-error - not an ACL: the runtime throws ERR_INVALID_ARG_TYPE
  await Bun.write(s3file, "x", { acl: "publik" });
  // @ts-expect-error - not an option of an S3 write or of a file write
  await Bun.write(s3file, "x", { bogus: true });
  // @ts-expect-error - a number is not data
  await Bun.write(s3file, 123);
  // @ts-expect-error - null is not data: the runtime throws ERR_INVALID_ARG_TYPE
  await Bun.write(s3file, null);

  // A destination whose type is not S3File takes the file options only.
  await Bun.write(either, "x");
  await Bun.write(either, "x", { createPath: true });
  // @ts-expect-error - S3 options need a destination whose type is S3File
  await Bun.write("a.txt", "x", { acl: "private" });

  // A function typed as Bun.write, for example a mock, can take its options as the file options:
  // the options of the S3File signature extend them.
  const inferred: typeof Bun.write = async (destination, input, options) => (options?.createPath ? 1 : 0);
  const declared: typeof Bun.write = async (
    destination: unknown,
    input: unknown,
    options?: { createPath?: boolean },
  ) => (options?.createPath ? 1 : 0);

  // Each S3 write method takes a stream.
  await s3file.write(stream);
  await client.write("key", stream);
  await Bun.S3Client.write("key", stream, options);
  // An array of parts is not declared on them: the runtime drops a part that is a BunFile or an S3File.
  // @ts-expect-error
  await s3file.write(["x", bunfile]);
  // @ts-expect-error
  await client.write("key", ["x", bunfile]);

  return [inferred, declared];
}

doWrites(
  s3,
  s3.file("key"),
  Bun.file("file"),
  Bun.file("file"),
  { acl: "private" },
  new Response("x"),
  new Request("https://example.com", { method: "POST", body: "x" }),
  new ReadableStream(),
  "x",
);

// The three S3 write methods take one data type.
expectType<Parameters<Bun.S3Client["write"]>[1]>().is<Parameters<Bun.S3File["write"]>[0]>();
expectType<Parameters<typeof Bun.S3Client.write>[1]>().is<Parameters<Bun.S3File["write"]>[0]>();
