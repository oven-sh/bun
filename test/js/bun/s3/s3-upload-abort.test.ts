import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, tls } from "harness";

// An upload that can never finish must be aborted on the server and released
// natively: the queued part buffers are freed, a started multipart upload gets
// an AbortMultipartUpload, and nothing keeps the event loop alive.
//
// The stub counts each S3 request and the child prints the counts at exit.
// `body` runs with `client` in scope and must leave the upload abandoned.
// The child then waits for `waitFor` before it runs `then`. With `gateCreate`,
// the stub holds the CreateMultipartUpload response until `then` ran. The stub answers
// AbortMultipartUpload with `abortStatus` (204, as S3 does, by default).
function fixture(opts: {
  body: string;
  waitFor: string;
  then?: string;
  gateCreate?: boolean;
  retry?: number;
  abortStatus?: number;
}) {
  return `
    const reqs = { create: 0, part: 0, complete: 0, abort: 0, put: 0 };
    const createGate = Promise.withResolvers();
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (req.method === "POST" && url.searchParams.has("uploads")) {
          reqs.create++;
          ${opts.gateCreate ? "await createGate.promise;" : ""}
          return new Response(
            "<InitiateMultipartUploadResult><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>",
            { headers: { "content-type": "application/xml" } },
          );
        }
        if (req.method === "PUT") {
          await req.arrayBuffer();
          if (url.searchParams.has("uploadId")) {
            reqs.part++;
            return new Response("", { headers: { ETag: '"etag"' } });
          }
          reqs.put++;
          return new Response("");
        }
        if (req.method === "DELETE") {
          reqs.abort++;
          return new Response("", { status: ${opts.abortStatus ?? 204} });
        }
        await req.text();
        reqs.complete++;
        return new Response('<CompleteMultipartUploadResult><ETag>"etag"</ETag></CompleteMultipartUploadResult>');
      },
    });
    // Only the abandoned upload may keep the process alive.
    server.unref();
    const client = new Bun.S3Client({
      endpoint: "http://127.0.0.1:" + server.port,
      bucket: "bucket",
      accessKeyId: "key",
      secretAccessKey: "secret",
      region: "us-east-1",
    });
    const partSize = 5 * 1024 * 1024;
    const opts = { partSize, queueSize: 2, retry: ${opts.retry ?? 0} };
    const deadline = Date.now() + 4_000;
    ${opts.body}
    while (Date.now() < deadline && !(${opts.waitFor})) {
      await Bun.sleep(10);
    }
    if (!(${opts.waitFor})) throw new Error("not reached: " + ${JSON.stringify(opts.waitFor)});
    ${opts.then ?? ""}
    createGate.resolve();
    process.on("exit", () => console.log(JSON.stringify(reqs)));
  `;
}

const env = {
  ...bunEnv,
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  http_proxy: undefined,
  https_proxy: undefined,
};

async function run(opts: Parameters<typeof fixture>[0]) {
  using dir = tempDir("s3-upload-abort", {});
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture(opts)],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  // A leaked upload pins the event loop, so the child never exits and the
  // test times out.
  const [stdout, stderr, exited] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exited };
}

// Uploads a stream that yields one full part, waits for `before`, then errors.
const failingStream = (before: string) => `
  let pulls = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      if (pulls++ === 0) {
        controller.enqueue(new Uint8Array(partSize));
        return;
      }
      while (Date.now() < deadline && !(${before})) await Bun.sleep(10);
      controller.error(new Error("source failed"));
    },
  });
  const result = await client.write("key", new Response(stream), opts).then(
    () => "resolved",
    e => "rejected: " + e.message,
  );
  console.log(result);
`;

