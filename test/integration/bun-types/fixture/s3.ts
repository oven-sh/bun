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

const sseKey = new Uint8Array(32);
const sseClient = new Bun.S3Client({
  bucket: "b",
  sse: { type: "customer", algorithm: "AES256", key: sseKey },
});
doFileOps(sseClient.file("secret.bin", { sse: { type: "customer", key: "base64" } }));
sseClient.presign("secret.bin", { sse: { type: "customer", key: sseKey.buffer } });
// @ts-expect-error only "customer" exists
sseClient.file("x", { sse: { type: "kms", key: sseKey } });
// @ts-expect-error only AES256 exists
sseClient.file("x", { sse: { type: "customer", algorithm: "AES128", key: sseKey } });
