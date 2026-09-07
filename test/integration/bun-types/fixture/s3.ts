import { s3 } from "bun";

async function objectTags() {
  const options = { tags: { state: "ready" }, type: "application/json" } satisfies Bun.S3WriteOptions;
  const file = s3.file("object");
  await file.write("{}", options);
  file.writer(options);
  await s3.write("object", new Uint8Array(0), options);
  await Bun.S3Client.write("object", "{}", options);
  await Bun.write(file, new Response("{}"), options);
  await Bun.write("s3://object", "{}", options);
  await fetch("s3://object", { method: "PUT", body: "{}", s3: options });
  const tags: Record<string, string>[] = [
    await file.getTags(),
    await s3.getTags("object"),
    await Bun.S3Client.getTags("object"),
  ];
  // @ts-expect-error Tag values must be strings.
  await file.write("{}", { tags: { state: 1 } });
  // @ts-expect-error Tags are per-write options, not client defaults.
  new Bun.S3Client({ tags: { state: "ready" } });
  // @ts-expect-error Tags are not file defaults.
  s3.file("object", { tags: { state: "ready" } });
  // @ts-expect-error Presigning does not support object tags.
  file.presign({ tags: { state: "ready" } });
  // @ts-expect-error Reading tags does not accept write options.
  file.getTags({ tags: { state: "ready" } });
  return tags;
}

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