// The source stream errors after one full part, while the
// CreateMultipartUpload request is still in flight. The write rejects at
// once. When the Create response lands, the upload it names must be aborted.
test.concurrent("stream error while CreateMultipartUpload is in flight aborts the upload", async () => {
  expect(
    await run({
      body: failingStream(`true`),
      waitFor: `true`,
      then: `createGate.resolve(); while (Date.now() < deadline && reqs.abort === 0) await Bun.sleep(10);`,
      gateCreate: true,
    }),
  ).toEqual({
    stdout: `rejected: source failed\n{"create":1,"part":0,"complete":0,"abort":1,"put":0}\n`,
    stderr: "",
    exited: 0,
  });
});

// S3 answers AbortMultipartUpload with 204. A 404 means the store no longer has the upload.
// Both are final: the abort must not be sent again.
test.concurrent.each([204, 404])("AbortMultipartUpload answered with %d is not retried", async abortStatus => {
  expect(
    await run({ body: failingStream(`reqs.part === 1`), waitFor: `reqs.abort > 0`, retry: 3, abortStatus }),
  ).toEqual({
    stdout: `rejected: source failed\n{"create":1,"part":1,"complete":0,"abort":1,"put":0}\n`,
    stderr: "",
    exited: 0,
  });
});

// An `S3File.writer()` that is dropped before `end()` can never finish its
// upload. Once the wrapper is collected the upload is aborted and the process
// exits. `w` stays reachable until `collectWriter`: a GC before `waitFor` holds would abort early.
const droppedWriter = (writes: string) => `
  let finalized = 0;
  let w;
  const registry = new FinalizationRegistry(() => finalized++);
  (() => {
    w = client.file("key").writer(opts);
    registry.register(w, 1);
    ${writes}
  })();
`;
const collectWriter = `
  w = undefined;
  while (Date.now() < deadline && finalized === 0) {
    Bun.gc(true);
    await Bun.sleep(10);
  }
  console.log("finalized", finalized);
`;
const twoParts = droppedWriter(`w.write(new Uint8Array(6 * 1024 * 1024)); w.write(new Uint8Array(6 * 1024 * 1024));`);

test.concurrent(
  "dropped writer with uploaded parts aborts the multipart upload and lets the process exit",
  async () => {
    expect(await run({ body: twoParts, waitFor: `reqs.part === 2`, then: collectWriter })).toEqual({
      stdout: `finalized 1\n{"create":1,"part":2,"complete":0,"abort":1,"put":0}\n`,
      stderr: "",
      exited: 0,
    });
  },
);

// The Create response is held until the upload has failed. The only signal script gets for that
// is the dropped writer's pending `flush()`, which rejects.
test.concurrent("dropped writer collected while CreateMultipartUpload is in flight still aborts it", async () => {
  const body = `
    const flush = (() => {
      const w = client.file("key").writer(opts);
      w.write(new Uint8Array(6 * 1024 * 1024));
      w.write(new Uint8Array(6 * 1024 * 1024));
      return w.flush();
    })();
    let flushed;
    flush.then(
      () => (flushed = "flush resolved"),
      e => (flushed = "flush rejected: " + e.message + " (path " + e.path + ")"),
    );
  `;
  const then = `
    while (Date.now() < deadline && flushed === undefined) {
      Bun.gc(true);
      await Bun.sleep(10);
    }
    console.log(flushed);
  `;
  expect(await run({ body, waitFor: `reqs.create === 1`, then, gateCreate: true })).toEqual({
    stdout: `flush rejected: S3 writer was garbage collected before end() was called (path key)\n{"create":1,"part":0,"complete":0,"abort":1,"put":0}\n`,
    stderr: "",
    exited: 0,
  });
});

test.concurrent("dropped writer with only buffered bytes lets the process exit", async () => {
  expect(
    await run({ body: droppedWriter(`w.write(new Uint8Array(1000));`), waitFor: `true`, then: collectWriter }),
  ).toEqual({
    stdout: `finalized 1\n{"create":0,"part":0,"complete":0,"abort":0,"put":0}\n`,
    stderr: "",
    exited: 0,
  });
});

