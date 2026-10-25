import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";
import { DEFAULT_CREDENTIALS, S3Server, serve, SigningClient, spawnServer, type RequestRecord } from "../index.ts";
import { parseBucketOption } from "../src/spawn.ts";
import { expectError, start, toObject, xml } from "./helpers.ts";

/** True when the server answers at the URL. Another program can have the port after the server released it. */
function answers(url: string): Promise<boolean> {
  return fetch(url).then(
    response => response.headers.has("x-amz-request-id"),
    () => false,
  );
}

describe("S3Server", () => {
  test("serve() listens on a free port with the default credentials", async () => {
    await using server = serve();
    expect(server.listening).toBe(true);
    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
    expect(server.virtualHostedUrl("my-bucket")).toBe(`http://my-bucket.localhost:${server.port}`);
    expect(server.clientOptions("my-bucket")).toEqual({
      endpoint: server.url,
      ...DEFAULT_CREDENTIALS,
      bucket: "my-bucket",
    });
    expect(server.region).toBe("us-east-1");
  });

  test("the options make buckets and credentials", async () => {
    await using server = serve({
      region: "eu-west-1",
      credentials: [
        { accessKeyId: "first", secretAccessKey: "first-secret" },
        { accessKeyId: "second", secretAccessKey: "second-secret", sessionToken: "token" },
      ],
      buckets: ["plain", { name: "versioned", versioning: "Enabled" }, { name: "locked", objectLock: true }],
    });
    expect(server.clientOptions()).toEqual({
      endpoint: server.url,
      accessKeyId: "first",
      secretAccessKey: "first-secret",
      region: "eu-west-1",
    });
    expect([...server.buckets.values()].map(bucket => [bucket.name, bucket.region, bucket.versioning])).toEqual([
      ["plain", "eu-west-1", undefined],
      ["versioned", "eu-west-1", "Enabled"],
      ["locked", "eu-west-1", "Enabled"],
    ]);
    expect(() => server.createBucket("plain")).toThrow('The bucket "plain" exists');
    expect(() => server.createBucket("Not_Valid")).toThrow('"Not_Valid" is not a valid bucket name');
    expect(() => server.createBucket({ name: "nowhere", region: "" })).toThrow(
      'The bucket "nowhere" has an empty region',
    );

    for (const [accessKeyId, secretAccessKey, sessionToken] of [
      ["first", "first-secret", undefined],
      ["second", "second-secret", "token"],
    ] as const) {
      const client = new SigningClient({
        endpoint: server.url,
        accessKeyId,
        secretAccessKey,
        sessionToken,
        region: "eu-west-1",
      });
      const response = await client.fetch("GET", "/");
      expect(response.status).toBe(200);
      expect(toObject(await xml(response)).Buckets.Bucket.map((bucket: any) => bucket.Name)).toEqual([
        "locked",
        "plain",
        "versioned",
      ]);
    }
  });

  test("Bun.S3Client does each of its operations against the server", async () => {
    await using t = start();
    const file = t.s3.file("folder/hello.txt");
    expect(await file.exists()).toBe(false);
    expect(await file.write("Hello Bun!", { type: "text/plain" })).toBe(10);
    expect(await file.text()).toBe("Hello Bun!");
    expect(await file.slice(6, 10).text()).toBe("Bun!");
    expect(await file.slice(6).text()).toBe("Bun!");

    const { size, type, etag, lastModified } = await file.stat();
    expect({ size, type, etag }).toEqual({
      size: 10,
      type: "text/plain;charset=utf-8",
      etag: `"${new Bun.CryptoHasher("md5").update("Hello Bun!").digest("hex")}"`,
    });
    expect(lastModified).toBeValidDate();

    expect(await (await fetch(file.presign())).text()).toBe("Hello Bun!");
    const upload = await fetch(t.s3.presign("presigned.txt", { method: "PUT" }), { method: "PUT", body: "abc" });
    expect(upload.status).toBe(200);
    expect(await t.s3.file("presigned.txt").text()).toBe("abc");

    const list = await t.s3.list({ prefix: "folder/" });
    expect(list.contents?.map(({ key, size }) => ({ key, size }))).toEqual([{ key: "folder/hello.txt", size: 10 }]);

    await file.delete();
    expect(await file.exists()).toBe(false);
    await expect(file.text()).rejects.toMatchObject({ name: "S3Error", code: "NoSuchKey" });
  });

  test("a multipart upload of Bun.S3Client makes one object", async () => {
    await using t = start();
    const part = Buffer.alloc(5 * 1024 * 1024, "a");
    const writer = t.s3.file("large.bin").writer({ partSize: part.length, queueSize: 2 });
    writer.write(part);
    writer.write(part);
    writer.write("tail");
    await writer.end();

    const partDigest = new Bun.CryptoHasher("md5").update(part).digest();
    const tailDigest = new Bun.CryptoHasher("md5").update("tail").digest();
    const etag =
      new Bun.CryptoHasher("md5").update(Buffer.concat([partDigest, partDigest, tailDigest])).digest("hex") + "-3";
    const stat = await t.s3.file("large.bin").stat();
    expect({ size: stat.size, etag: stat.etag }).toEqual({ size: part.length * 2 + 4, etag: `"${etag}"` });
    expect(
      await t.s3
        .file("large.bin")
        .slice(part.length * 2 - 2)
        .text(),
    ).toBe("aatail");
    expect(t.server.requests.map(request => request.operation)).toEqual([
      "CreateMultipartUpload",
      "UploadPart",
      "UploadPart",
      "UploadPart",
      "CompleteMultipartUpload",
      "HeadObject",
      "GetObject",
    ]);
    expect(t.server.buckets.get(t.bucket)!.uploads.size).toBe(0);
  });

  test("Bun.S3Client gets the error codes of S3", async () => {
    await using t = start();
    const options = t.server.clientOptions(t.bucket);
    const attempts = {
      InvalidAccessKeyId: () => new Bun.S3Client({ ...options, accessKeyId: "unknown" }).write("key", "data"),
      SignatureDoesNotMatch: () => new Bun.S3Client({ ...options, secretAccessKey: "wrong" }).write("key", "data"),
      NoSuchBucket: () => new Bun.S3Client({ ...options, bucket: "no-such-bucket" }).write("key", "data"),
      NoSuchKey: () => t.s3.file("no-such-key").text(),
    };
    const codes = await Promise.all(
      Object.values(attempts).map(attempt =>
        attempt().then(
          () => "no error",
          error => `${error.name} ${error.code}`,
        ),
      ),
    );
    expect(codes).toEqual(Object.keys(attempts).map(code => `S3Error ${code}`));
  });

  test("fetch() is the server as a function, for a caller that has its own listener", async () => {
    const s3 = new S3Server({ buckets: ["wrapped"] });
    expect(s3.listening).toBe(false);
    expect(() => s3.url).toThrow("The server does not listen");

    let failNext = false;
    await using listener = Bun.serve({
      port: 0,
      fetch(request, server) {
        if (failNext) {
          failNext = false;
          return new Response(
            "<Error><Code>SlowDown</Code><Message>Please reduce your request rate.</Message></Error>",
            {
              status: 503,
              headers: { "content-type": "application/xml" },
            },
          );
        }
        return s3.fetch(request, server);
      },
    });
    const client = new Bun.S3Client({
      ...DEFAULT_CREDENTIALS,
      endpoint: `http://127.0.0.1:${listener.port}`,
      bucket: "wrapped",
    });
    await client.write("key", "data");
    failNext = true;
    await expect(client.file("key").text()).rejects.toMatchObject({ code: "SlowDown" });
    expect(await client.file("key").text()).toBe("data");
  });

  test("the request log and the onRequest function see each request", async () => {
    const seen: RequestRecord[] = [];
    await using t = start({ maxRequestLog: 2, onRequest: record => seen.push(record) });
    await t.s3.write("a", "1");
    await t.s3.file("a").text();
    await t.s3.file("missing").exists();
    const summary = (records: RequestRecord[]) =>
      records.map(({ operation, method, bucket, key, status, errorCode }) => ({
        operation,
        method,
        bucket,
        key,
        status,
        errorCode,
      }));
    const all = [
      { operation: "PutObject", method: "PUT", bucket: t.bucket, key: "a", status: 200, errorCode: undefined },
      { operation: "GetObject", method: "GET", bucket: t.bucket, key: "a", status: 200, errorCode: undefined },
      {
        operation: "HeadObject",
        method: "HEAD",
        bucket: t.bucket,
        key: "missing",
        status: 404,
        errorCode: "NoSuchKey",
      },
    ];
    expect(summary(seen)).toEqual(all);
    expect(summary(t.server.requests)).toEqual(all.slice(1));
    expect(seen[0].headers.get("x-amz-content-sha256")).toBe("UNSIGNED-PAYLOAD");
    expect(seen[0].requestId).toMatch(/^[0-9A-F]{16}$/);
  });

  test("the clock option sets the time of the server", async () => {
    let now = new Date("2020-02-03T04:05:06.000Z");
    await using t = start({ clock: () => now });
    // The clock of the client is the clock of the server.
    const put = await t.client.fetch("PUT", `/${t.bucket}/key`, { body: "data" });
    expect(put.status).toBe(200);
    expect(put.headers.get("date")).toBe("Mon, 03 Feb 2020 04:05:06 GMT");
    const head = await t.client.fetch("HEAD", `/${t.bucket}/key`);
    expect(head.headers.get("last-modified")).toBe("Mon, 03 Feb 2020 04:05:06 GMT");

    const url = t.client.presign("GET", `/${t.bucket}/key`, { expiresIn: 60 });
    now = new Date(now.getTime() + 60_000);
    expect((await fetch(url)).status).toBe(200);
    now = new Date(now.getTime() + 1000);
    const expired = await expectError(await fetch(url), 403, "AccessDenied");
    expect(expired.Message).toBe("Request has expired");
  });

  test("stop() closes the listener and keeps the buckets", async () => {
    await using server = serve({ buckets: ["kept"] });
    const url = server.url;
    expect(await answers(url)).toBe(true);
    await server.stop();
    expect([server.listening, await answers(url)]).toEqual([false, false]);
    expect([...server.buckets.keys()]).toEqual(["kept"]);
    server.listen();
    expect((await fetch(server.url + "/kept", { method: "HEAD" })).status).toBe(403);
  });

  test("listen() refuses a port that another server has", async () => {
    await using first = serve();
    expect(() => serve({ port: first.port })).toThrow(`Is port ${first.port} in use?`);
  });
});

