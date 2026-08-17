import type { Server } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tempDir, tls } from "harness";
import { join } from "path";
import { referencePresignCheck, referenceSign, sha256Hex } from "./sigv4-reference";

// In-process tests: every request carries explicit credentials so nothing
// ambient (env, ~/.aws, instance metadata) is consulted.
const accessKeyId = "AKIDEXAMPLE";
const secretAccessKey = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";
const datetime = "20150830T123600Z";

let echo: Server;
type Echo = { method: string; url: string; headers: Record<string, string>; body: string };

beforeAll(() => {
  echo = Bun.serve({
    port: 0,
    async fetch(req) {
      return Response.json({
        method: req.method,
        url: req.url,
        headers: Object.fromEntries(req.headers),
        body: await req.text(),
      } satisfies Echo);
    },
  });
});
afterAll(() => echo?.stop(true));

async function signedFetch(path: string, { aws, ...init }: RequestInit & { aws: any }): Promise<Echo> {
  const res = await Bun.aws.fetch(new URL(path, echo.url), { ...init, ...aws });
  expect(res.status).toBe(200);
  return res.json();
}

describe("Bun.aws.fetch", () => {
  test("matches the AWS SigV4 test-suite vector (get-vanilla)", async () => {
    // Host must be example.amazonaws.com for the published signature, so
    // sign against that Host header while sending to the local echo server.
    const hit = await signedFetch("/", {
      headers: { Host: "example.amazonaws.com" },
      aws: { accessKeyId, secretAccessKey, service: "service", region: "us-east-1", signingDate: datetime },
    });
    expect(hit.headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
    expect(hit.headers["x-amz-date"]).toBe(datetime);
    // Only S3 wants x-amz-content-sha256 on the wire (and any x-amz-* header
    // that is sent has to be signed, which would break the published vector).
    expect(hit.headers["x-amz-content-sha256"]).toBeUndefined();
  });

  test("POST with body, query string, extra signed headers and a session token", async () => {
    const body = JSON.stringify({ TableName: "t", Key: { id: { S: "1" } } });
    const headers = {
      "Content-Type": "application/x-amz-json-1.0",
      "X-Amz-Target": "DynamoDB_20120810.GetItem",
      "X-Custom": "  spaced   value ",
    };
    const path = "/some/path/../other?b=2&a=1&a=0&empty=&%C3%A9=%20x";
    const hit = await signedFetch(path, {
      method: "POST",
      body,
      headers,
      aws: {
        accessKeyId,
        secretAccessKey,
        sessionToken: "session/token+with=chars",
        service: "dynamodb",
        region: "us-west-2",
        signingDate: datetime,
      },
    });
    const expected = referenceSign({
      method: "POST",
      url: new URL(path, echo.url).href,
      headers,
      body,
      service: "dynamodb",
      region: "us-west-2",
      accessKeyId,
      secretAccessKey,
      sessionToken: "session/token+with=chars",
      datetime,
    });
    expect(hit.headers.authorization).toBe(expected.authorization);
    expect(hit.headers["x-amz-security-token"]).toBe("session/token+with=chars");
    expect(hit.body).toBe(body);
  });

  test("s3 semantics: single-encoded path, x-amz-content-sha256 signed, unsignedPayload", async () => {
    const path = "/my bucket/key with spaces/ünïcode/(parens)!.txt?versionId=abc";
    for (const unsignedPayload of [false, true]) {
      const hit = await signedFetch(path, {
        method: "PUT",
        body: "payload",
        aws: {
          accessKeyId,
          secretAccessKey,
          service: "s3",
          region: "eu-west-1",
          signingDate: datetime,
          unsignedPayload,
        },
      });
      const expected = referenceSign({
        method: "PUT",
        url: new URL(path, echo.url).href,
        body: "payload",
        service: "s3",
        region: "eu-west-1",
        accessKeyId,
        secretAccessKey,
        datetime,
        unsignedPayload,
      });
      expect(hit.headers.authorization).toBe(expected.authorization);
      expect(hit.headers["x-amz-content-sha256"]).toBe(unsignedPayload ? "UNSIGNED-PAYLOAD" : sha256Hex("payload"));
    }
  });

  test("service and region are inferred from *.amazonaws.com hostnames", async () => {
    const cases: [string, string, string][] = [
      ["sqs.us-east-2.amazonaws.com", "sqs", "us-east-2"],
      ["my-bucket.s3.ap-southeast-1.amazonaws.com", "s3", "ap-southeast-1"],
      ["iam.amazonaws.com", "iam", "us-east-1"],
      ["bedrock-runtime.eu-central-1.amazonaws.com", "bedrock", "eu-central-1"], // signing name differs from the host label
      ["abc123.execute-api.us-west-1.amazonaws.com", "execute-api", "us-west-1"],
      ["xyz.lambda-url.eu-west-1.on.aws", "lambda", "eu-west-1"],
    ];
    for (const [host, service, region] of cases) {
      const hit = await signedFetch("/", {
        headers: { Host: host },
        aws: { accessKeyId, secretAccessKey, signingDate: datetime },
      });
      expect(hit.headers.authorization).toContain(`/${region}/${service}/aws4_request`);
    }
  });

  test("errors: cannot infer, streaming body, reserved headers, half credentials", async () => {
    const base = { accessKeyId, secretAccessKey };
    await expect(Bun.aws.fetch(echo.url, base)).rejects.toThrow(/cannot tell which AWS service/);
    await expect(Bun.aws.fetch(echo.url, { ...base, service: "sqs" })).rejects.toThrow(/cannot tell which AWS region/);
    await expect(
      Bun.aws.fetch(echo.url, {
        method: "POST",
        body: new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("x"));
            c.close();
          },
        }),
        ...base,
        service: "sqs",
        region: "us-east-1",
      }),
    ).rejects.toThrow(/streaming request body cannot be SigV4-signed/);
    await expect(
      Bun.aws.fetch(echo.url, {
        headers: { Authorization: "Bearer x" },
        ...base,
        service: "sqs",
        region: "us-east-1",
      }),
    ).rejects.toThrow(/"Authorization" header is generated by request signing/i);
    await expect(Bun.aws.fetch(echo.url, { accessKeyId: "x", service: "sqs", region: "us-east-1" })).rejects.toThrow(
      /must be given together/,
    );
    await expect(Bun.aws.fetch(echo.url, { ...base, service: "bad service!" })).rejects.toThrow(
      /not a valid AWS service/,
    );
    // signingDate: a Date, epoch ms, or an x-amz-date string; nothing else, nothing x-amz-date can't spell
    const s3 = { ...base, service: "s3", region: "us-east-1" };
    for (const signingDate of [
      {},
      true,
      -1,
      1e21,
      NaN,
      Infinity,
      -Infinity,
      new Date(NaN),
      new Date("+010000-01-01T00:00:00Z"),
      "20250101T000000\n",
      "20250230T000000Z",
      "20250101T000000z",
      "nope",
    ]) {
      expect(() => Bun.aws.presign(echo.url, { ...s3, signingDate: signingDate as any })).toThrow(/signingDate/);
    }
    expect(await Bun.aws.presign(echo.url, { ...s3, signingDate: Date.UTC(2031, 0, 2, 3, 4, 5) })).toContain(
      "X-Amz-Date=20310102T030405Z",
    );
    expect(await Bun.aws.presign(echo.url, { ...s3, signingDate: 0 })).toContain("X-Amz-Date=19700101T000000Z");
    expect(await Bun.aws.presign(echo.url, { ...s3, signingDate: new Date(0) })).toContain(
      "X-Amz-Date=19700101T000000Z",
    );
  });

  test("streaming bodies to s3 are sent with UNSIGNED-PAYLOAD", async () => {
    const hit = await signedFetch("/bucket/key", {
      method: "PUT",
      body: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("streamed"));
          c.close();
        },
      }),
      aws: { accessKeyId, secretAccessKey, service: "s3", region: "us-east-1", signingDate: datetime },
    });
    expect(hit.body).toBe("streamed");
    expect(hit.headers["x-amz-content-sha256"]).toBe("UNSIGNED-PAYLOAD");
    const expected = referenceSign({
      method: "PUT",
      url: new URL("/bucket/key", echo.url).href,
      service: "s3",
      region: "us-east-1",
      accessKeyId,
      secretAccessKey,
      datetime,
      unsignedPayload: true,
    });
    expect(hit.headers.authorization).toBe(expected.authorization);
  });

  test("signQuery puts the signature in the URL and leaves headers alone", async () => {
    const hit = await signedFetch("/queue/url?Action=SendMessage&MessageBody=hi%20there", {
      aws: {
        accessKeyId,
        secretAccessKey,
        sessionToken: "tok",
        service: "sqs",
        region: "us-east-1",
        signQuery: true,
        expiresIn: 90,
        signingDate: datetime,
      },
    });
    expect(hit.headers.authorization).toBeUndefined();
    const url = new URL(hit.url);
    expect(url.searchParams.get("Action")).toBe("SendMessage");
    expect(url.searchParams.get("MessageBody")).toBe("hi there");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Credential")).toBe("AKIDEXAMPLE/20150830/us-east-1/sqs/aws4_request");
    expect(url.searchParams.get("X-Amz-Date")).toBe(datetime);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("90");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url.searchParams.get("X-Amz-Security-Token")).toBe("tok");
    const { expected, actual } = referencePresignCheck(hit.url, {
      service: "sqs",
      region: "us-east-1",
      secretAccessKey,
    });
    expect(actual).toBe(expected);
  });

  test("one-character path segments survive (canonical URI must not collapse to /)", async () => {
    for (const path of ["/a", "/a/", "/a/b", "/ab"]) {
      const hit = await signedFetch(path, {
        aws: { accessKeyId, secretAccessKey, service: "s3", region: "us-east-1", signingDate: datetime },
      });
      expect(new URL(hit.url).pathname).toBe(path);
      expect(hit.headers.authorization).toBe(
        referenceSign({
          method: "GET",
          url: new URL(path, echo.url).href,
          service: "s3",
          region: "us-east-1",
          accessKeyId,
          secretAccessKey,
          datetime,
          unsignedPayload: false,
        }).authorization,
      );
    }
    expect(
      new URL(await Bun.aws.presign("https://bkt.s3.amazonaws.com/a", { accessKeyId, secretAccessKey })).pathname,
    ).toBe("/a");
  });

  test("s3:// URLs are rejected (use fetch's s3 option / Bun.s3)", async () => {
    await expect(Bun.aws.fetch("s3://bucket/key", { accessKeyId, secretAccessKey })).rejects.toThrow(/s3:\/\/ URLs/);
  });

  test("relative URLs go to the service's standard regional endpoint", async () => {
    // Route the request over a unix socket so we can see which Host was built
    // without touching the network.
    using dir = tempDir("aws-rel", {});
    const unix = join(dir, "s.sock");
    using server = Bun.serve({
      unix,
      tls,
      fetch: req =>
        Response.json({ host: req.headers.get("host"), path: new URL(req.url).pathname + new URL(req.url).search }),
    });
    const via = { accessKeyId, secretAccessKey, unix, tls: { rejectUnauthorized: false } } as const;
    const seen = async (path: string, opts: object) => (await Bun.aws.fetch(path, { ...via, ...opts })).json();
    expect(await seen("/?Action=ListQueues", { service: "sqs", region: "us-west-2" })).toEqual({
      host: "sqs.us-west-2.amazonaws.com",
      path: "/?Action=ListQueues",
    });
    expect((await seen("/", { service: "dynamodb", region: "cn-north-1" })).host).toBe(
      "dynamodb.cn-north-1.amazonaws.com.cn",
    );
    expect((await seen("/", { service: "iam", region: "eu-west-1" })).host).toBe("iam.amazonaws.com");
    expect((await seen("/v2/email", { service: "ses", region: "us-east-1" })).host).toBe(
      "email.us-east-1.amazonaws.com",
    );
    await expect(Bun.aws.fetch("/?Action=ListQueues", { accessKeyId, secretAccessKey })).rejects.toThrow(
      /needs `service`/,
    );
    await expect(Bun.aws.fetch("/", { accessKeyId, secretAccessKey, service: "sqs" })).rejects.toThrow(
      /pass `region` or set AWS_REGION/,
    );
    await expect(
      Bun.aws.fetch("/", { accessKeyId, secretAccessKey, service: "lambda", region: "us-east-1" }),
    ).rejects.toThrow(/per-resource/);
  });

  test("a large file body is hashed, not sent via sendfile", async () => {
    using dir = tempDir("aws-sendfile", { "big.bin": Buffer.alloc(256 * 1024, "x").toString() });
    const hit = await signedFetch("/upload", {
      method: "PUT",
      body: Bun.file(join(dir, "big.bin")),
      aws: { accessKeyId, secretAccessKey, service: "execute-api", region: "us-east-1", signingDate: datetime },
    });
    expect(hit.body.length).toBe(256 * 1024);
    expect(hit.headers.authorization).toBe(
      referenceSign({
        method: "PUT",
        url: new URL("/upload", echo.url).href,
        headers: { "content-type": hit.headers["content-type"] },
        body: Buffer.alloc(256 * 1024, "x").toString(),
        service: "execute-api",
        region: "us-east-1",
        accessKeyId,
        secretAccessKey,
        datetime,
      }).authorization,
    );
  });

  test("a pre-aborted signal rejects immediately, before any credential lookup", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(Bun.aws.fetch(echo.url, { signal: ac.signal })).rejects.toThrow(/aborted/i);
    // …also when the region (relative URL) would have to come from the credential chain,
    // and an invalid signal is a TypeError rather than a reason to go looking.
    await expect(Bun.aws.fetch("/x", { service: "dynamodb", signal: ac.signal })).rejects.toThrow(/aborted/i);
    await expect(Bun.aws.fetch("/x", { service: "dynamodb", signal: 42 as any })).rejects.toThrow(/AbortSignal/);
    await expect(Bun.aws.fetch(echo.url, { signal: 42 as any })).rejects.toThrow(/AbortSignal/);
    // init.signal is validated even when the Request already carries an aborted one
    await expect(Bun.aws.fetch(new Request(echo.url, { signal: ac.signal }), { signal: 42 as any })).rejects.toThrow(
      /AbortSignal/,
    );
    // the lone-init-dict call shape carries auth options too, and a 2nd init overlays it per field
    const viaInit = await Bun.aws.fetch({
      url: echo.url.href,
      accessKeyId,
      secretAccessKey,
      service: "s3",
      region: "us-east-1",
    } as any);
    expect((await viaInit.json()).headers.authorization).toStartWith(`AWS4-HMAC-SHA256 Credential=${accessKeyId}/`);
    const overlaid = await Bun.aws.fetch(
      { url: echo.url.href, accessKeyId, secretAccessKey, service: "s3", region: "us-east-1" } as any,
      { region: "eu-west-1", headers: { "x-extra": "1" } } as any,
    );
    const seen = (await overlaid.json()).headers;
    expect(seen.authorization).toContain(`Credential=${accessKeyId}/`);
    expect(seen.authorization).toContain("/eu-west-1/s3/aws4_request");
    expect(seen["x-extra"]).toBe("1");
    // init.signal: null detaches the Request's signal (as in plain fetch)
    const res = await Bun.aws.fetch(new Request(echo.url, { signal: ac.signal }), {
      accessKeyId,
      secretAccessKey,
      service: "s3",
      region: "us-east-1",
      signal: null,
    });
    expect(res.status).toBe(200);
  });

  test("signQuery to S3 with a body signs UNSIGNED-PAYLOAD (what S3 verifies)", async () => {
    const hit = await signedFetch("/bucket/key", {
      method: "PUT",
      body: "hello",
      aws: { accessKeyId, secretAccessKey, service: "s3", region: "us-east-1", signQuery: true, signingDate: datetime },
    });
    expect(hit.body).toBe("hello");
    expect(hit.headers.authorization).toBeUndefined();
    const { expected, actual } = referencePresignCheck(hit.url, {
      method: "PUT",
      service: "s3",
      region: "us-east-1",
      secretAccessKey,
    });
    expect(actual).toBe(expected);
  });

  test("signed requests do not follow redirects by default", async () => {
    using redirector = Bun.serve({
      port: 0,
      fetch: () => new Response(null, { status: 307, headers: { location: echo.url.href } }),
    });
    const base = { accessKeyId, secretAccessKey, service: "s3", region: "us-east-1" };
    const res = await Bun.aws.fetch(redirector.url, base);
    expect(res.status).toBe(307);
    const viaRequest = await Bun.aws.fetch(new Request(redirector.url), base);
    expect(viaRequest.status).toBe(307);
    const followed = await Bun.aws.fetch(redirector.url, { ...base, redirect: "follow" });
    expect(followed.status).toBe(200);
    // Following a cross-origin redirect drops the signature *and* the session token.
    const hop = await Bun.aws.fetch(redirector.url, { ...base, sessionToken: "temporary", redirect: "follow" });
    const seen = (await hop.json()).headers;
    expect(seen.authorization).toBeUndefined();
    expect(seen["x-amz-security-token"]).toBeUndefined();
    expect(seen["x-amz-date"]).toBeString(); // (non-secret signing headers may remain)
  });

  test("AWSClient instances carry their own defaults; per-call options override", async () => {
    const east = new Bun.AWSClient({
      accessKeyId,
      secretAccessKey,
      region: "us-east-1",
      service: "sqs",
      signingDate: datetime,
    });
    const west = new Bun.AWSClient({ accessKeyId: "AKIAOTHER", secretAccessKey, region: "us-west-2", service: "sqs" });
    expect(east).toBeInstanceOf(Bun.AWSClient);
    expect(Bun.aws).toBeInstanceOf(Bun.AWSClient);
    expect(east.region).toBe("us-east-1");
    expect(west.region).toBe("us-west-2");
    expect(east.profile).toBeUndefined();
    const a: Echo = await (await east.fetch(echo.url)).json();
    expect(a.headers.authorization).toContain("Credential=AKIDEXAMPLE/20150830/us-east-1/sqs/");
    const b: Echo = await (await west.fetch(echo.url, { signingDate: datetime })).json();
    expect(b.headers.authorization).toContain("Credential=AKIAOTHER/20150830/us-west-2/sqs/");
    const c: Echo = await (await east.fetch(echo.url, { region: "ap-south-1", service: "sns" })).json();
    expect(c.headers.authorization).toContain("/ap-south-1/sns/");
    expect(await east.credentials()).toEqual({ accessKeyId, secretAccessKey, source: "explicit" });
    expect((await west.credentials()).accessKeyId).toBe("AKIAOTHER");
    expect(
      new URL(await east.presign("https://bkt.s3.amazonaws.com/k")).searchParams.get("X-Amz-Credential"),
    ).toStartWith("AKIDEXAMPLE/");
    // endpoint: base URL for relative paths (LocalStack-style)
    const local = new Bun.AWSClient({
      accessKeyId,
      secretAccessKey,
      region: "us-east-1",
      service: "sqs",
      endpoint: echo.url.href,
    });
    const d: Echo = await (await local.fetch("/queue?Action=Purge")).json();
    expect(new URL(d.url).pathname + new URL(d.url).search).toBe("/queue?Action=Purge");
    // @ts-expect-error
    expect(() => new Bun.AWSClient("nope")).toThrow(/expected an options object/);
  });

  test("Request objects and the init-object form work too", async () => {
    const req = new Request(new URL("/from-request", echo.url), { method: "DELETE" });
    const hit: Echo = await (
      await Bun.aws.fetch(req, {
        accessKeyId,
        secretAccessKey,
        service: "sqs",
        region: "us-east-1",
        signingDate: datetime,
      })
    ).json();
    expect(hit.method).toBe("DELETE");
    expect(hit.headers.authorization).toBe(
      referenceSign({
        method: "DELETE",
        url: new URL("/from-request", echo.url).href,
        service: "sqs",
        region: "us-east-1",
        accessKeyId,
        secretAccessKey,
        datetime,
      }).authorization,
    );
  });
});

