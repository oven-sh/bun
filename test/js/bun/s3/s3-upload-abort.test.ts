import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// An upload that can never finish must be aborted on the server and released
// natively: the queued part buffers are freed, a started multipart upload gets
// an AbortMultipartUpload, and nothing keeps the event loop alive.
//
// The stub counts each S3 request and the child prints the counts at exit.
// `body` runs with `client` in scope and must leave the upload abandoned.
// The child then waits for `waitFor` before it runs `then`. With `gateCreate`,
// the stub holds the CreateMultipartUpload response until `then` ran. The stub answers
// AbortMultipartUpload with `abortStatus` (204, as S3 does, by default). `answer` has, for a kind
// of request, an expression for the response that replaces the usual one.
function fixture(opts: {
  body: string;
  waitFor: string;
  then?: string;
  gateCreate?: boolean;
  retry?: number;
  abortStatus?: number;
  answer?: { create?: string; part?: string; complete?: string; put?: string };
}) {
  const answer = (kind: keyof NonNullable<typeof opts.answer>) =>
    opts.answer?.[kind] ? `return ${opts.answer[kind]};` : "";
  return `
    const error = (status, code) =>
      new Response("<Error><Code>" + code + "</Code><Message>message</Message></Error>", { status });
    const reqs = { create: 0, part: 0, complete: 0, abort: 0, put: 0 };
    const createGate = Promise.withResolvers();
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (req.method === "HEAD") return new Response("");
        if (req.method === "POST" && url.searchParams.has("uploads")) {
          reqs.create++;
          ${opts.gateCreate ? "await createGate.promise;" : ""}
          ${answer("create")}
          return new Response(
            "<InitiateMultipartUploadResult><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>",
            { headers: { "content-type": "application/xml" } },
          );
        }
        if (req.method === "PUT") {
          await req.arrayBuffer();
          if (url.searchParams.has("uploadId")) {
            reqs.part++;
            ${answer("part")}
            return new Response("", { headers: { ETag: '"etag"' } });
          }
          reqs.put++;
          ${answer("put")}
          return new Response("");
        }
        if (req.method === "DELETE") {
          reqs.abort++;
          return new Response("", { status: ${opts.abortStatus ?? 204} });
        }
        await req.text();
        reqs.complete++;
        ${answer("complete")}
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
  S3_BUCKET: undefined,
  AWS_BUCKET: undefined,
};

async function run(opts: Parameters<typeof fixture>[0], extraEnv: Record<string, string> = {}) {
  using dir = tempDir("s3-upload-abort", {});
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture(opts)],
    env: { ...env, ...extraEnv },
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

// The stream is unlocked when write() checks it. An option getter locks it before the upload starts.
test.concurrent("an upload that rejects because the stream is locked doesn't read from the stream", async () => {
  const body = `
    const bytes = new TextEncoder().encode("hello");
    const stream = new ReadableStream({ type: "bytes", pull(c) { c.enqueue(bytes.slice()); c.close(); } });
    let reader;
    const result = await client.file("key").write(stream, {
      get accessKeyId() { reader ??= stream.getReader({ mode: "byob" }); return "key"; },
    }).then(() => "resolved", e => "rejected: " + e.code);
    const { value } = await reader.read(new Uint8Array(16));
    console.log(result, new TextDecoder().decode(value));
  `;
  expect(await run({ body, waitFor: `true` })).toEqual({
    stdout: `rejected: ERR_INVALID_STATE hello\n{"create":0,"part":0,"complete":0,"abort":0,"put":0}\n`,
    stderr: "",
    exited: 0,
  });
});

// A native stream that holds a whole part before anything reads it.
const rewritten = (then: string) => `
  let input;
  const appended = Promise.withResolvers();
  const ended = Promise.withResolvers();
  const { body } = new HTMLRewriter()
    .on("p", { element: e => void e.append(Buffer.alloc(partSize, "a").toString()) })
    .on("i", { element: () => appended.resolve() })
    .onDocument({ end: () => ended.resolve() })
    .transform(new Response(new ReadableStream({ start: c => void (input = c) })));
  input.enqueue(new TextEncoder().encode("<p></p><i></i>"));
  ${then}
`;

// Signing fails inside the write that fills the first part, which also fills the queue.
test.concurrent.each([
  [
    "a later write",
    `const origin = Bun.serve({ port: 0, fetch: () => new Response(new Uint8Array(partSize + 1024 * 1024)) });
     origin.unref();
     const { body } = await fetch(origin.url);`,
  ],
  ["the first write", rewritten(`await appended.promise;`)],
  ["its only write", rewritten(`input.close(); await ended.promise;`)],
])("a request that cannot be signed fails the upload of a native stream in %s", async (_, makeBody) => {
  const body = `
    ${makeBody}
    const tooLongOnceEncoded = Buffer.alloc(400, "!").toString();
    const result = await client
      .write(tooLongOnceEncoded, body, { ...opts, queueSize: 1 })
      .then(() => "resolved", e => "rejected: " + e.code);
    console.log(result);
  `;
  expect(await run({ body, waitFor: `true` })).toEqual({
    stdout: `rejected: ERR_S3_INVALID_PATH\n{"create":0,"part":0,"complete":0,"abort":0,"put":0}\n`,
    stderr: "",
    exited: 0,
  });
});

// Without a bucket no request can be signed. The refusal happens inside the write that fills a part, or inside end().
test.concurrent.each([
  ["one request", `(w => (w.write("hello"), w.end()))(unsigned.file("key").writer(opts))`],
  ["in parts", `(w => (w.write(new Uint8Array(partSize)), w.end()))(unsigned.file("key").writer(opts))`],
])("a writer() that cannot be signed rejects: %s", async (_, upload) => {
  const body = `
    const unsigned = new Bun.S3Client({ endpoint: server.url.origin, accessKeyId: "key", secretAccessKey: "secret" });
    console.log(await Promise.resolve(${upload}).then(() => "resolved", e => "rejected: " + e.code));
  `;
  expect(await run({ body, waitFor: `true`, retry: 1 })).toEqual({
    stdout: `rejected: ERR_S3_INVALID_PATH\n{"create":0,"part":0,"complete":0,"abort":0,"put":0}\n`,
    stderr: "",
    exited: 0,
  });
});

test.concurrent("fetch() releases its promise when the body is cancelled before the upload starts", async () => {
  const body = `
    const held = () => require("bun:jsc").heapStats().protectedObjectTypeCounts.Promise ?? 0;
    let rejections = 0;
    process.on("unhandledRejection", () => rejections++);
    const before = held();
    for (let i = 0; i < 20; i++) {
      const stream = new ReadableStream();
      fetch("s3://bucket/key", {
        method: "PUT",
        body: stream,
        get s3() {
          stream.cancel();
          return { endpoint: server.url.origin, accessKeyId: "key", secretAccessKey: "secret" };
        },
      });
    }
  `;
  expect(await run({ body, waitFor: `rejections === 20`, then: `console.log(held() - before < 5);` })).toEqual({
    stdout: `true\n{"create":0,"part":0,"complete":0,"abort":0,"put":0}\n`,
    stderr: "",
    exited: 0,
  });
});

// What settles in a disposed graph calls nobody, so the stream's pump never lets go of the upload.
test.concurrent("a stream upload whose graph is disposed during the commit lets the process exit", async () => {
  const body = `
    const graph = new Bun.ModuleGraph();
    graph.run(() => {
      client.write("key", new ReadableStream({ start(c) { c.enqueue(new Uint8Array(partSize)); c.close(); } }), opts);
    });
  `;
  expect(
    await run(
      {
        body,
        waitFor: `reqs.complete === 1`,
        then: `graph.dispose(); while (Date.now() < deadline && reqs.abort === 0) await Bun.sleep(10);`,
        answer: { complete: `createGate.promise.then(() => new Response(""))` },
      },
      { BUN_JSC_useGC: "0" },
    ),
  ).toEqual({
    stdout: `{"create":1,"part":1,"complete":1,"abort":1,"put":0}\n`,
    stderr: "",
    exited: 0,
  });
});

// `pull` keeps what its controller returns in `got`. All of it has settled by the time the upload has.
const direct = (pull: string) => `
  const got = {};
  const show = p => Bun.peek.status(p) === "pending" ? "pending" : p.then(String, e => "rejected: " + (e.code ?? e.message));
  const upload = client.file("key").write(new ReadableStream({ type: "direct", ${pull} }), { ...opts, queueSize: 1 });
  got.upload = upload;
  await upload.catch(() => {});
  for (const key of Object.keys(got).sort()) console.log(key, await show(got[key]));
`;
test.concurrent.each([
  {
    name: "end(), one request",
    pull: `async pull(c) { await 0; c.write("hello"); got.end = c.end(); }`,
    stdout: `end 5\nupload 5\n{"create":0,"part":0,"complete":0,"abort":0,"put":1}\n`,
  },
  {
    name: "end(), the request is refused",
    pull: `pull(c) { c.write("hello"); got.end = c.end(); }`,
    answer: { put: `error(403, "AccessDenied")` },
    stdout: `end rejected: AccessDenied\nupload rejected: AccessDenied\n{"create":0,"part":0,"complete":0,"abort":0,"put":1}\n`,
  },
  {
    name: "flush() and end(), in parts",
    pull: `pull(c) { c.write(new Uint8Array(partSize + 1)); got.flush = c.flush(); got.end = c.end(); }`,
    stdout: `end 5242881\nflush 0\nupload 5242881\n{"create":1,"part":2,"complete":1,"abort":0,"put":0}\n`,
  },
  {
    name: "flush() and close()",
    pull: `async pull(c) { await 0; c.write(new Uint8Array(partSize)); got.flush = c.flush(); c.close(); }`,
    stdout: `flush 0\nupload 5242880\n{"create":1,"part":1,"complete":1,"abort":0,"put":0}\n`,
  },
  {
    name: "write() and flush(), pull() throws",
    pull: `pull(c) { got.write = c.write(new Uint8Array(partSize)); got.flush = c.flush(); throw new Error("thrown"); }`,
    stdout: `flush rejected: thrown\nupload rejected: thrown\nwrite false\n{"create":1,"part":0,"complete":0,"abort":1,"put":0}\n`,
  },
])("a direct stream's promises settle: $name", async ({ pull, answer, stdout }) => {
  expect(await run({ body: direct(pull), waitFor: `true`, answer })).toEqual({ stdout, stderr: "", exited: 0 });
});

test.concurrent("a direct stream's promises that nobody kept are not unhandled rejections", async () => {
  const body = direct(`pull(c) { c.write(new Uint8Array(partSize)); c.flush(); c.end(); }`);
  expect(await run({ body, waitFor: `true`, answer: { create: `error(403, "AccessDenied")` } })).toEqual({
    stdout: `upload rejected: AccessDenied\n{"create":1,"part":0,"complete":0,"abort":0,"put":0}\n`,
    stderr: "",
    exited: 0,
  });
});

test.concurrent.each([
  ["succeeds", undefined],
  ["fails", `error(403, "AccessDenied")`],
])("an async iterator is closed after its upload %s", async (_, put) => {
  const body = `
    let returned = false;
    const chunks = ["hello"];
    const iterator = {
      next: async () => ({ done: chunks.length === 0, value: chunks.pop() }),
      return: async () => ((returned = true), {}),
    };
    await client.write("key", new Response({ [Symbol.asyncIterator]: () => iterator }), opts).catch(() => {});
  `;
  expect(await run({ body, waitFor: `returned`, answer: { put } })).toEqual({
    stdout: `{"create":0,"part":0,"complete":0,"abort":0,"put":1}\n`,
    stderr: "",
    exited: 0,
  });
});

// The HEAD request starts after the refusal was sent, so the writer has handled it when HEAD is answered.
const refused = {
  create: { waitFor: `reqs.create === 1`, reqs: `{"create":1,"part":0,"complete":0,"abort":0,"put":0}` },
  part: { waitFor: `reqs.abort === 1`, reqs: `{"create":1,"part":1,"complete":0,"abort":1,"put":0}` },
};
test.concurrent.each([
  ["create", "end"],
  ["create", "flush"],
  ["part", "end"],
  ["part", "flush"],
] as const)("a writer() whose %s request failed with nothing pending rejects the next %s()", async (kind, method) => {
  const then = `
    await client.exists("key");
    const show = p => Promise.resolve(p).then(String, e => [e.name, e.code, e.message, e.path].join());
    console.log(w.write("hello"), await show(w.${method}()), await show(w.flush()), await show(w.end()));
  `;
  expect(
    await run({
      body: `const w = client.file("key").writer(opts); w.write(new Uint8Array(partSize));`,
      waitFor: refused[kind].waitFor,
      then,
      answer: { [kind]: `error(403, "AccessDenied")` },
    }),
  ).toEqual({
    stdout: `0 S3Error,AccessDenied,message,key 0 0\n${refused[kind].reqs}\n`,
    stderr: "",
    exited: 0,
  });
});

test.concurrent("a writer()'s failure is not reported once its graph is disposed", async () => {
  const body = `
    const graph = new Bun.ModuleGraph();
    const w = graph.run(() => client.file("key").writer(opts));
    w.write(new Uint8Array(partSize));
  `;
  expect(
    await run({
      body,
      waitFor: refused.part.waitFor,
      then: `graph.dispose(); console.log(w.end());`,
      answer: { part: `error(403, "AccessDenied")` },
    }),
  ).toEqual({ stdout: `0\n${refused.part.reqs}\n`, stderr: "", exited: 0 });
});

test.concurrent.each([
  ["its code", `error(404, "NoSuchBucket")`, "NoSuchBucket message"],
  ["no body", `new Response("", { status: 404 })`, "UnknownError Failed to initiate multipart upload"],
])("CreateMultipartUpload answered 404 with %s", async (_, create, expected) => {
  const body = `
    const w = client.file("key").writer(opts);
    w.write(new Uint8Array(partSize));
    console.log(await w.end().then(String, e => e.code + " " + e.message));
  `;
  expect(await run({ body, waitFor: `true`, answer: { create } })).toEqual({
    stdout: `${expected}\n{"create":1,"part":0,"complete":0,"abort":0,"put":0}\n`,
    stderr: "",
    exited: 0,
  });
});
