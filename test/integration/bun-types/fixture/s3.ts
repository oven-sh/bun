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

async function doBucketOps(client: Bun.S3Client) {
  const exists: boolean = await client.bucketExists();
  const existsNamed: boolean = await client.bucketExists("tenant-42", { region: "eu-west-1" });
  const created: void = await client.createBucket();
  const createdNamed: void = await client.createBucket("tenant-42", {
    region: "eu-west-1",
    acl: "private",
    objectLockEnabled: true,
  });
  const deleted: void = await client.deleteBucket("tenant-42", { endpoint: "http://localhost:9000" });
  console.log(exists, existsNamed, created, createdNamed, deleted);

  const staticExists: boolean = await Bun.S3Client.bucketExists("tenant-42", { accessKeyId: "123" });
  const staticCreated: void = await Bun.S3Client.createBucket("tenant-42", { region: "eu-west-1", bucket: "x" });
  const staticDeleted: void = await Bun.S3Client.deleteBucket(undefined, { bucket: "tenant-42" });
  console.log(staticExists, staticCreated, staticDeleted);

  // @ts-expect-error the acl is not a canned ACL
  await client.createBucket("tenant-42", { acl: "nope" });
  // @ts-expect-error the name is a string
  await client.deleteBucket(5);
}

doBucketOps(s3);
