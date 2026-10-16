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

// https://github.com/oven-sh/bun/issues/4826
test.concurrent("console.log in a handler formats its arguments like util.format", async () => {
  const runtimeSource = await Bun.file(runtimePath).text();

  using dir = tempDir("bun-lambda-log", {
    "runtime.ts": runtimeSource,
    "handler.ts": `export default {
  async fetch(request) {
    console.log("url:", request.url);
    console.log("hi %s, you are %d", "bob", 42);
    console.log("GET", "/caf%c3%a9", 200);
    console.error("payload:", JSON.stringify({ a: 1 }, null, 2));
    console.log("obj:", { a: 1 });
    console.warn("keep %s literal");
    console.info("crlf:", "a\\r\\nb");
    return new Response("ok");
  },
};
`,
    "node_modules/aws4fetch/package.json": JSON.stringify({ name: "aws4fetch", version: "1.0.0", main: "index.js" }),
    "node_modules/aws4fetch/index.js": aws4fetchStub,
  });

  const event = {
    version: "2.0",
    requestContext: {
      requestId: "req-log",
      domainName: "api.example.com",
      http: { method: "GET", path: "/hello" },
    },
    headers: {},
    isBase64Encoded: false,
  };

  let served = false;
  const { promise: responded, resolve: markResponded } = Promise.withResolvers<{ unexpected?: string }>();

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/2018-06-01/runtime/invocation/next") {
        if (served) {
          // No more events: a non-ok status makes the runtime exit.
          return new Response(null, { status: 500 });
        }
        served = true;
        return new Response(JSON.stringify(event), {
          headers: {
            "Content-Type": "application/json",
            "Lambda-Runtime-Aws-Request-Id": "req-log",
            "Lambda-Runtime-Trace-Id": "trace-id",
            "Lambda-Runtime-Invoked-Function-Arn": "arn:aws:lambda:us-east-1:123456789012:function:test",
            "Lambda-Runtime-Deadline-Ms": String(Date.now() + 60_000),
          },
        });
      }
      if (/^\/2018-06-01\/runtime\/invocation\/[^/]+\/response$/.test(url.pathname)) {
        markResponded({});
        return new Response(null, { status: 202 });
      }
      // Anything else (init/invocation errors) fails the assertion with its path.
      markResponded({ unexpected: `${url.pathname} ${await req.text()}` });
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

  const [result, stdout, stderr, exitCode] = await Promise.all([
    responded,
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect({
    unexpected: result.unexpected,
    // Lines from inside the invocation carry the RequestId prefix.
    lines: stdout.split("\n").filter(line => line.includes("RequestId: req-log")),
    stderr,
    exitCode,
  }).toEqual({
    unexpected: undefined,
    lines: [
      "INFO RequestId: req-log url: http://api.example.com/hello",
      "INFO RequestId: req-log hi bob, you are 42",
      "INFO RequestId: req-log GET /caf%c3%a9 200",
      'ERROR RequestId: req-log payload: {\r  "a": 1\r}',
      "INFO RequestId: req-log obj: { a: 1 }",
      "WARN RequestId: req-log keep %s literal",
      "INFO RequestId: req-log crlf: a\rb",
    ],
    stderr: "",
    exitCode: 1,
  });
});
