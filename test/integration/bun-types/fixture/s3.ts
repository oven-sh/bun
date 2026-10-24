import { s3 } from "bun";

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

async function doTagging(file: Bun.S3File) {
  await file.write("data", { tagging: { state: "staged" } });
  await file.write("data", { tagging: "state=staged" });
  file.writer({ tagging: { state: "staged" } });
  console.log(file.presign({ method: "PUT", tagging: { state: "staged" } }));
  // @ts-expect-error a tag value is a string
  await file.write("data", { tagging: { count: 1 } });
}

doTagging(new Bun.S3Client({ tagging: { owner: "app" } }).file("tagged.bin"));