// A request of an upload is sent again (`retry` times at most) only after a transient failure:
// the connection failed, or the store asked for another attempt (408, 429, a throttling or
// timeout <Code>) or failed on its own side (a 5xx other than 501). Any other failure is final:
// the request that got it was sent once.
//
// The child uploads one object per case, each with `retry: 3` unless the case says otherwise,
// and prints how each upload ended and how many requests of each kind the stub got for it.
// `answers` is what the stub answers the requests of a kind with (`times`: only the first so
// many). Every other request succeeds.
type Kind = "create" | "part" | "complete" | "abort" | "put";
type Answer = { status: number; body?: string; times?: number };
type Upload = { size?: number; retry?: number; stream?: true; answers: Partial<Record<Kind, Answer>> };

const s3Error = (code: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>no</Message></Error>`;
const accessDenied: Answer = { status: 403, body: s3Error("AccessDenied") };
const slowDown: Answer = { status: 503, body: s3Error("SlowDown") };
const partSize = 5 * 1024 * 1024;

const uploads = (cases: Record<string, Upload>) => `
  const cases = ${JSON.stringify(cases)};
  const sent = {};
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const key = url.pathname.slice("/bucket/".length);
      const kind =
        req.method === "DELETE" ? "abort"
        : req.method === "PUT" ? (url.searchParams.has("uploadId") ? "part" : "put")
        : url.searchParams.has("uploads") ? "create" : "complete";
      await req.arrayBuffer();
      const count = (sent[key][kind] = (sent[key][kind] ?? 0) + 1);
      const answer = cases[key].answers[kind];
      if (answer && count <= (answer.times ?? Infinity)) {
        return new Response(answer.body, { status: answer.status });
      }
      if (kind === "create") {
        return new Response(
          "<InitiateMultipartUploadResult><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>",
        );
      }
      if (kind === "part") return new Response("", { headers: { ETag: '"etag"' } });
      if (kind === "complete") {
        return new Response('<CompleteMultipartUploadResult><ETag>"etag"</ETag></CompleteMultipartUploadResult>');
      }
      return new Response(null, { status: kind === "abort" ? 204 : 200 });
    },
  });
  // Only the uploads and their rollbacks may keep the process alive.
  server.unref();
  const client = new Bun.S3Client({
    endpoint: "http://127.0.0.1:" + server.port,
    bucket: "bucket",
    accessKeyId: "key",
    secretAccessKey: "secret",
    region: "us-east-1",
  });
  const ended = {};
  for (const [key, { size = 7, retry = 3, stream }] of Object.entries(cases)) {
    sent[key] = {};
    const options = { partSize: ${partSize}, queueSize: 1, retry };
    const body = new Uint8Array(size);
    let upload;
    if (stream) {
      const source = new ReadableStream({
        pull(controller) {
          controller.enqueue(body);
          controller.close();
        },
      });
      upload = client.write(key, new Response(source), options);
    } else {
      const writer = client.file(key).writer(options);
      writer.write(body);
      upload = writer.end();
    }
    upload.then(
      bytes => (ended[key] = "resolved " + bytes),
      error => (ended[key] = "rejected " + error.code),
    );
  }
  // At exit: a rollback goes out after its upload has rejected.
  process.on("exit", () => {
    const report = Object.keys(cases).map(key => [key, { ended: ended[key], ...sent[key] }]);
    console.log(JSON.stringify(Object.fromEntries(report)));
  });
