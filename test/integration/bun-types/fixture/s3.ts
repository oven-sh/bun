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

async function multipart(client: Bun.S3Client) {
  const { uploadId } = await client.createMultipartUpload("big.bin", { type: "application/octet-stream" });
  const url: string = client.presign("big.bin", { method: "PUT", expiresIn: 60, uploadId, partNumber: 1 });
  console.log(url, client.file("big.bin").presign({ uploadId, partNumber: 2 }));
  const parts: Bun.S3MultipartUploadPart[] = [{ partNumber: 1, etag: '"etag"' }];
  await client.completeMultipartUpload("big.bin", uploadId, parts);
  await client.abortMultipartUpload("big.bin", uploadId);

  const credentials = { accessKeyId: "123", secretAccessKey: "456" };
  const { uploadId: other } = await Bun.S3Client.createMultipartUpload("big.bin", credentials);
  await Bun.S3Client.completeMultipartUpload("big.bin", other, parts, credentials);
  await Bun.S3Client.abortMultipartUpload("big.bin", other, credentials);
  Bun.S3Client.presign("big.bin", { ...credentials, uploadId: other, partNumber: 3 });
}

multipart(s3);
