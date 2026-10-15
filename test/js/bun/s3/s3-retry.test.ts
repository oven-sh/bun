import { S3Client, type S3Options } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import net from "node:net";
import path from "node:path";

type Asked = {
  method: string;
  target: string;
  headers: Record<string, string>;
  body: string;
  /** When the request had arrived, and when its answer was sent. */
  at: number;
  answered: number;
  /** Its connection closed: the client has read the answer. */
  closed: Promise<void>;
};
type Answer = { status: number; body?: string; headers?: Record<string, string> } | "cut";
type Plan = (asked: Asked) => Answer | Promise<Answer>;

const isCreate = (asked: Asked) => asked.method === "POST" && asked.target.endsWith("?uploads=");
const isPart = (asked: Asked) => asked.method === "PUT" && asked.target.includes("partNumber=");
const isComplete = (asked: Asked) => asked.method === "POST" && asked.target.includes("?uploadId=");
const isAbort = (asked: Asked) => asked.method === "DELETE" && asked.target.includes("?uploadId=");

/** What a bucket answers when nothing is wrong. */
function ok(asked: Asked): Answer {
  if (isCreate(asked)) {
    return {
      status: 200,
      body: "<InitiateMultipartUploadResult><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>",
    };
  }
  if (isComplete(asked)) {
    return { status: 200, body: "<CompleteMultipartUploadResult><ETag>etag</ETag></CompleteMultipartUploadResult>" };
  }
  if (asked.method === "DELETE") return { status: 204 };
  if (asked.method === "HEAD") return { status: 200, headers: { "Content-Length": "5", ETag: '"etag"' } };
  if (asked.target.includes("list-type=2")) {
    return { status: 200, body: "<ListBucketResult><Name>bucket</Name></ListBucketResult>" };
  }
  if (asked.method === "GET") return { status: 200, body: "hello" };
  return { status: 200, headers: { ETag: '"etag"' } };
}

const error = (code: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`;
const fails = (status: number, code: string, headers?: Record<string, string>): Answer => ({
  status,
  headers,
  body: error(code),
});
/** The first request that `matches` gets `answer`. */
function once(answer: Answer, matches: (asked: Asked) => boolean = () => true): Plan {
  let given = false;
  return asked => {
    if (given || !matches(asked)) return ok(asked);
    given = true;
    return answer;
  };
}
/** Every request that `matches` gets `answer`. */
function always(answer: Answer, matches: (asked: Asked) => boolean = () => true): Plan {
  return asked => (matches(asked) ? answer : ok(asked));
}

/** A bucket on loopback that answers each request as `plan` says, and keeps what it was asked. */
async function bucket(plan: Plan) {
  const asked: Asked[] = [];
  const waiting: { matches: (asked: Asked) => boolean; resolve: (asked: Asked) => void }[] = [];
  const server = net.createServer(socket => {
    const closed = Promise.withResolvers<void>();
    const chunks: Buffer[] = [];
    let size = 0;
    let headEnd = -1;
    let length = 0;
    socket.on("error", () => {});
    socket.on("close", () => closed.resolve());
    socket.on("data", async chunk => {
      chunks.push(chunk as Buffer);
      size += chunk.length;
      if (headEnd === -1) {
        const head = Buffer.concat(chunks);
        headEnd = head.indexOf("\r\n\r\n");
        if (headEnd === -1) return;
        chunks.splice(0, chunks.length, head);
        length = Number(/\r\ncontent-length: *(\d+)/i.exec(head.subarray(0, headEnd).toString("latin1"))?.[1] ?? 0);
      }
      if (size < headEnd + 4 + length) return;
      const received = Buffer.concat(chunks);
      const [line, ...lines] = received.subarray(0, headEnd).toString("latin1").split("\r\n");
      const [method, target] = line.split(" ");
      const request: Asked = {
        method,
        target,
        headers: Object.fromEntries(
          lines.map(header => {
            const colon = header.indexOf(":");
            return [header.slice(0, colon).toLowerCase(), header.slice(colon + 1).trim()];
          }),
        ),
        // A part is megabytes: its size is all a test reads.
        body: length > 1024 ? `${length} bytes` : received.subarray(headEnd + 4).toString(),
        at: performance.now(),
        answered: 0,
        closed: closed.promise,
      };
      asked.push(request);
      for (const waiter of waiting.splice(0)) {
        if (waiter.matches(request)) waiter.resolve(request);
        else waiting.push(waiter);
      }
      const answer = await plan(request);
      request.answered = performance.now();
      if (answer === "cut") return socket.destroy();
      const content = method === "HEAD" ? "" : (answer.body ?? "");
      const headers = Object.entries({ "Content-Length": String(Buffer.byteLength(content)), ...answer.headers })
        .map(([name, value]) => `${name}: ${value}\r\n`)
        .join("");
      socket.end(`HTTP/1.1 ${answer.status} Answer\r\n${headers}Connection: close\r\n\r\n${content}`);
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const options: S3Options = {
    accessKeyId: "access-key",
    secretAccessKey: "secret-key",
    bucket: "bucket",
    endpoint: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`,
  };
  return {
    asked,
    options,
    client: (retry?: number) => new S3Client(retry === undefined ? options : { ...options, retry }),
    /** Each request as its method and query. The parts of one upload arrive in any order. */
    requests: () =>
      asked.map(request =>
        isPart(request) ? "PUT part" : `${request.method} ${request.target.replace(/^[^?]*/, "")}`.trim(),
      ),
    /** The time from each answer to the request after it, in ms. */
    waits: () => asked.slice(1).map((request, index) => request.at - asked[index].answered),
    /** The next request that `matches`, once it has arrived. */
    next: (matches: (asked: Asked) => boolean) => {
      const { promise, resolve } = Promise.withResolvers<Asked>();
      waiting.push({ matches, resolve });
      return promise;
    },
    [Symbol.asyncDispose]: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}
