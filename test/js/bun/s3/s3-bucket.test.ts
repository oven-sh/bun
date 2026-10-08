import type { S3Options } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// `S3File.bucket`, `Bun.inspect(file)` and `Bun.inspect(client)` name the bucket
// that a request for the file goes to. Each case puts them beside the URL that
// presign() makes. presign() signs offline, so no case uses the network.

type Case = {
  /** How the file is made. The default is `new S3Client(client).file(key, file)`. */
  via?: "Bun.s3.file" | "S3Client.file" | "Bun.file" | "slice";
  client?: S3Options;
  file?: S3Options;
  /** The default is "dir/f.txt". */
  key?: string;
};

type Report = {
  /** Host and path of the presigned URL, or the code of the error that presign() throws. */
  url: string;
  bucket: string | null;
  /** `Bun.inspect(file)`, up to the `{`. */
  file: string;
  /** `Bun.inspect(client)`, up to the `{`, when the case makes a client. */
  client?: string;
};

const virtualHosted = { virtualHostedStyle: true } as const;
const aws = { ...virtualHosted, endpoint: "https://prod-bucket.s3.us-east-1.amazonaws.com" } as const;

// Each jurisdiction that R2 has. `guess_bucket` in src/s3_signing/credentials.rs has the same list.
const r2Jurisdictions = ["eu", "fedramp", "us"] as const;

/** A virtual-hosted client on `<labels>.r2.cloudflarestorage.com`, and the bucket that the labels name. */
function r2Case(name: string, labels: string, bucket: string | null): [string, [Case, Report]] {
  const host = `${labels}.r2.cloudflarestorage.com`;
  return [
    name,
    [
      { client: { ...virtualHosted, endpoint: `https://${host}` } },
      {
        url: `${host}/dir/f.txt`,
        bucket,
        file: bucket ? `S3Ref ("${bucket}/dir/f.txt")` : 'S3Ref ("dir/f.txt")',
        client: bucket ? `S3Client ("${bucket}")` : "S3Client",
      },
    ],
  ];
}

const probe = /* js */ `
  const credentials = { accessKeyId: "a", secretAccessKey: "b", region: "us-east-1" };
  const head = value => Bun.inspect(value).split(" {")[0];
  const reports = {};
  for (const [name, { via, client: clientOptions, file: fileOptions, key = "dir/f.txt" }] of Object.entries(cases)) {
    const options = { ...credentials, ...clientOptions };
    let client, file;
    if (via === "Bun.s3.file") file = Bun.s3.file(key, options);
    else if (via === "S3Client.file") file = Bun.S3Client.file(key, options);
    else if (via === "Bun.file") file = Bun.file(key, options);
    else {
      client = new Bun.S3Client(options);
      file = fileOptions ? client.file(key, fileOptions) : client.file(key);
      if (via === "slice") file = file.slice(1);
    }
    let url;
    try {
      const { host, pathname } = new URL(file.presign());
      url = host + pathname;
    } catch (error) {
      url = error.code;
    }
    reports[name] = { url, bucket: file.bucket ?? null, file: head(file), client: client && head(client) };
  }
  console.log(JSON.stringify(reports));
`;

