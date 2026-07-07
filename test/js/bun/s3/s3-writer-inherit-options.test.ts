import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// S3File.writer() with no argument must honor the partSize / queueSize / retry /
// storageClass configured on the S3Client or S3File, the same way writer({}) does.
// Runs in a subprocess because the S3 client does not honor NO_PROXY, so an
// inherited proxy would hijack requests to the local stub server.

type Scenario = {
  clientOptions: string;
  fileOptions: string;
  writerArg: string;
  failFirstAttempt?: boolean;
};

function fixture({ clientOptions, fileOptions, writerArg, failFirstAttempt }: Scenario) {
  return `
const MiB = 1024 * 1024;
const parts = [];
const attempts = new Map();
let initStorageClass = null;
await using server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.searchParams.has("uploads")) {
      initStorageClass = req.headers.get("x-amz-storage-class");
      return new Response(
        '<InitiateMultipartUploadResult><Bucket>b</Bucket><Key>k</Key><UploadId>up1</UploadId></InitiateMultipartUploadResult>',
        { status: 200, headers: { "Content-Type": "text/xml" } },
      );
    }
    if (req.method === "PUT" && url.searchParams.has("partNumber")) {
      const partNumber = Number(url.searchParams.get("partNumber"));
      const key = "p" + partNumber;
      const attempt = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, attempt);
      const bytes = (await req.arrayBuffer()).byteLength;
      parts.push({ partNumber, bytes, attempt });
      ${
        failFirstAttempt
          ? `if (attempt === 1) {
        return new Response(
          '<Error><Code>InternalError</Code><Message>x</Message></Error>',
          { status: 500, headers: { "Content-Type": "text/xml" } },
        );
      }`
          : ""
      }
      return new Response(undefined, { status: 200, headers: { ETag: '"p' + partNumber + '"' } });
    }
    if (req.method === "POST" && url.searchParams.has("uploadId")) {
      return new Response(
        '<CompleteMultipartUploadResult><Location>x</Location><Bucket>b</Bucket><Key>k</Key><ETag>"e"</ETag></CompleteMultipartUploadResult>',
        { status: 200, headers: { "Content-Type": "text/xml" } },
      );
    }
    if (req.method === "DELETE" && url.searchParams.has("uploadId")) {
      return new Response(undefined, { status: 204 });
    }
    return new Response(undefined, { status: 200 });
  },
});

const client = new Bun.S3Client({
  accessKeyId: "test",
  secretAccessKey: "test",
  region: "us-east-1",
  bucket: "b",
  endpoint: server.url.href,
  ${clientOptions}
});
const writer = client.file("k"${fileOptions ? `, { ${fileOptions} }` : ""}).writer(${writerArg});
writer.write(new Uint8Array(6 * MiB + 16));
let end;
try {
  await writer.end();
  end = "resolved";
} catch (e) {
  end = "rejected:" + (e?.code ?? e?.name);
}
parts.sort((a, b) => a.partNumber - b.partNumber || a.attempt - b.attempt);
console.log(JSON.stringify({ end, initStorageClass, parts }));
`;
}

const env = {
  ...bunEnv,
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  http_proxy: undefined,
  https_proxy: undefined,
};

async function run(scenario: Scenario) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture(scenario)],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    throw new Error(`subprocess failed (exit ${exitCode}):\n${stderr}\n${stdout}`);
  }
  return JSON.parse(stdout.trim());
}

const MiB = 1024 * 1024;

describe("S3File.writer() with no argument inherits client options", () => {
  test.concurrent("partSize", async () => {
    const result = await run({
      clientOptions: "partSize: 6 * MiB, queueSize: 1,",
      fileOptions: "",
      writerArg: "",
    });
    expect(result).toEqual({
      end: "resolved",
      initStorageClass: null,
      parts: [
        { partNumber: 1, bytes: 6 * MiB, attempt: 1 },
        { partNumber: 2, bytes: 16, attempt: 1 },
      ],
    });
  });

  test.concurrent("storageClass", async () => {
    const result = await run({
      clientOptions: `storageClass: "GLACIER", queueSize: 1,`,
      fileOptions: "",
      writerArg: "",
    });
    expect(result.initStorageClass).toBe("GLACIER");
    expect(result.end).toBe("resolved");
  });

  test.concurrent("retry: 0", async () => {
    const result = await run({
      clientOptions: "retry: 0, queueSize: 1,",
      fileOptions: "",
      writerArg: "",
      failFirstAttempt: true,
    });
    expect(result.end).toBe("rejected:InternalError");
    expect(result.parts.every((p: { attempt: number }) => p.attempt === 1)).toBe(true);
  });
});

describe("S3File.writer() with no argument inherits file-level options", () => {
  test.concurrent("partSize", async () => {
    const result = await run({
      clientOptions: "",
      fileOptions: "partSize: 6 * MiB, queueSize: 1",
      writerArg: "",
    });
    expect(result).toEqual({
      end: "resolved",
      initStorageClass: null,
      parts: [
        { partNumber: 1, bytes: 6 * MiB, attempt: 1 },
        { partNumber: 2, bytes: 16, attempt: 1 },
      ],
    });
  });

  test.concurrent("storageClass", async () => {
    const result = await run({
      clientOptions: "",
      fileOptions: `storageClass: "GLACIER", queueSize: 1`,
      writerArg: "",
    });
    expect(result.initStorageClass).toBe("GLACIER");
    expect(result.end).toBe("resolved");
  });
});

describe("S3File.writer({}) with empty object inherits client options", () => {
  test.concurrent("partSize", async () => {
    const result = await run({
      clientOptions: "partSize: 6 * MiB, queueSize: 1,",
      fileOptions: "",
      writerArg: "{}",
    });
    expect(result).toEqual({
      end: "resolved",
      initStorageClass: null,
      parts: [
        { partNumber: 1, bytes: 6 * MiB, attempt: 1 },
        { partNumber: 2, bytes: 16, attempt: 1 },
      ],
    });
  });
});