type Bucket = Awaited<ReturnType<typeof bucket>>;

/** How `call` ended, and what the bucket was asked. */
async function outcome(stub: Bucket, call: (stub: Bucket) => Promise<unknown>) {
  const ended = await call(stub).then(
    () => "resolved",
    error => String(error?.code ?? error),
  );
  return { ended, requests: stub.requests() };
}

/**
 * A bucket for an upload that waits to be sent again, and a request after it that tells when it
 * does: the PUT is told to come back in a minute, and the HEAD is answered once the connection
 * of the PUT has closed. A client has the answers in that order, so when it has the second one
 * its upload waits.
 */
function bucketOfAWaitingUpload() {
  const upload = Promise.withResolvers<Asked>();
  return bucket(async asked => {
    if (asked.method === "PUT") {
      upload.resolve(asked);
      return fails(503, "SlowDown", { "Retry-After": "60" });
    }
    await (
      await upload.promise
    ).closed;
    return ok(asked);
  });
}

const part = Buffer.alloc(5 * 1024 * 1024, "a");
const files = tempDir("s3-retry", { "hello.txt": "hello" });
afterAll(() => files[Symbol.dispose]());
const helloFile = () => Bun.file(path.join(String(files), "hello.txt"));

const create = "POST ?uploads=";
const complete = "POST ?uploadId=upload-1";
const abort = "DELETE ?uploadId=upload-1";
const put = (count: number) => Array.from({ length: count }, () => "PUT");

/** An upload of `parts` parts, one part at a time. */
const inParts =
  (parts: number, retry?: number) =>
  async ({ client }: Bucket) => {
    const writer = client().file("key").writer({ retry, partSize: part.length, queueSize: 1 });
    for (let sent = 0; sent < parts; sent++) writer.write(part);
    await writer.end();
  };
/** `inParts`, and then the request that rolls the upload back when it fails. */
const inPartsThenAbort = (parts: number, retry?: number) => async (stub: Bucket) => {
  const aborted = stub.next(isAbort);
  try {
    await inParts(parts, retry)(stub);
  } finally {
    await aborted;
  }
};

