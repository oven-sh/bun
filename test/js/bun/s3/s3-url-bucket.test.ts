import { S3Client, type S3Options } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

// An explicit `s3://bucket/key` URL must address `bucket`, regardless of any
// bucket configured on the client, in per-file options, or via env vars.
// Previously the configured bucket silently won and the URL's bucket was
// demoted to a key prefix, so `s3://urlbkt/dir/f.txt` with `bucket: "cfgbkt"`
// requested `/cfgbkt/urlbkt/dir/f.txt`.

describe("s3:// URL bucket overrides configured bucket", () => {
  const creds: S3Options = {
    accessKeyId: "a",
    secretAccessKey: "b",
    region: "us-east-1",
  };

  function presignPath(opts: S3Options, key: string, fileOpts?: S3Options) {
    const client = new S3Client(opts);
    return new URL(client.presign(key, fileOpts)).pathname;
  }

  it("no configured bucket: s3:// URL bucket is honored", () => {
    expect(presignPath({ ...creds }, "s3://urlbkt/dir/f.txt")).toBe("/urlbkt/dir/f.txt");
  });

  it("configured bucket: s3:// URL bucket wins", () => {
    expect(presignPath({ ...creds, bucket: "cfgbkt" }, "s3://urlbkt/dir/f.txt")).toBe("/urlbkt/dir/f.txt");
  });

  it("per-file bucket option: s3:// URL bucket wins", () => {
    expect(presignPath({ ...creds, bucket: "cfgbkt" }, "s3://urlbkt/dir/f.txt", { bucket: "per" })).toBe(
      "/urlbkt/dir/f.txt",
    );
  });

  it("plain key with configured bucket: configured bucket is used", () => {
    expect(presignPath({ ...creds, bucket: "cfgbkt" }, "dir/f.txt")).toBe("/cfgbkt/dir/f.txt");
  });

  it("s3://name with no key separator is treated as a plain key", () => {
    expect(presignPath({ ...creds, bucket: "cfgbkt" }, "s3://onlyname")).toBe("/cfgbkt/onlyname");
  });

  it("s3://name/ and s3://name\\ (trailing separator, no key) are treated as plain keys", () => {
    expect(presignPath({ ...creds, bucket: "cfgbkt" }, "s3://onlyname/")).toBe("/cfgbkt/onlyname");
    expect(presignPath({ ...creds, bucket: "cfgbkt" }, "s3://onlyname\\")).toBe("/cfgbkt/onlyname");
  });

  it("uppercase S3:// scheme is recognized", () => {
    expect(presignPath({ ...creds, bucket: "cfgbkt" }, "S3://urlbkt/dir/f.txt")).toBe("/urlbkt/dir/f.txt");
  });

  it("configured bucket + virtualHostedStyle: s3:// URL bucket wins", () => {
    const client = new S3Client({ ...creds, bucket: "cfgbkt", virtualHostedStyle: true });
    const url = new URL(client.presign("s3://urlbkt/dir/f.txt"));
    expect({ host: url.host, path: url.pathname }).toEqual({
      host: "urlbkt.s3.us-east-1.amazonaws.com",
      path: "/dir/f.txt",
    });
  });

  it(".bucket property reflects the s3:// URL bucket", () => {
    const client = new S3Client({ ...creds, bucket: "cfgbkt" });
    expect(client.file("s3://urlbkt/dir/f.txt").bucket).toBe("urlbkt");
    expect(client.file("dir/f.txt").bucket).toBe("cfgbkt");
  });

  it.each(["S3_BUCKET", "AWS_BUCKET"])("Bun.file with s3:// URL: URL bucket wins over %s", async varName => {
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response(new URL(req.url).pathname, {
          headers: { etag: '"abc"' },
          status: 200,
        });
      },
    });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const f = Bun.file("s3://urlbkt/dir/f.txt", {
           accessKeyId: "a", secretAccessKey: "b", region: "us-east-1",
           endpoint: ${JSON.stringify(server.url.href)},
         });
         console.log(await f.text());
         console.log(f.bucket);`,
      ],
      env: {
        ...bunEnv,
        [varName]: "envbkt",
        HTTP_PROXY: undefined,
        HTTPS_PROXY: undefined,
        http_proxy: undefined,
        https_proxy: undefined,
      },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("/urlbkt/dir/f.txt\nurlbkt\n");
    expect(exitCode).toBe(0);
  });

  it("fetch with s3:// URL: URL bucket wins over s3.bucket option and env bucket", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response(new URL(req.url).pathname, {
          headers: { etag: '"abc"' },
          status: 200,
        });
      },
    });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const res = await fetch("s3://urlbkt/dir/f.txt", {
           s3: {
             accessKeyId: "a", secretAccessKey: "b", region: "us-east-1",
             endpoint: ${JSON.stringify(server.url.href)},
             bucket: "optbkt",
           },
         });
         console.log(await res.text());`,
      ],
      env: {
        ...bunEnv,
        S3_BUCKET: "envbkt",
        HTTP_PROXY: undefined,
        HTTPS_PROXY: undefined,
        http_proxy: undefined,
        https_proxy: undefined,
      },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("/urlbkt/dir/f.txt\n");
    expect(exitCode).toBe(0);
  });
});
