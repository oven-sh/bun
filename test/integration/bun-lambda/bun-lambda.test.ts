import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

const runtimePath = path.join(import.meta.dir, "..", "..", "..", "packages", "bun-lambda", "runtime.ts");

// The runtime only uses aws4fetch for outgoing WebSocket messages, which these
// tests never send, so a stub keeps the test offline.
const aws4fetchStub = `export class AwsClient {
  constructor() {}
  async fetch() {
    return new Response(null, { status: 200 });
  }
}
`;

test("lambda HTTP events cannot override the request authority", async () => {
  const runtimeSource = await Bun.file(runtimePath).text();

  using dir = tempDir("bun-lambda", {
    "runtime.ts": runtimeSource,
    "handler.ts": `export default {
  async fetch(request) {
    return new Response(request.url);
  },
};
`,
    "node_modules/aws4fetch/package.json": JSON.stringify({ name: "aws4fetch", version: "1.0.0", main: "index.js" }),
    "node_modules/aws4fetch/index.js": aws4fetchStub,
  });

  const events = [
    {
      requestId: "req-v2",
      event: {
        version: "2.0",
        requestContext: {
          requestId: "req-v2",
          domainName: "api.example.com",
          http: { method: "GET", path: "//attacker.example/reset" },
        },
        headers: { "Host": "evil.example", "X-Forwarded-Proto": "https" },
        isBase64Encoded: false,
      },
    },
    {
      requestId: "req-v1",
      event: {
        requestContext: {
          requestId: "req-v1",
          domainName: "api.example.com",
          httpMethod: "GET",
          path: "//attacker.example/reset",
        },
        headers: {},
        multiValueHeaders: { "Host": ["evil.example"], "X-Forwarded-Proto": ["https"] },
        isBase64Encoded: false,
      },
    },
  ];

  let nextInvocation = 0;
  const resolvers = new Map<string, (value: any) => void>();
  const responses = new Map<string, Promise<any>>();
  for (const { requestId } of events) {
    responses.set(requestId, new Promise(resolve => resolvers.set(requestId, resolve)));
  }

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/2018-06-01/runtime/invocation/next") {
        if (nextInvocation >= events.length) {
          // No more events: a non-ok status makes the runtime exit cleanly.
          return new Response(null, { status: 500 });
        }
        const { requestId, event } = events[nextInvocation++];
        return new Response(JSON.stringify(event), {
          headers: {
            "Content-Type": "application/json",
            "Lambda-Runtime-Aws-Request-Id": requestId,
            "Lambda-Runtime-Trace-Id": "trace-id",
            "Lambda-Runtime-Invoked-Function-Arn": "arn:aws:lambda:us-east-1:123456789012:function:test",
            "Lambda-Runtime-Deadline-Ms": String(Date.now() + 60_000),
          },
        });
      }
      const match = url.pathname.match(/^\/2018-06-01\/runtime\/invocation\/([^/]+)\/response$/);
      if (match) {
        resolvers.get(match[1])?.(await req.json());
        return new Response(null, { status: 202 });
      }
      // Anything else (init/invocation errors) fails the assertions with useful context.
      const failure = { unexpected: url.pathname, body: await req.text() };
      for (const resolve of resolvers.values()) {
        resolve(failure);
      }
      return new Response(null, { status: 202 });
    },
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "runtime.ts"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      AWS_LAMBDA_RUNTIME_API: `localhost:${server.port}`,
      _HANDLER: "handler.fetch",
      LAMBDA_TASK_ROOT: String(dir),
    },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  const [v2Response, v1Response] = await Promise.all([responses.get("req-v2"), responses.get("req-v1")]);

  const decodeBody = (response: any): string =>
    response.isBase64Encoded ? Buffer.from(response.body, "base64").toString("utf8") : response.body;

  // Payload format v2: the path from the event must not be able to change the
  // origin, and the authority comes from requestContext.domainName.
  expect(v2Response.unexpected).toBeUndefined();
  const v2Url = new URL(decodeBody(v2Response));
  expect(v2Url.origin).toBe("https://api.example.com");
  expect(v2Url.pathname).toBe("//attacker.example/reset");

  // Payload format v1.
  expect(v1Response.unexpected).toBeUndefined();
  const v1Url = new URL(decodeBody(v1Response));
  expect(v1Url.origin).toBe("https://api.example.com");
  expect(v1Url.pathname).toBe("//attacker.example/reset");
});
