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

test.concurrent("lambda HTTP events cannot override the request authority", async () => {
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

// Runs runtime.ts with this handler against a mock Lambda Runtime API. The API
// serves each event one time. Its next answer is a 500, and the runtime exits.
async function runLambda(handler: string, events: { requestId: string; deadlineMs?: number; event: object }[] = []) {
  using dir = tempDir("bun-lambda", {
    "runtime.ts": await Bun.file(runtimePath).text(),
    "handler.ts": handler,
    "node_modules/aws4fetch/package.json": JSON.stringify({ name: "aws4fetch", version: "1.0.0", main: "index.js" }),
    "node_modules/aws4fetch/index.js": aws4fetchStub,
  });

  const posts: { path: string; body: any }[] = [];
  let served = 0;
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname.slice("/2018-06-01/runtime/".length);
      if (path !== "invocation/next") {
        posts.push({ path, body: await req.json() });
        return new Response(null, { status: 202 });
      }
      if (served === events.length) {
        return new Response(null, { status: 500 });
      }
      const next = events[served++];
      return Response.json(next.event, {
        headers: {
          "Lambda-Runtime-Aws-Request-Id": next.requestId,
          "Lambda-Runtime-Trace-Id": "trace-id",
          "Lambda-Runtime-Invoked-Function-Arn": "arn:aws:lambda:us-east-1:123456789012:function:test",
          "Lambda-Runtime-Deadline-Ms": String(next.deadlineMs ?? Date.now() + 60_000),
        },
      });
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
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, posts };
}

const httpEvent = {
  version: "2.0",
  requestContext: { domainName: "api.example.com", http: { method: "POST", path: "/hello" } },
  headers: { "content-type": "text/plain" },
  isBase64Encoded: false,
  body: "request body",
};

// One CloudWatch record per console call: the runtime writes each line break as "\r".
const fold = (value: unknown) => Bun.inspect(value).replaceAll("\n", "\r");

// https://github.com/oven-sh/bun/issues/4826
test.concurrent("console prints a string as it is and every other value as Bun.inspect does", async () => {
  // Deeper than the default depth of node:util, like the policy in the runtime's WebSocket warning.
  const policy = { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: ["execute-api:Invoke"] }] };
  const { stdout, stderr, exitCode, posts } = await runLambda(
    `const { heapStats } = require("bun:jsc");
// Only node:util loads internal/util/mime.
const nodeUtilLoaded = () => (heapStats().objectTypeCounts.MIMEType ?? 0) > 0;
console.log("init:", { a: 1 });
export default {
  async fetch(request) {
    const headers = new Headers({ "x-a": "b" });
    const policy = ${JSON.stringify(policy)};
    console.log("url:", request.url);
    console.error("payload:", JSON.stringify({ a: 1 }, null, 2));
    console.log("hi %s, you are %d", "bob", 42);
    console.log("GET", "/caf%c3%a9", 200);
    console.log({ url: "/caf%c3%a9" }, 200);
    console.log("GET /a%20b", 200);
    console.warn("keep %s and %% literal");
    console.info("crlf:", "a\\r\\nb");
    console.debug("headers:", headers);
    console.trace("policy:", policy);
    console.log("%d ms", 12, "GET", headers, policy);
    console.log("response: %o", new Response("body", { status: 201 }));
    console.log("callback: %O of %o", JSON.parse, "text");
    console.log("event: %j", { a: [1] });
    const cycle = { a: 1 };
    cycle.self = cycle;
    console.log("cycle: %j", cycle);
    console.log("%s at %d, %j, %s", { toString: () => "custom" }, new Date(5), new Date(5), Object.create(null));
    class Point { toString() { return "(1, 2)"; } }
    class Day extends Date {}
    console.log("%s is %s, %s, %s", new Point(), new Date(5), new Day(5), [1, 2, 3]);
    console.log("%s and %s", { [Symbol.toPrimitive]: () => "prim" }, new Map([[1, 2]]));
    const boom = Object.assign(new Error("boom"), { stack: "Error: boom\\n    at fetch (/var/task/handler.ts:1:1)" });
    console.error("%s | %s | %s", { a: 1 }, Object.assign([1, 2, 3], { toString: () => "own" }), boom);
    console.log("null: %s, %d, %j, %o", null, null, null, null);
    console.log("undefined: %s, %d, %j, %o", undefined, undefined, undefined, undefined);
    console.log("%i items, %f cpu", "42px", "1.5x");
    console.log("%s %d %i", 12n, 12n, 12n);
    console.log("%d %i %f", Symbol(), Symbol(), Symbol());
    console.log("%s %d %i %f", -0, -0, "-0", "-0");
    console.log("%cstyled", "color: red");
    console.log("%s %s", "only");
    console.log("100%% of", 3);
    console.log(request);
    console.log();
    const afterLogs = nodeUtilLoaded();
    require("node:util");
    return Response.json({ request: Bun.inspect(request), nodeUtil: { afterLogs, markerWorks: nodeUtilLoaded() } });
  },
};
`,
    [{ requestId: "req-log", event: httpEvent }],
  );

  const headers = new Headers({ "x-a": "b" });
  const boom = Object.assign(new Error("boom"), { stack: "Error: boom\n    at fetch (/var/task/handler.ts:1:1)" });
  expect(stderr).toBe("");
  expect(posts.map(post => post.path)).toEqual(["invocation/req-log/response"]);
  const response = JSON.parse(posts[0].body.body);
  expect(stdout.split("\n")).toEqual([
    `INFO init: ${fold({ a: 1 })}`,
    "INFO RequestId: req-log url: http://api.example.com/hello",
    'ERROR RequestId: req-log payload: {\r  "a": 1\r}',
    "INFO RequestId: req-log hi bob, you are 42",
    "INFO RequestId: req-log GET /caf%c3%a9 200",
    `INFO RequestId: req-log ${fold({ url: "/caf%c3%a9" })} 200`,
    "INFO RequestId: req-log GET /a%20b 200",
    "WARN RequestId: req-log keep %s and %% literal",
    "INFO RequestId: req-log crlf: a\rb",
    `DEBUG RequestId: req-log headers: ${fold(headers)}`,
    `TRACE RequestId: req-log policy: ${fold(policy)}`,
    `INFO RequestId: req-log 12 ms GET ${fold(headers)} ${fold(policy)}`,
    `INFO RequestId: req-log response: ${fold(new Response("body", { status: 201 }))}`,
    'INFO RequestId: req-log callback: [Function: parse] of "text"',
    'INFO RequestId: req-log event: {"a":[1]}',
    "INFO RequestId: req-log cycle: [Circular]",
    `INFO RequestId: req-log custom at 5, "1970-01-01T00:00:00.005Z", ${fold(Object.create(null))}`,
    `INFO RequestId: req-log (1, 2) is ${fold(new Date(5))}, ${fold(new Date(5))}, ${fold([1, 2, 3])}`,
    `INFO RequestId: req-log prim and ${fold(new Map([[1, 2]]))}`,
    `ERROR RequestId: req-log ${fold({ a: 1 })} | own | ${fold(boom)}`,
    "INFO RequestId: req-log null: null, 0, null, null",
    "INFO RequestId: req-log undefined: undefined, NaN, undefined, undefined",
    "INFO RequestId: req-log 42 items, 1.5 cpu",
    "INFO RequestId: req-log 12n 12n 12n",
    "INFO RequestId: req-log NaN NaN NaN",
    "INFO RequestId: req-log -0 -0 -0 -0",
    "INFO RequestId: req-log styled",
    "INFO RequestId: req-log only %s",
    "INFO RequestId: req-log 100% of 3",
    `INFO RequestId: req-log ${response.request.replaceAll("\n", "\r")}`,
    "ERROR Runtime failed to send request to Lambda [status: 500]",
    "",
  ]);
  // The runtime formats without node:util. Its load would land in the first invocation that logs a format string.
  expect(response.nodeUtil).toEqual({ afterLogs: false, markerWorks: true });
  expect(exitCode).toBe(1);
});