// The cases run in a child process: `S3Client` and `Bun.s3` take a bucket and an
// endpoint from the environment, so each test sets its own.
function testCases(
  title: string,
  env: { S3_BUCKET?: string; S3_ENDPOINT?: string },
  cases: Record<string, [Case, Report]>,
) {
  test.concurrent(title, async () => {
    const entries = Object.entries(cases);
    const inputs = Object.fromEntries(entries.map(([name, [input]]) => [name, input]));
    const expected = Object.fromEntries(entries.map(([name, [, report]]) => [name, report]));

    // An empty directory: no .env file gives the child a bucket or an endpoint.
    using dir = tempDir("s3-bucket", {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `const cases = ${JSON.stringify(inputs)};${probe}`],
      env: {
        ...bunEnv,
        S3_BUCKET: undefined,
        AWS_BUCKET: undefined,
        S3_ENDPOINT: undefined,
        AWS_ENDPOINT: undefined,
        ...env,
      },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(expected);
    expect(exitCode).toBe(0);
  });
}

testCases(
  "virtual-hosted style with an endpoint: the bucket is in the host of the endpoint",
  {},
  {
    "AWS host": [
      { client: aws },
      {
        url: "prod-bucket.s3.us-east-1.amazonaws.com/dir/f.txt",
        bucket: "prod-bucket",
        file: 'S3Ref ("prod-bucket/dir/f.txt")',
        client: 'S3Client ("prod-bucket")',
      },
    ],
    "AWS host, key with one segment": [
      { client: aws, key: "f.txt" },
      {
        url: "prod-bucket.s3.us-east-1.amazonaws.com/f.txt",
        bucket: "prod-bucket",
        file: 'S3Ref ("prod-bucket/f.txt")',
        client: 'S3Client ("prod-bucket")',
      },
    ],
    "AWS host, s3:// key: the bucket of the URL is a part of the key": [
      { client: aws, key: "s3://scratch-bucket/dir/f.txt" },
      {
        url: "prod-bucket.s3.us-east-1.amazonaws.com/scratch-bucket/dir/f.txt",
        bucket: "prod-bucket",
        file: 'S3Ref ("prod-bucket/scratch-bucket/dir/f.txt")',
        client: 'S3Client ("prod-bucket")',
      },
    ],
    "AWS host, bucket option: the request ignores the option": [
      { client: { ...aws, bucket: "opt-bucket" } },
      {
        url: "prod-bucket.s3.us-east-1.amazonaws.com/dir/f.txt",
        bucket: "prod-bucket",
        file: 'S3Ref ("prod-bucket/dir/f.txt")',
        client: 'S3Client ("prod-bucket")',
      },
    ],
    "AWS host, endpoint with a port and a path": [
      { client: { ...virtualHosted, endpoint: "https://prod-bucket.s3.us-east-1.amazonaws.com:8443/prefix" } },
      {
        url: "prod-bucket.s3.us-east-1.amazonaws.com:8443/prefix/dir/f.txt",
        bucket: "prod-bucket",
        file: 'S3Ref ("prod-bucket/dir/f.txt")',
        client: 'S3Client ("prod-bucket")',
      },
    ],
    "AWS host without a region": [
      { client: { ...virtualHosted, endpoint: "https://prod-bucket.s3.amazonaws.com" } },
      {
        url: "prod-bucket.s3.amazonaws.com/dir/f.txt",
        bucket: "prod-bucket",
        file: 'S3Ref ("prod-bucket/dir/f.txt")',
        client: 'S3Client ("prod-bucket")',
      },
    ],
    "AWS dual-stack host": [
      { client: { ...virtualHosted, endpoint: "https://prod-bucket.s3.dualstack.eu-west-1.amazonaws.com" } },
      {
        url: "prod-bucket.s3.dualstack.eu-west-1.amazonaws.com/dir/f.txt",
        bucket: "prod-bucket",
        file: 'S3Ref ("prod-bucket/dir/f.txt")',
        client: 'S3Client ("prod-bucket")',
      },
    ],
    "AWS China host": [
      { client: { ...virtualHosted, endpoint: "https://prod-bucket.s3.cn-north-1.amazonaws.com.cn" } },
      {
        url: "prod-bucket.s3.cn-north-1.amazonaws.com.cn/dir/f.txt",
        bucket: "prod-bucket",
        file: 'S3Ref ("prod-bucket/dir/f.txt")',
        client: 'S3Client ("prod-bucket")',
      },
    ],
    "AWS host, bucket name with .s3. in it": [
      { client: { ...virtualHosted, endpoint: "https://a.s3.b.s3.us-east-1.amazonaws.com" } },
      {
        url: "a.s3.b.s3.us-east-1.amazonaws.com/dir/f.txt",
        bucket: "a.s3.b",
        file: 'S3Ref ("a.s3.b/dir/f.txt")',
        client: 'S3Client ("a.s3.b")',
      },
    ],
    "R2 host": [
      { client: { ...virtualHosted, endpoint: "https://my-bucket.acct123.r2.cloudflarestorage.com" } },
      {
        url: "my-bucket.acct123.r2.cloudflarestorage.com/dir/f.txt",
        bucket: "my-bucket",
        file: 'S3Ref ("my-bucket/dir/f.txt")',
        client: 'S3Client ("my-bucket")',
      },
    ],
    // The bucket label is in front of the account for each jurisdiction, also for one that Bun does not know.
    ...Object.fromEntries(
      [...r2Jurisdictions, "a-new-one"].map(jurisdiction =>
        r2Case(`R2 host in the ${jurisdiction} jurisdiction`, `my-bucket.acct123.${jurisdiction}`, "my-bucket"),
      ),
    ),
    // A dot at the end is the fully qualified form of the same host.
    "AWS host, fully qualified": [
      { client: { ...virtualHosted, endpoint: "https://prod-bucket.s3.us-east-1.amazonaws.com." } },
      {
        url: "prod-bucket.s3.us-east-1.amazonaws.com./dir/f.txt",
        bucket: "prod-bucket",
        file: 'S3Ref ("prod-bucket/dir/f.txt")',
        client: 'S3Client ("prod-bucket")',
      },
    ],
    "R2 host, fully qualified": [
      { client: { ...virtualHosted, endpoint: "https://my-bucket.acct123.r2.cloudflarestorage.com." } },
      {
        url: "my-bucket.acct123.r2.cloudflarestorage.com./dir/f.txt",
        bucket: "my-bucket",
        file: 'S3Ref ("my-bucket/dir/f.txt")',
        client: 'S3Client ("my-bucket")',
      },
    ],
  },
);

testCases(
  "virtual-hosted style with an endpoint: no bucket when the host does not name one",
  {},
  {
    "custom domain": [
      { client: { ...virtualHosted, endpoint: "https://files.example.com" } },
      { url: "files.example.com/dir/f.txt", bucket: null, file: 'S3Ref ("dir/f.txt")', client: "S3Client" },
    ],
    "custom domain, bucket option: the request ignores the option": [
      { client: { ...virtualHosted, endpoint: "https://files.example.com", bucket: "opt-bucket" } },
      { url: "files.example.com/dir/f.txt", bucket: null, file: 'S3Ref ("dir/f.txt")', client: "S3Client" },
    ],
    "host of another provider, bucket option": [
      { client: { ...virtualHosted, endpoint: "http://real-bucket.localhost:9000", bucket: "other-bucket" } },
      { url: "real-bucket.localhost:9000/dir/f.txt", bucket: null, file: 'S3Ref ("dir/f.txt")', client: "S3Client" },
    ],
    "R2 account host": [
      { client: { ...virtualHosted, endpoint: "https://acct123.r2.cloudflarestorage.com" } },
      {
        url: "acct123.r2.cloudflarestorage.com/dir/f.txt",
        bucket: null,
        file: 'S3Ref ("dir/f.txt")',
        client: "S3Client",
      },
    ],
    // The account is not a bucket.
    ...Object.fromEntries(
      r2Jurisdictions.map(jurisdiction =>
        r2Case(`R2 account host in the ${jurisdiction} jurisdiction`, `acct123.${jurisdiction}`, null),
      ),
    ),
    "AWS PrivateLink host": [
      {
        client: {
          ...virtualHosted,
          endpoint: "https://prod-bucket.bucket.vpce-0a1b2c3d-abcd.s3.us-east-1.vpce.amazonaws.com",
        },
      },
      {
        url: "prod-bucket.bucket.vpce-0a1b2c3d-abcd.s3.us-east-1.vpce.amazonaws.com/dir/f.txt",
        bucket: null,
        file: 'S3Ref ("dir/f.txt")',
        client: "S3Client",
      },
    ],
    "AWS path-style host": [
      { client: { ...virtualHosted, endpoint: "https://s3.us-east-1.amazonaws.com" } },
      { url: "s3.us-east-1.amazonaws.com/dir/f.txt", bucket: null, file: 'S3Ref ("dir/f.txt")', client: "S3Client" },
    ],
    "a path that looks like an AWS host": [
      { client: { ...virtualHosted, endpoint: "https://files.example.com/prod-bucket.s3.us-east-1.amazonaws.com" } },
      {
        url: "files.example.com/prod-bucket.s3.us-east-1.amazonaws.com/dir/f.txt",
        bucket: null,
        file: 'S3Ref ("dir/f.txt")',
        client: "S3Client",
      },
    ],
    // A host with an empty label has no bucket label.
    "AWS host with an empty label": [
      { client: { ...virtualHosted, endpoint: "https://..s3.us-east-1.amazonaws.com" } },
      {
        url: "..s3.us-east-1.amazonaws.com/dir/f.txt",
        bucket: null,
        file: 'S3Ref ("dir/f.txt")',
        client: "S3Client",
      },
    ],
    "R2 host with an empty account label": [
      { client: { ...virtualHosted, endpoint: "https://bkt..r2.cloudflarestorage.com" } },
      {
        url: "bkt..r2.cloudflarestorage.com/dir/f.txt",
        bucket: null,
        file: 'S3Ref ("dir/f.txt")',
        client: "S3Client",
      },
    ],
  },
);

testCases(
  "virtual-hosted style without an endpoint: the bucket option makes the host",
  {},
  {
    "bucket option": [
      { client: { ...virtualHosted, bucket: "opt-bucket" } },
      {
        url: "opt-bucket.s3.us-east-1.amazonaws.com/dir/f.txt",
        bucket: "opt-bucket",
        file: 'S3Ref ("opt-bucket/dir/f.txt")',
        client: 'S3Client ("opt-bucket")',
      },
    ],
    "no bucket option: no request is possible": [
      { client: virtualHosted },
      { url: "ERR_S3_INVALID_ENDPOINT", bucket: null, file: 'S3Ref ("dir/f.txt")', client: "S3Client" },
    ],
  },
);

testCases(
  "path style: the bucket option, or else the first segment of the path",
  {},
  {
    "no bucket option": [
      {},
      { url: "s3.us-east-1.amazonaws.com/dir/f.txt", bucket: "dir", file: 'S3Ref ("dir/f.txt")', client: "S3Client" },
    ],
    "no bucket option, key with one segment: no request is possible": [
      { key: "f.txt" },
      { url: "ERR_S3_INVALID_PATH", bucket: null, file: 'S3Ref ("f.txt")', client: "S3Client" },
    ],
    "no bucket option, s3:// key": [
      { key: "s3://scratch-bucket/dir/f.txt" },
      {
        url: "s3.us-east-1.amazonaws.com/scratch-bucket/dir/f.txt",
        bucket: "scratch-bucket",
        file: 'S3Ref ("scratch-bucket/dir/f.txt")',
        client: "S3Client",
      },
    ],
    "bucket option": [
      { client: { bucket: "opt-bucket" } },
      {
        url: "s3.us-east-1.amazonaws.com/opt-bucket/dir/f.txt",
        bucket: "opt-bucket",
        file: 'S3Ref ("opt-bucket/dir/f.txt")',
        client: 'S3Client ("opt-bucket")',
      },
    ],
    "bucket option, s3:// key": [
      { client: { bucket: "opt-bucket" }, key: "s3://scratch-bucket/dir/f.txt" },
      {
        url: "s3.us-east-1.amazonaws.com/opt-bucket/scratch-bucket/dir/f.txt",
        bucket: "opt-bucket",
        file: 'S3Ref ("opt-bucket/scratch-bucket/dir/f.txt")',
        client: 'S3Client ("opt-bucket")',
      },
    ],
    "endpoint, no bucket option": [
      { client: { endpoint: "https://minio.example.com:9000" } },
      { url: "minio.example.com:9000/dir/f.txt", bucket: "dir", file: 'S3Ref ("dir/f.txt")', client: "S3Client" },
    ],
    "endpoint with an AWS bucket host, no bucket option": [
      { client: { endpoint: aws.endpoint } },
      {
        url: "prod-bucket.s3.us-east-1.amazonaws.com/dir/f.txt",
        bucket: "dir",
        file: 'S3Ref ("dir/f.txt")',
        client: "S3Client",
      },
    ],
    "endpoint and bucket option": [
      { client: { endpoint: "https://minio.example.com:9000", bucket: "opt-bucket" } },
      {
        url: "minio.example.com:9000/opt-bucket/dir/f.txt",
        bucket: "opt-bucket",
        file: 'S3Ref ("opt-bucket/dir/f.txt")',
        client: 'S3Client ("opt-bucket")',
      },
    ],
  },
);

testCases(
  "the options of a file replace the options of its client",
  {},
  {
    "path-style client, virtual-hosted file": [
      { client: { bucket: "opt-bucket" }, file: aws },
      {
        url: "prod-bucket.s3.us-east-1.amazonaws.com/dir/f.txt",
        bucket: "prod-bucket",
        file: 'S3Ref ("prod-bucket/dir/f.txt")',
        client: 'S3Client ("opt-bucket")',
      },
    ],
    "virtual-hosted client, path-style file": [
      { client: aws, file: { virtualHostedStyle: false, bucket: "file-bucket" } },
      {
        url: "prod-bucket.s3.us-east-1.amazonaws.com/file-bucket/dir/f.txt",
        bucket: "file-bucket",
        file: 'S3Ref ("file-bucket/dir/f.txt")',
        client: 'S3Client ("prod-bucket")',
      },
    ],
  },
);

testCases(
  "each way to make a file",
  {},
  {
    "Bun.s3.file()": [
      { via: "Bun.s3.file", client: aws },
      {
        url: "prod-bucket.s3.us-east-1.amazonaws.com/dir/f.txt",
        bucket: "prod-bucket",
        file: 'S3Ref ("prod-bucket/dir/f.txt")',
      },
    ],
    "S3Client.file()": [
      { via: "S3Client.file", client: aws },
      {
        url: "prod-bucket.s3.us-east-1.amazonaws.com/dir/f.txt",
        bucket: "prod-bucket",
        file: 'S3Ref ("prod-bucket/dir/f.txt")',
      },
    ],
    "Bun.file()": [
      { via: "Bun.file", client: aws, key: "s3://scratch-bucket/dir/f.txt" },
      {
        url: "prod-bucket.s3.us-east-1.amazonaws.com/scratch-bucket/dir/f.txt",
        bucket: "prod-bucket",
        file: 'S3Ref ("prod-bucket/scratch-bucket/dir/f.txt")',
      },
    ],
    "file.slice()": [
      { via: "slice", client: aws },
      {
        url: "prod-bucket.s3.us-east-1.amazonaws.com/dir/f.txt",
        bucket: "prod-bucket",
        file: 'S3Ref ("prod-bucket/dir/f.txt")',
        client: 'S3Client ("prod-bucket")',
      },
    ],
  },
);

testCases(
  "S3_BUCKET and S3_ENDPOINT in the environment",
  { S3_BUCKET: "env-bucket", S3_ENDPOINT: aws.endpoint },
  {
    "path style: the bucket of the environment": [
      {},
      {
        url: "prod-bucket.s3.us-east-1.amazonaws.com/env-bucket/dir/f.txt",
        bucket: "env-bucket",
        file: 'S3Ref ("env-bucket/dir/f.txt")',
        client: 'S3Client ("env-bucket")',
      },
    ],
    "virtual-hosted style: the bucket in the host of the endpoint": [
      { client: virtualHosted },
      {
        url: "prod-bucket.s3.us-east-1.amazonaws.com/dir/f.txt",
        bucket: "prod-bucket",
        file: 'S3Ref ("prod-bucket/dir/f.txt")',
        client: 'S3Client ("prod-bucket")',
      },
    ],
    "virtual-hosted style, endpoint option with a host that names no bucket": [
      { client: { ...virtualHosted, endpoint: "https://files.example.com" } },
      { url: "files.example.com/dir/f.txt", bucket: null, file: 'S3Ref ("dir/f.txt")', client: "S3Client" },
    ],
    "Bun.s3.file(), virtual-hosted style": [
      { via: "Bun.s3.file", client: virtualHosted },
      {
        url: "prod-bucket.s3.us-east-1.amazonaws.com/dir/f.txt",
        bucket: "prod-bucket",
        file: 'S3Ref ("prod-bucket/dir/f.txt")',
      },
    ],
  },
);