`;

// The JSON a child printed, or what it printed in its place.
function json(stdout: string) {
  try {
    return JSON.parse(stdout);
  } catch {
    return stdout;
  }
}

async function runUploads(cases: Record<string, Upload>) {
  using dir = tempDir("s3-upload-retry", {});
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", uploads(cases)],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exited] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { sent: json(stdout), stderr, exited };
}

test.concurrent("the single PUT of an upload is sent again only after a transient failure", async () => {
  const put = (answer: Answer, rest: Omit<Upload, "answers"> = {}): Upload => ({ ...rest, answers: { put: answer } });
  expect(
    await runUploads({
      "403-AccessDenied": put(accessDenied),
      "403-AccessDenied-streamed": put(accessDenied, { stream: true }),
      "403-no-body": put({ status: 403 }),
      "403-html": put({ status: 403, body: "<html><body>Forbidden</body></html>" }),
      "307-no-Location": put({ status: 307, body: s3Error("TemporaryRedirect") }),
      "404-NoSuchBucket": put({ status: 404, body: s3Error("NoSuchBucket") }),
      "501-NotImplemented": put({ status: 501, body: s3Error("NotImplemented") }),
      "503-SlowDown": put(slowDown),
      "503-SlowDown-streamed": put(slowDown, { stream: true }),
      "503-html": put({ status: 503, body: "<html><body>Service Unavailable</body></html>" }),
      "408-html": put({ status: 408, body: "<html><body>Request Timeout</body></html>" }),
      "429-no-body": put({ status: 429 }),
      "500-InternalError": put({ status: 500, body: s3Error("InternalError") }),
      "502-no-body": put({ status: 502 }),
      "504-no-body": put({ status: 504 }),
      "520-no-body": put({ status: 520 }),
      "400-RequestTimeout": put({ status: 400, body: s3Error("RequestTimeout") }),
      "503-SlowDown-retry-0": put(slowDown, { retry: 0 }),
      "503-SlowDown-once": put({ ...slowDown, times: 1 }),
    }),
  ).toEqual({
    sent: {
      "403-AccessDenied": { ended: "rejected AccessDenied", put: 1 },
      "403-AccessDenied-streamed": { ended: "rejected AccessDenied", put: 1 },
      "403-no-body": { ended: "rejected UnknownError", put: 1 },
      "403-html": { ended: "rejected UnknownError", put: 1 },
      "307-no-Location": { ended: "rejected TemporaryRedirect", put: 1 },
      "404-NoSuchBucket": { ended: "rejected NoSuchBucket", put: 1 },
      "501-NotImplemented": { ended: "rejected NotImplemented", put: 1 },
      "503-SlowDown": { ended: "rejected SlowDown", put: 4 },
      "503-SlowDown-streamed": { ended: "rejected SlowDown", put: 4 },
      "503-html": { ended: "rejected UnknownError", put: 4 },
      "408-html": { ended: "rejected UnknownError", put: 4 },
      "429-no-body": { ended: "rejected UnknownError", put: 4 },
      "500-InternalError": { ended: "rejected InternalError", put: 4 },
      "502-no-body": { ended: "rejected UnknownError", put: 4 },
      "504-no-body": { ended: "rejected UnknownError", put: 4 },
      "520-no-body": { ended: "rejected UnknownError", put: 4 },
      "400-RequestTimeout": { ended: "rejected RequestTimeout", put: 4 },
      "503-SlowDown-retry-0": { ended: "rejected SlowDown", put: 1 },
      "503-SlowDown-once": { ended: "resolved 7", put: 2 },
    },
    stderr: "",
    exited: 0,
  });
});

// The <Code> names that the AWS SDKs take as throttling or as a timeout, whatever the status.
const transientCodes = [
  "BandwidthLimitExceeded",
  "EC2ThrottledException",
  "LimitExceededException",
  "PriorRequestNotComplete",
  "ProvisionedThroughputExceededException",
  "RequestLimitExceeded",
  "RequestThrottled",
  "RequestThrottledException",
  "RequestTimeout",
  "RequestTimeoutException",
  "SlowDown",
  "ThrottledException",
  "Throttling",
  "ThrottlingException",
  "TooManyRequestsException",
  "TransactionInProgressException",
];

test.concurrent("a throttling or timeout <Code> is transient under a status that is final", async () => {
  const answered = (code: string): Upload => ({ answers: { put: { status: 400, body: s3Error(code) } } });
  const sentTimes = (code: string, put: number) => [code, { ended: `rejected ${code}`, put }];
  expect(
    await runUploads(Object.fromEntries([...transientCodes, "InvalidRequest"].map(code => [code, answered(code)]))),
  ).toEqual({
    sent: Object.fromEntries([...transientCodes.map(code => sentTimes(code, 4)), sentTimes("InvalidRequest", 1)]),
    stderr: "",
    exited: 0,
  });
});

// One full part, so the upload is a multipart upload: Create, UploadPart, Complete, and an
// Abort when it fails.
test.concurrent("the requests of a multipart upload are sent again only after a transient failure", async () => {
  const multipart = (answers: Upload["answers"]): Upload => ({ size: partSize, answers });
  expect(
    await runUploads({
      "part-403": multipart({ part: accessDenied }),
      "part-503": multipart({ part: slowDown }),
      "part-503-once": multipart({ part: { ...slowDown, times: 1 } }),
      "part-200-without-ETag": multipart({ part: { status: 200 } }),
      "complete-403": multipart({ complete: accessDenied }),
      "complete-503": multipart({ complete: slowDown }),
      // S3 sends the 200 before it has assembled the object: its error then arrives under the 200.
      "complete-200-with-Error": multipart({ complete: { status: 200, body: s3Error("InternalError") } }),
      "abort-403": multipart({ part: accessDenied, abort: accessDenied }),
      "abort-503": multipart({ part: accessDenied, abort: slowDown }),
      // Complete and Abort share one budget: a final answer to Complete leaves it to the Abort.
      "complete-403-abort-503": multipart({ complete: accessDenied, abort: slowDown }),
    }),
  ).toEqual({
    sent: {
      "part-403": { ended: "rejected AccessDenied", create: 1, part: 1, abort: 1 },
      "part-503": { ended: "rejected SlowDown", create: 1, part: 4, abort: 1 },
      "part-503-once": { ended: `resolved ${partSize}`, create: 1, part: 2, complete: 1 },
      "part-200-without-ETag": { ended: "rejected UnknownError", create: 1, part: 1, abort: 1 },
      "complete-403": { ended: "rejected AccessDenied", create: 1, part: 1, complete: 1, abort: 1 },
      "complete-503": { ended: "rejected SlowDown", create: 1, part: 1, complete: 4, abort: 1 },
      "complete-200-with-Error": { ended: "rejected InternalError", create: 1, part: 1, complete: 4, abort: 1 },
      "abort-403": { ended: "rejected AccessDenied", create: 1, part: 1, abort: 1 },
      "abort-503": { ended: "rejected AccessDenied", create: 1, part: 1, abort: 4 },
      "complete-403-abort-503": { ended: "rejected AccessDenied", create: 1, part: 1, complete: 1, abort: 4 },
    },
    stderr: "",
    exited: 0,
  });
});

// The same rule for a request whose connection failed. It is sent again unless the peer is the
// reason: a certificate that is not trusted, a redirect that cannot be followed, a proxy that
// refuses, or an answer whose status is final though its body was cut short. Each case has its
// own listener, which counts the connections the upload (`retry: 3`) made to it.
const unanswered = `
  let connections = 0;
  // Answers what it gets with \`reply\`, or closes the connection for none.
  const listen = reply =>
    Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open() {
          connections++;
        },
        data(socket) {
          socket.end(reply);
        },
        error() {},
      },
    });
  // Relays to \`port\`. (A TLS listener reports a connection when its handshake is over, which
  // can be after the client gave up on it.)
  const relay = port =>
    Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          connections++;
          socket.data = Bun.connect({
            hostname: "127.0.0.1",
            port,
            socket: {
              data(_, bytes) {
                socket.write(bytes);
              },
              close() {
                socket.end();
              },
              error() {},
            },
          });
        },
        async data(socket, bytes) {
          (await socket.data).write(bytes);
        },
        async close(socket) {
          (await socket.data).end();
        },
        error() {},
      },
    });
  const upload = endpoint => {
    const client = new Bun.S3Client({
      endpoint,
      bucket: "bucket",
      accessKeyId: "key",
      secretAccessKey: "secret",
      region: "us-east-1",
    });
    const writer = client.file("key").writer({ retry: 3 });
    writer.write("payload");
    return writer.end().then(
      bytes => "resolved " + bytes,
      error => "rejected " + error.code,
    );
  };
  // An HTTPS endpoint reached through a proxy that answers CONNECT with \`status\`.
  const throughProxy = async status => {
    using proxy = listen("HTTP/1.1 " + status + "\\r\\nContent-Length: 0\\r\\n\\r\\n");
    process.env.HTTPS_PROXY = "http://127.0.0.1:" + proxy.port;
    try {
      return await upload("https://s3.test");
    } finally {
      delete process.env.HTTPS_PROXY;
    }
  };
  const answeredWith = async reply => {
    using server = listen(reply);
    return await upload("http://127.0.0.1:" + server.port);
  };
  const cases = {
    "closed-without-an-answer": () => answeredWith(),
    async "certificate-not-trusted"() {
      using store = Bun.serve({
        port: 0,
        tls: { cert: await Bun.file("cert.pem").text(), key: await Bun.file("key.pem").text() },
        fetch: () => new Response(""),
      });
      using server = relay(store.port);
      return await upload("https://127.0.0.1:" + server.port);
    },
    // The head of an answer, with less body than it declares.
    "503-cut-short": () => answeredWith("HTTP/1.1 503 Service Unavailable\\r\\nContent-Length: 100\\r\\n\\r\\n<Error>"),
    "403-cut-short": () => answeredWith("HTTP/1.1 403 Forbidden\\r\\nContent-Length: 100\\r\\n\\r\\n<Error>"),
    "redirect-that-cannot-be-followed": () =>
      answeredWith("HTTP/1.1 307 Temporary Redirect\\r\\nLocation: ftp://127.0.0.1/\\r\\nContent-Length: 0\\r\\n\\r\\n"),
    "proxy-407": () => throughProxy("407 Proxy Authentication Required"),
    "proxy-502": () => throughProxy("502 Bad Gateway"),
  };
  const made = {};
  for (const [name, run] of Object.entries(cases)) {
    connections = 0;
    made[name] = { ended: await run(), connections };
  }
  console.log(JSON.stringify(made));