describe.concurrent("S3 retry", () => {
  describe("an upload that takes one request is sent again", () => {
    const doors: [string, (stub: Bucket) => Promise<unknown>][] = [
      ["client.write(key, string)", stub => stub.client(5).write("key", "hello")],
      ["client.write(key, '')", stub => stub.client(5).write("key", "")],
      ["client.write(key, Uint8Array)", stub => stub.client(5).write("key", new TextEncoder().encode("hello"))],
      ["client.write(key, Blob)", stub => stub.client(5).write("key", new Blob(["hello"]))],
      ["client.write(key, Response)", stub => stub.client(5).write("key", new Response("hello"))],
      ["client.write(key, Bun.file)", stub => stub.client(5).write("key", helloFile())],
      ["S3Client.write(key, string, options)", stub => S3Client.write("key", "hello", { ...stub.options, retry: 5 })],
      ["file.write(string)", stub => stub.client(5).file("key").write("hello")],
      ["Bun.write(file, string)", stub => Bun.write(stub.client(5).file("key"), "hello")],
      ["Bun.write('s3://key', string, options)", stub => Bun.write("s3://key", "hello", { ...stub.options, retry: 5 })],
      [
        "file.writer(), one part",
        async stub => {
          const writer = stub.client(5).file("key").writer();
          writer.write("hello");
          await writer.end();
        },
      ],
    ];
    test.each(doors)("%s", async (_, door) => {
      await using stub = await bucket(once(fails(503, "SlowDown")));
      expect(await outcome(stub, door)).toEqual({ ended: "resolved", requests: ["PUT", "PUT"] });
      // Never at once: 250 ms, less 20% at most.
      expect(stub.waits()[0]).toBeGreaterThanOrEqual(200);
    });
  });

  describe("until `retry` is used up, and only after a failure another attempt can get past", () => {
    const write = (retry?: number) => (stub: Bucket) => stub.client(retry).write("key", "hello");
    const writer = (retry?: number) => async (stub: Bucket) => {
      const writer = stub.client(retry).file("key").writer();
      writer.write("hello");
      await writer.end();
    };
    const unavailable = () => always(fails(503, "SlowDown"));
    const rows: [string, () => Plan, (stub: Bucket) => Promise<unknown>, string, number][] = [
      ["the default is 3 more attempts", unavailable, write(), "SlowDown", 4],
      ["retry: 0 sends it once", unavailable, write(0), "SlowDown", 1],
      ["retry: 0 on the client of a writer() sends it once", unavailable, writer(0), "SlowDown", 1],
      [
        "the retry of the call wins over the client's",
        unavailable,
        stub => stub.client(5).write("key", "hello", { retry: 1 }),
        "SlowDown",
        2,
      ],
      [
        "also when the call uploads a file",
        unavailable,
        stub => stub.client(5).file("key").write(helloFile(), { retry: 0 }),
        "SlowDown",
        1,
      ],
      ["500", () => once(fails(500, "InternalError")), write(), "resolved", 2],
      ["502", () => once(fails(502, "BadGateway")), write(), "resolved", 2],
      ["504", () => once(fails(504, "GatewayTimeout")), write(), "resolved", 2],
      ["429", () => once(fails(429, "TooManyRequests")), write(), "resolved", 2],
      ["408", () => once(fails(408, "RequestTimeout")), write(), "resolved", 2],
      ["400 RequestTimeout", () => once(fails(400, "RequestTimeout")), write(), "resolved", 2],
      ["a connection that closes with no answer", () => once("cut"), write(), "resolved", 2],
      ["a connection that closes every time", () => always("cut"), write(2), "ConnectionClosed", 3],
      ["not 403", () => always(fails(403, "AccessDenied")), write(), "AccessDenied", 1],
      ["not 403, through a writer()", () => always(fails(403, "AccessDenied")), writer(), "AccessDenied", 1],
      ["not another 400", () => always(fails(400, "InvalidArgument")), write(), "InvalidArgument", 1],
      ["not 404", () => always(fails(404, "NoSuchBucket")), write(), "NoSuchBucket", 1],
    ];
    test.each(rows)("%s", async (_, plan, call, ended, count) => {
      await using stub = await bucket(plan());
      expect(await outcome(stub, call)).toEqual({ ended, requests: put(count) });
    });
  });

  describe("after a wait", () => {
    test("that doubles with each attempt", async () => {
      await using stub = await bucket(always(fails(503, "SlowDown")));
      expect(await outcome(stub, stub => stub.client(2).write("key", "hello"))).toEqual({
        ended: "SlowDown",
        requests: put(3),
      });
      // 250 ms, then 500 ms, each less 20% at most.
      const [first, second] = stub.waits();
      expect(first).toBeGreaterThanOrEqual(200);
      expect(second).toBeGreaterThanOrEqual(400);
    });

    test("as long as Retry-After asks, and with a new signature", async () => {
      await using stub = await bucket(once(fails(503, "SlowDown", { "Retry-After": "1" })));
      await stub.client().write("key", "hello", { type: "text/plain", acl: "public-read" });
      const [first, second] = stub.asked;
      expect(stub.waits()[0]).toBeGreaterThanOrEqual(1000);
      const sent = (asked: Asked) => ({
        request: `${asked.method} ${asked.target}`,
        body: asked.body,
        type: asked.headers["content-type"],
        acl: asked.headers["x-amz-acl"],
      });
      expect(sent(second)).toEqual(sent(first));
      expect(sent(first)).toEqual({
        request: "PUT /bucket/key",
        body: "hello",
        type: "text/plain;charset=utf-8",
        acl: "public-read",
      });
      // The date is signed, and a second has passed.
      expect(second.headers["x-amz-date"]).not.toBe(first.headers["x-amz-date"]);
      expect(second.headers.authorization).not.toBe(first.headers.authorization);
    });

    test("with the credentials of the call, when it gave its own", async () => {
      await using stub = await bucket(once(fails(503, "SlowDown")));
      await stub.client().write("key", "hello", { accessKeyId: "other-key", secretAccessKey: "other-secret" });
      expect(stub.asked.map(asked => /Credential=([^/]+)/.exec(asked.headers.authorization)?.[1])).toEqual([
        "other-key",
        "other-key",
      ]);
    });
  });

  describe("a request that is not an upload is sent once", () => {
    const reads: [string, (client: S3Client) => Promise<unknown>, string][] = [
      ["file.text()", client => client.file("key").text(), "GET"],
      ["exists()", client => client.exists("key"), "HEAD"],
      ["stat()", client => client.stat("key"), "HEAD"],
      ["delete()", client => client.delete("key"), "DELETE"],
      ["list()", client => client.list(), "GET ?list-type=2"],
    ];
    test.each(reads)("%s", async (_, call, request) => {
      await using stub = await bucket(always(fails(503, "SlowDown")));
      await call(stub.client(5)).catch(() => {});
      expect(stub.requests()).toEqual([request]);
    });
  });

  describe("each request of a multipart upload is sent again by the same rule", () => {
    const rows: [string, () => Plan, (stub: Bucket) => Promise<unknown>, string, string[]][] = [
      [
        "CreateMultipartUpload",
        () => once(fails(503, "SlowDown"), isCreate),
        inParts(1),
        "resolved",
        [create, create, "PUT part", complete],
      ],
      [
        "CreateMultipartUpload, until `retry` is used up",
        () => always(fails(503, "SlowDown"), isCreate),
        inParts(1, 2),
        "SlowDown",
        [create, create, create],
      ],
      [
        "CreateMultipartUpload, not after a 403",
        () => always(fails(403, "AccessDenied"), isCreate),
        inParts(1),
        "AccessDenied",
        [create],
      ],
      [
        "CreateMultipartUpload, not when the connection closed with no answer: the bucket may have made the upload",
        () => once("cut", isCreate),
        inParts(1),
        "ConnectionClosed",
        [create],
      ],
      [
        "a part",
        () => once(fails(503, "SlowDown"), isPart),
        inParts(2),
        "resolved",
        [create, "PUT part", "PUT part", "PUT part", complete],
      ],
      [
        "a part that is answered 200 with no ETag",
        () => once({ status: 200 }, isPart),
        inParts(1),
        "resolved",
        [create, "PUT part", "PUT part", complete],
      ],
      [
        "a part, not after a 403: the upload is rolled back",
        () => always(fails(403, "AccessDenied"), isPart),
        inPartsThenAbort(2),
        "AccessDenied",
        [create, "PUT part", abort],
      ],
      [
        "CompleteMultipartUpload that is answered 200 with an error",
        () => once({ status: 200, body: error("InternalError") }, isComplete),
        inParts(1),
        "resolved",
        [create, "PUT part", complete, complete],
      ],
      [
        "CompleteMultipartUpload whose connection closes with no answer",
        () => once("cut", isComplete),
        inParts(1),
        "resolved",
        [create, "PUT part", complete, complete],
      ],
      [
        "CompleteMultipartUpload, not after a 403: the upload is rolled back",
        () => always(fails(403, "AccessDenied"), isComplete),
        inPartsThenAbort(1),
        "AccessDenied",
        [create, "PUT part", complete, abort],
      ],
    ];
    test.each(rows)("%s", async (_, plan, call, ended, requests) => {
      await using stub = await bucket(plan());
      expect(await outcome(stub, call)).toEqual({ ended, requests });
    });

    test("AbortMultipartUpload, and each with the whole of `retry`", async () => {
      // CompleteMultipartUpload uses up `retry`, and AbortMultipartUpload has it again.
      await using stub = await bucket(always(fails(503, "SlowDown"), asked => isComplete(asked) || isAbort(asked)));
      const aborted = stub.next(isAbort).then(() => stub.next(isAbort));
      expect(await outcome(stub, inParts(1, 1))).toEqual({
        ended: "SlowDown",
        requests: [create, "PUT part", complete, complete],
      });
      await aborted;
      expect(stub.requests()).toEqual([create, "PUT part", complete, complete, abort, abort]);
    });
  });

  describe("an upload that waits to be sent again is dropped", () => {
    test("when its worker is terminated", async () => {
      await using stub = await bucketOfAWaitingUpload();
      const worker = new Worker(
        URL.createObjectURL(
          new Blob([
            `const client = new Bun.S3Client(${JSON.stringify(stub.options)});
             client.write("key", "hello").catch(() => {});
             await client.exists("fence");
             postMessage("the upload waits");`,
          ]),
        ),
      );
      await new Promise(resolve => worker.addEventListener("message", resolve, { once: true }));
      const closed = new Promise(resolve => worker.addEventListener("close", resolve, { once: true }));
      worker.terminate();
      await closed;
      expect(stub.requests().sort()).toEqual(["HEAD", "PUT"]);
    });

    test("when its module graph is disposed: it does not keep the process running", async () => {
      await using stub = await bucketOfAWaitingUpload();
      using dir = tempDir("s3-retry-graph", {
        "uploads.mjs": `
          export const upload = options => void new Bun.S3Client(options).write("key", "hello").catch(() => {});
        `,
        "main.mjs": `
          const options = ${JSON.stringify(stub.options)};
          const graph = new Bun.ModuleGraph();
          const app = await graph.import(import.meta.dir + "/uploads.mjs");
          graph.run(() => app.upload(options));
          await new Bun.S3Client(options).exists("fence");
          graph.dispose();
          // Not process.exit(): an upload that still waited would keep this process here for a minute.
          console.log("idle");
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.mjs"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect({ stdout: stdout.trim(), requests: stub.requests().sort() }).toEqual({
        stdout: "idle",
        requests: ["HEAD", "PUT"],
      });
      expect(exitCode).toBe(0);
    });

    test("when its upload failed meanwhile", async () => {
      // CreateMultipartUpload waits about 250 ms. The write after it waits a second, so when
      // that one is sent again the first wait is over.
      let fences = 0;
      await using stub = await bucket(asked => {
        if (isCreate(asked)) return fails(503, "SlowDown");
        return fences++ === 0 ? fails(503, "SlowDown", { "Retry-After": "1" }) : ok(asked);
      });
      const created = stub.next(isCreate);
      let pulls = 0;
      const source = new ReadableStream({
        async pull(controller) {
          if (pulls++ === 0) return controller.enqueue(part);
          await (
            await created
          ).closed;
          controller.error(new Error("the source failed"));
        },
      });
      const upload = stub.client().write("key", new Response(source), { partSize: part.length });
      expect(
        await upload.then(
          () => "resolved",
          error => error.message,
        ),
      ).toBe("the source failed");
      await stub.client().write("fence", "hello");
      expect(stub.requests()).toEqual([create, "PUT", "PUT"]);
    });
  });
});
