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

async function timeoutAndSignal(client: Bun.S3Client, signal: AbortSignal) {
  const file = client.file("key", { timeout: 2_000 });
  await file.stat({ signal });
  await file.exists({ signal });
  await file.delete({ signal, timeout: false });
  await file.write("hello", { signal, timeout: 0 });
  file.writer({ signal, retry: 0 });

  await client.stat("key", { signal });
  await client.exists("key", { signal });
  await client.size("key", { signal });
  await client.unlink("key", { signal });
  await client.write("key", "hello", { signal, timeout: 1_000 });
  await client.list({ prefix: "k" }, { signal, timeout: 1_000 });
  await Bun.write(file, "hello", { signal, timeout: 1_000 });

  // @ts-expect-error a signal is one operation's, not the handle's
  client.file("key", { signal });
}

timeoutAndSignal(new Bun.S3Client({ timeout: 10_000 }), AbortSignal.timeout(5_000));