describe("Bun.aws.presign", () => {
  test("S3 object URL", async () => {
    const url = await Bun.aws.presign(
      "https://my-bucket.s3.eu-west-1.amazonaws.com/some dir/photo (1).jpg?versionId=3",
      {
        accessKeyId,
        secretAccessKey,
        sessionToken: "the token",
        expiresIn: 3600,
        signingDate: datetime,
      },
    );
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://my-bucket.s3.eu-west-1.amazonaws.com");
    expect(parsed.pathname).toBe("/some%20dir/photo%20%281%29.jpg");
    expect(parsed.searchParams.get("versionId")).toBe("3");
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(parsed.searchParams.get("X-Amz-Credential")).toBe("AKIDEXAMPLE/20150830/eu-west-1/s3/aws4_request");
    expect(parsed.searchParams.get("X-Amz-Security-Token")).toBe("the token");
    expect([...parsed.searchParams.keys()].at(-1)).toBe("X-Amz-Signature");
    const { expected, actual } = referencePresignCheck(url, { service: "s3", region: "eu-west-1", secretAccessKey });
    expect(actual).toBe(expected);
  });

  test("method, URL objects, non-S3 services, defaults", async () => {
    const put = await Bun.aws.presign(new URL("https://bucket.s3.amazonaws.com/upload.bin"), {
      accessKeyId,
      secretAccessKey,
      method: "PUT",
      signingDate: new Date("2015-08-30T12:36:00Z"),
    });
    expect(new URL(put).searchParams.get("X-Amz-Expires")).toBe("900");
    expect(new URL(put).searchParams.get("X-Amz-Date")).toBe(datetime);
    const { expected, actual } = referencePresignCheck(put, {
      method: "PUT",
      service: "s3",
      region: "us-east-1",
      secretAccessKey,
    });
    expect(actual).toBe(expected);

    const iot = await Bun.aws.presign("https://data-ats.iot.us-east-1.amazonaws.com/mqtt", {
      accessKeyId,
      secretAccessKey,
      service: "iotdevicegateway",
      region: "us-east-1",
      signingDate: datetime,
    });
    const check = referencePresignCheck(iot, { service: "iotdevicegateway", region: "us-east-1", secretAccessKey });
    expect(check.actual).toBe(check.expected);
  });

  test("validation", async () => {
    const base = { accessKeyId, secretAccessKey };
    // Argument errors throw synchronously; anything that needs credentials rejects.
    expect(() => Bun.aws.presign("ftp://x/y", base)).toThrow(/http: or https:/);
    expect(() => Bun.aws.presign("https://bucket.s3.amazonaws.com/k", { ...base, expiresIn: 0 })).toThrow(/expiresIn/);
    expect(() => Bun.aws.presign("https://bucket.s3.amazonaws.com/k", { ...base, expiresIn: 604801 })).toThrow(
      /expiresIn/,
    );
    // @ts-expect-error
    expect(() => Bun.aws.presign()).toThrow(/expects a URL/);
    expect(() => Bun.aws.presign("https://bucket.s3.amazonaws.com/k", { ...base, method: "NOPE" })).toThrow(/method/);
    await expect(Bun.aws.presign("https://localhost/k", base)).rejects.toThrow(/cannot tell which AWS service/);
    expect(Bun.aws.presign("https://bucket.s3.amazonaws.com/k", base)).toBeInstanceOf(Promise);
  });
});