test.concurrent.each([
  {
    cause: "a string at init",
    handler: `export default {};\n`,
    events: [],
    path: "init/error",
    errorMessage: "handler does not have a default export with a function named 'fetch'",
    stdout: "ERROR handler does not have a default export with a function named 'fetch'\n",
  },
  {
    cause: "an object at init",
    handler: `throw { code: 42 };\n`,
    events: [],
    path: "init/error",
    errorMessage: Bun.inspect({ code: 42 }),
    stdout: `ERROR ${fold({ code: 42 })}\n`,
  },
  {
    cause: "a string in an invocation",
    handler: `export default { fetch: () => new Promise(() => {}) };\n`,
    events: [{ requestId: "req-timeout", deadlineMs: 1, event: httpEvent }],
    path: "invocation/req-timeout/error",
    errorMessage: "Function timed out",
    stdout:
      "ERROR RequestId: req-timeout Function timed out\n" +
      "ERROR Runtime failed to send request to Lambda [status: 500]\n",
  },
])(
  "errorMessage of $cause is the cause as console prints it",
  async ({ handler, events, path, errorMessage, stdout }) => {
    expect(await runLambda(handler, events)).toEqual({
      stdout,
      stderr: "",
      exitCode: 1,
      posts: [{ path, body: { errorType: "Error", errorMessage } }],
    });
  },
);

// node:util throws for a value JSON.stringify rejects. The same handler throws on Node's Lambda runtime.
test.concurrent("a BigInt under %j throws in the handler, as any other throw in fetch", async () => {
  const { stdout, stderr, exitCode, posts } = await runLambda(
    `export default { fetch: () => console.log("%j", 10n) };\n`,
    [{ requestId: "req-bigint", event: httpEvent }],
  );
  expect(stderr).toBe("");
  expect(stdout).toStartWith("ERROR RequestId: req-bigint ");
  expect(stdout).toContain("TypeError: JSON.stringify cannot serialize BigInt.\r      at stringifyJSON (");
  expect(posts).toEqual([
    {
      path: "invocation/req-bigint/response",
      body: { statusCode: 500, headers: {}, body: "", isBase64Encoded: true },
    },
  ]);
  expect(exitCode).toBe(1);
});
