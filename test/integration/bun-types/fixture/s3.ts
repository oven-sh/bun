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

// Ambient AWS / GCP credentials
{
  const client = new Bun.S3Client({ profile: "prod", bucket: "b" });
  client.file("x").presign();
  const creds: Bun.AWSCredentials = await Bun.aws.credentials({ profile: "prod", refresh: true });
  console.log(creds.accessKeyId, creds.secretAccessKey, creds.sessionToken, creds.expiration?.getTime(), creds.source);
  const url: Promise<string> = Bun.aws.presign("https://b.s3.amazonaws.com/k", { expiresIn: 60, method: "PUT" });
  await Bun.aws.fetch("https://sqs.us-east-1.amazonaws.com/");
  await Bun.aws.fetch("/?Action=ListQueues", { service: "sqs", method: "GET" });
  for await (const m of Bun.aws.eventStream(await Bun.aws.fetch("https://bedrock-runtime.us-east-1.amazonaws.com/x"))) {
    const h: string | number | bigint | boolean | Date | Uint8Array | undefined = m.headers[":event-type"];
    console.log(m.type, m.event, m.contentType, m.payload.byteLength, m.text(), m.json(), h);
  }
  const prod = new Bun.AWSClient({ profile: "prod", region: "eu-west-1", endpoint: "http://localhost:4566" });
  const r: Response = await prod.fetch("https://example.com/", {
    service: "execute-api",
    signQuery: true,
    body: "x",
    method: "POST",
  });
  console.log(prod.region, prod.profile, r.status, Bun.aws instanceof Bun.AWSClient);
  const t: Bun.GCPToken = await Bun.gcp.accessToken({ scopes: ["cloud-platform"] });
  console.log(t.token, t.expiration.getTime(), t.source, t.email, t.projectId, t.quotaProjectId, url);
  await Bun.gcp.idToken("https://run.app");
  await Bun.gcp.idToken({ audience: "https://run.app" });
  await Bun.gcp.fetch("https://storage.googleapis.com/");
  const sa = new Bun.GCPClient({ keyFile: "/x.json", scopes: "devstorage.read_only" });
  await sa.fetch("https://x.run.app/", { audience: "https://x.run.app", method: "POST", body: "{}" });
  await new Bun.GCPClient({ credentials: { type: "service_account" }, audience: "https://x" }).idToken();
}