`;

test.concurrent("an upload request whose connection failed is sent again unless the peer is the reason", async () => {
  using dir = tempDir("s3-upload-retry", { "cert.pem": tls.cert, "key.pem": tls.key });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", unanswered],
    env: { ...env, NO_PROXY: undefined, no_proxy: undefined, NODE_TLS_REJECT_UNAUTHORIZED: undefined },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exited] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ made: json(stdout), stderr, exited }).toEqual({
    made: {
      "closed-without-an-answer": { ended: "rejected ConnectionClosed", connections: 4 },
      "certificate-not-trusted": { ended: "rejected DEPTH_ZERO_SELF_SIGNED_CERT", connections: 1 },
      "503-cut-short": { ended: "rejected ConnectionClosed", connections: 4 },
      "403-cut-short": { ended: "rejected ConnectionClosed", connections: 1 },
      "redirect-that-cannot-be-followed": { ended: "rejected UnsupportedRedirectProtocol", connections: 1 },
      "proxy-407": { ended: "rejected ProxyConnectFailed", connections: 1 },
      "proxy-502": { ended: "rejected ProxyConnectFailed", connections: 4 },
    },
    stderr: "",
    exited: 0,
  });
});

// A request that cannot be signed (a key that is over 1024 bytes once encoded) fails before it
// exists, inside the call that wanted it sent. Sent again from there, the attempts nest: with
// `retry: 255` and `end()` called from the deepest frame a Worker's stack allows, they
// overflowed the stack.
test.concurrent("an upload request that cannot be signed is not attempted again", async () => {
  using dir = tempDir("s3-upload-retry", {
    "index.ts": `
      const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
      worker.onmessage = event => console.log(event.data);
      worker.addEventListener("close", event => console.log("worker exited with", event.code));
    `,
    "worker.ts": `
      const client = new Bun.S3Client({
        endpoint: "http://127.0.0.1:1",
        bucket: "bucket",
        accessKeyId: "key",
        secretAccessKey: "secret",
        region: "us-east-1",
      });
      const writer = client.file(Buffer.alloc(512, "+").toString()).writer({ retry: 255 });
      writer.write("payload");
      let ended;
      const deepest = () => {
        try {
          return deepest();
        } catch (error) {
          if (ended !== undefined) throw error;
          return (ended = Promise.resolve(writer.end()));
        }
      };
      deepest();
      const outcome = await ended.then(
        bytes => "resolved " + bytes,
        error => "rejected " + error.code,
      );
      postMessage("the upload ended: " + outcome);
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exited] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // (`resolved 0`, not a rejection: `end()` loses a failure that arrives before its promise
  // exists. https://github.com/oven-sh/bun/pull/43140 reports it.)
  expect({ stdout, stderr, exited }).toEqual({
    stdout: "the upload ended: resolved 0\nworker exited with 0\n",
    stderr: "",
    exited: 0,
  });
});