test("the --bucket option of the program is a name, or a name and a region", () => {
  const values = ["name", "name@eu-west-1", "name@", "@eu-west-1", "name@eu-west-1@more", ""];
  expect(values.map(parseBucketOption)).toEqual([
    { name: "name" },
    { name: "name", region: "eu-west-1" },
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
});

describe.concurrent("the server as a process", () => {
  test("spawnServer() starts it and stop() ends it", async () => {
    let url: string;
    {
      await using server = await spawnServer({
        bunExe: bunExe(),
        env: bunEnv,
        buckets: ["spawned", { name: "far", region: "eu-west-1" }],
        region: "ap-south-1",
        credentials: { accessKeyId: "key", secretAccessKey: "secret" },
      });
      url = server.url;
      expect(server.clientOptions("spawned")).toEqual({
        endpoint: server.url,
        accessKeyId: "key",
        secretAccessKey: "secret",
        region: "ap-south-1",
        bucket: "spawned",
      });
      const client = new Bun.S3Client(server.clientOptions("spawned"));
      await client.write("key", "from another process");
      expect(await client.file("key").text()).toBe("from another process");
      const wrongRegion = new Bun.S3Client({ ...server.clientOptions("spawned"), region: "us-east-1" });
      await expect(wrongRegion.file("key").text()).rejects.toMatchObject({ code: "AuthorizationHeaderMalformed" });
      const far = new Bun.S3Client(server.clientOptions("far"));
      await expect(far.file("key").text()).rejects.toMatchObject({ code: "PermanentRedirect" });
      expect(await answers(url)).toBe(true);
    }
    expect(await answers(url)).toBe(false);
  });

  test("spawnServer() rejects when the program cannot start", async () => {
    const options = { bunExe: bunExe(), env: bunEnv, stderr: "ignore" } as const;
    await expect(spawnServer({ ...options, buckets: ["Not_A_Bucket_Name"] })).rejects.toThrow(
      "The s3-server process ended before it listened",
    );
    await expect(spawnServer({ ...options, startTimeout: 1 })).rejects.toThrow(
      "The s3-server process did not listen after 1 ms",
    );
  });

  test("the program stops when its stdin closes", async () => {
    await using child = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "..", "cli.ts"), "--port", "0", "--exit-on-stdin-close", "--log"],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = child.stdout.getReader();
    let output = "";
    while (!output.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      output += new TextDecoder().decode(value);
    }
    const { url, port, accessKeyId } = JSON.parse(output);
    expect({ url, accessKeyId }).toEqual({
      url: `http://127.0.0.1:${port}`,
      accessKeyId: DEFAULT_CREDENTIALS.accessKeyId,
    });
    expect((await fetch(url)).status).toBe(403);

    child.stdin.end();
    const [stderr, exitCode] = await Promise.all([child.stderr.text(), child.exited]);
    expect(stderr).toBe(`GET ${url}/ ListBuckets 403 AccessDenied\n`);
    expect(exitCode).toBe(0);
  });

  test.each([
    ["--port", "not-a-port", '"not-a-port" is not a port', "\nUsage: bun cli.ts [options]"],
    ["--bucket", "name@", '"name@" is not <name> or <name>@<region>', "\nUsage: bun cli.ts [options]"],
    // The option has the right form and the server refuses its value. The program prints the error only.
    ["--bucket", "Not_Valid", '"Not_Valid" is not a valid bucket name', ""],
  ])("the program refuses %s %s", async (option, value, message, then) => {
    await using child = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "..", "cli.ts"), "--port", "0", option, value],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    expect(stdout).toBe("");
    expect(stderr.split("\n", 3).join("\n")).toBe(`${message}\n${then}`);
    expect(exitCode).toBe(1);
  });

  test("a program that ends without a call to stop() does not wait for the server", async () => {
    // The timer does not keep the program alive. It ends a program that waits for the server.
    const program = `
      import { spawnServer } from ${JSON.stringify(join(import.meta.dir, "..", "index.ts"))};
      const server = await spawnServer();
      console.log(server.url);
      setTimeout(() => process.exit(2), 2000).unref();
    `;
    await using child = Bun.spawn({ cmd: [bunExe(), "-e", program], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    // The server has the stderr of the program. This pipe closes when the two processes ended.
    const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/^http:\/\/127\.0\.0\.1:\d+\n$/);
    expect(exitCode).toBe(0);
    expect(await answers(stdout.trim())).toBe(false);
  });
});
