import type { Server } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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

async function signedFetch(path: string, init: RequestInit & { aws: any }): Promise<Echo> {
  const res = await fetch(new URL(path, echo.url), init as any);
  expect(res.status).toBe(200);
  return res.json();
}

describe("fetch(url, { aws })", () => {
  test("matches the AWS SigV4 test-suite vector (get-vanilla)", async () => {
    // Host must be example.amazonaws.com for the published signature, so
    // sign against that Host header while sending to the local echo server.
    const hit = await signedFetch("/", {
      headers: { Host: "example.amazonaws.com" },
      aws: { accessKeyId, secretAccessKey, service: "service", region: "us-east-1", date: datetime },
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
        date: datetime,
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
        aws: { accessKeyId, secretAccessKey, service: "s3", region: "eu-west-1", date: datetime, unsignedPayload },
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
      ["bedrock-runtime.eu-central-1.amazonaws.com", "bedrock-runtime", "eu-central-1"],
      ["abc123.execute-api.us-west-1.amazonaws.com", "execute-api", "us-west-1"],
      ["xyz.lambda-url.eu-west-1.on.aws", "lambda", "eu-west-1"],
    ];
    for (const [host, service, region] of cases) {
      const hit = await signedFetch("/", {
        headers: { Host: host },
        aws: { accessKeyId, secretAccessKey, date: datetime },
      });
      expect(hit.headers.authorization).toContain(`/${region}/${service}/aws4_request`);
    }
  });

  test("errors: cannot infer, streaming body, reserved headers, half credentials", async () => {
    const base = { accessKeyId, secretAccessKey };
    await expect(fetch(echo.url, { aws: base } as any)).rejects.toThrow(/cannot tell which AWS service/);
    await expect(fetch(echo.url, { aws: { ...base, service: "sqs" } } as any)).rejects.toThrow(
      /cannot tell which AWS region/,
    );
    await expect(
      fetch(echo.url, {
        method: "POST",
        body: new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("x"));
            c.close();
          },
        }),
        aws: { ...base, service: "sqs", region: "us-east-1" },
      } as any),
    ).rejects.toThrow(/streaming request body cannot be SigV4-signed/);
    await expect(
      fetch(echo.url, {
        headers: { Authorization: "Bearer x" },
        aws: { ...base, service: "sqs", region: "us-east-1" },
      } as any),
    ).rejects.toThrow(/"Authorization" header is generated by aws request signing/i);
    await expect(
      fetch(echo.url, { aws: { accessKeyId: "x", service: "sqs", region: "us-east-1" } } as any),
    ).rejects.toThrow(/must be given together/);
    // @ts-expect-error
    await expect(fetch(echo.url, { aws: "yes" })).rejects.toThrow(/aws must be true or an object/);
    await expect(fetch(echo.url, { aws: { ...base, service: "bad service!" } } as any)).rejects.toThrow(
      /not a valid AWS service/,
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
      aws: { accessKeyId, secretAccessKey, service: "s3", region: "us-east-1", date: datetime },
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
        date: datetime,
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

  test("Request objects and the init-object form work too", async () => {
    const req = new Request(new URL("/from-request", echo.url), { method: "DELETE" });
    const hit: Echo = await (
      await fetch(req, {
        aws: { accessKeyId, secretAccessKey, service: "sqs", region: "us-east-1", date: datetime },
      } as any)
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
  test("S3 object URL", () => {
    const url = Bun.aws.presign("https://my-bucket.s3.eu-west-1.amazonaws.com/some dir/photo (1).jpg?versionId=3", {
      accessKeyId,
      secretAccessKey,
      sessionToken: "the token",
      expiresIn: 3600,
      date: datetime,
    });
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

  test("method, URL objects, non-S3 services, defaults", () => {
    const put = Bun.aws.presign(new URL("https://bucket.s3.amazonaws.com/upload.bin"), {
      accessKeyId,
      secretAccessKey,
      method: "PUT",
      date: new Date("2015-08-30T12:36:00Z"),
    });
    expect(new URL(put).searchParams.get("X-Amz-Expires")).toBe("900");
    expect(new URL(put).searchParams.get("X-Amz-Date")).toBe(datetime);
    expect(
      referencePresignCheck(put, { method: "PUT", service: "s3", region: "us-east-1", secretAccessKey }),
    ).toMatchObject({
      actual: expect.any(String),
    });
    const { expected, actual } = referencePresignCheck(put, {
      method: "PUT",
      service: "s3",
      region: "us-east-1",
      secretAccessKey,
    });
    expect(actual).toBe(expected);

    const iot = Bun.aws.presign("https://data-ats.iot.us-east-1.amazonaws.com/mqtt", {
      accessKeyId,
      secretAccessKey,
      service: "iotdevicegateway",
      region: "us-east-1",
      date: datetime,
    });
    const check = referencePresignCheck(iot, { service: "iotdevicegateway", region: "us-east-1", secretAccessKey });
    expect(check.actual).toBe(check.expected);
  });

  test("validation", () => {
    const base = { accessKeyId, secretAccessKey };
    expect(() => Bun.aws.presign("ftp://x/y", base)).toThrow(/http: or https:/);
    expect(() => Bun.aws.presign("https://bucket.s3.amazonaws.com/k", { ...base, expiresIn: 0 })).toThrow(/expiresIn/);
    expect(() => Bun.aws.presign("https://bucket.s3.amazonaws.com/k", { ...base, expiresIn: 604801 })).toThrow(
      /expiresIn/,
    );
    expect(() => Bun.aws.presign("https://localhost/k", base)).toThrow(/cannot tell which AWS service/);
    // @ts-expect-error
    expect(() => Bun.aws.presign()).toThrow(/expects a URL/);
    expect(() => Bun.aws.presign("https://bucket.s3.amazonaws.com/k", { ...base, method: "NOPE" })).toThrow(/method/);
  });
});