// An aborted request got no answer, so it is one that is sent again. A rollback depends on it:
// a `bun test --isolate` file swap stops what the file left running, which is the upload, and
// then the rollback that the upload armed as it failed. The rollback after that one is the one
// the store gets.
test.concurrent("the rollback of an upload that a test file left running still reaches the store", async () => {
  const reqs = { create: 0, part: 0, complete: 0, abort: 0 };
  const seen = { part: Promise.withResolvers<void>(), abort: Promise.withResolvers<void>() };
  const testEnded = Promise.withResolvers<void>();
  await using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      // What the test files wait for.
      if (url.pathname === "/seen/part" || url.pathname === "/seen/abort") {
        await seen[url.pathname === "/seen/part" ? "part" : "abort"].promise;
        return new Response("");
      }
      if (req.method === "POST" && url.searchParams.has("uploads")) {
        reqs.create++;
        return new Response(
          "<InitiateMultipartUploadResult><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>",
        );
      }
      if (req.method === "PUT") {
        await req.arrayBuffer();
        reqs.part++;
        seen.part.resolve();
        // Unanswered: the part is in flight when the first file ends.
        await testEnded.promise;
        return new Response("", { headers: { ETag: '"etag"' } });
      }
      if (req.method === "DELETE") {
        reqs.abort++;
        seen.abort.resolve();
        return new Response(null, { status: 204 });
      }
      reqs.complete++;
      return new Response('<CompleteMultipartUploadResult><ETag>"etag"</ETag></CompleteMultipartUploadResult>');
    },
  });
  using dir = tempDir("s3-upload-retry", {
    "first.test.ts": `
      import { test } from "bun:test";
      test("leaves a multipart upload with a part in flight", async () => {
        const client = new Bun.S3Client({
          endpoint: process.env.S3_STUB,
          bucket: "bucket",
          accessKeyId: "key",
          secretAccessKey: "secret",
          region: "us-east-1",
        });
        const writer = client.file("key").writer({ partSize: ${partSize}, queueSize: 1, retry: 3 });
        // Reachable until the file ends: a collected writer aborts its upload by itself.
        globalThis.writer = writer;
        writer.write(new Uint8Array(${partSize}));
        await fetch(process.env.S3_STUB + "/seen/part");
      });
    `,
    "second.test.ts": `
      import { test } from "bun:test";
      test("runs until the store has the rollback", async () => {
        await fetch(process.env.S3_STUB + "/seen/abort");
      });
    `,
  });
  try {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "first.test.ts", "second.test.ts"],
      env: { ...env, S3_STUB: `http://127.0.0.1:${server.port}` },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exited] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // (More than one Abort: the store can get the one that was stopped before the upload knows.)
    expect({ ...reqs, abort: reqs.abort > 0, exited, stderr: exited === 0 ? "" : stderr }).toEqual({
      create: 1,
      part: 1,
      complete: 0,
      abort: true,
      exited: 0,
      stderr: "",
    });
  } finally {
    testEnded.resolve();
  }
});
