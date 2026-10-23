import { S3Client } from "bun";
import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";

// Serializing a FormData body (`new Response(formData)` / `new Request(..., { body: formData })`)
// goes through Blob::from_dom_form_data, which joins the multipart parts out of
// borrowed views of the FormData's strings and blob bytes. These tests lock in
// the exact wire format (boundary shape, part layout, name/filename escaping,
// content-type fallback), verify the serialize → parse round-trip (including
// non-ASCII strings and large binary payloads), and check that serialization
// does not duplicate in-memory blob contents.
describe("multipart serialization (new Response(formData))", () => {
  test("serializes string fields, blobs, unicode and escaped names exactly", async () => {
    const formData = new FormData();
    formData.append("simple", "value");
    formData.append("empty", "");
    formData.append("unicode name ☺", "ünïcode välue 😊");
    formData.append('quote"name', "v1");
    formData.append("crlf\r\nname", "v2");
    formData.append("untyped-blob", new Blob(["blob-bytes"]));
    formData.append("named-blob", new Blob(["named-bytes"]), "file.bin");
    formData.append("typed-file", new File(["<p>hi</p>"], 'weird"file\r\nname.html', { type: "text/html" }));

    const response = new Response(formData);
    const contentType = response.headers.get("Content-Type")!;
    expect(contentType).toMatch(/^multipart\/form-data; boundary=----WebKitFormBoundary[0-9a-f]{32}$/);
    const boundary = contentType.slice(contentType.indexOf("boundary=") + "boundary=".length);

    const text = await response.text();
    expect(text).toBe(
      [
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="simple"\r\n\r\nvalue\r\n`,
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="empty"\r\n\r\n\r\n`,
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="unicode name ☺"\r\n\r\nünïcode välue 😊\r\n`,
        `--${boundary}\r\n`,
        // '"', CR and LF in names/filenames are percent-encoded so they can't
        // break out of the quoted-string or inject part headers.
        `Content-Disposition: form-data; name="quote%22name"\r\n\r\nv1\r\n`,
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="crlf%0D%0Aname"\r\n\r\nv2\r\n`,
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="untyped-blob"; filename=""\r\n`,
        `Content-Type: application/octet-stream\r\n\r\nblob-bytes\r\n`,
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="named-blob"; filename="file.bin"\r\n`,
        `Content-Type: application/octet-stream\r\n\r\nnamed-bytes\r\n`,
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="typed-file"; filename="weird%22file%0D%0Aname.html"\r\n`,
        `Content-Type: text/html;charset=utf-8\r\n\r\n<p>hi</p>\r\n`,
        `--${boundary}--\r\n`,
      ].join(""),
    );
  });

  // https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#multipart-form-data
  // Step 1 of the encoding algorithm replaces every lone CR, lone LF, and CRLF
  // in an entry's name (and in its value when it is not a File) with CRLF,
  // before names/filenames are percent-encoded. Filenames are escaped but not
  // normalized, so lone CR / lone LF stay distinct there.
  test("normalizes lone CR and lone LF to CRLF in names and string values", async () => {
    const formData = new FormData();
    // All three newline spellings in a name must serialize identically.
    formData.append("a\rb", "1");
    formData.append("a\nb", "2");
    formData.append("a\r\nb", "3");
    // Non-File string value: newlines normalized to CRLF, never percent-encoded.
    formData.append("value", "x\ry\nz\r\nw");
    // Filename: percent-encoded only.
    formData.append("file", new Blob(["hi"]), "q\rw\ne");

    const response = new Response(formData);
    const contentType = response.headers.get("Content-Type")!;
    const boundary = contentType.slice(contentType.indexOf("boundary=") + "boundary=".length);

    expect(await response.text()).toBe(
      [
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="a%0D%0Ab"\r\n\r\n1\r\n`,
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="a%0D%0Ab"\r\n\r\n2\r\n`,
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="a%0D%0Ab"\r\n\r\n3\r\n`,
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="value"\r\n\r\nx\r\ny\r\nz\r\nw\r\n`,
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="file"; filename="q%0Dw%0Ae"\r\n`,
        `Content-Type: application/octet-stream\r\n\r\nhi\r\n`,
        `--${boundary}--\r\n`,
      ].join(""),
    );
  });

  test("normalizes newlines in a large string value", async () => {
    // 4 KiB runs of ordinary bytes between the newlines exercise the bulk-copy
    // path of the serializer's scan, not just the per-byte rewrites.
    const run = Buffer.alloc(4096, "a").toString();
    const formData = new FormData();
    formData.append("big", `${run}\r${run}\n${run}\r\n${run}`);

    const response = new Response(formData);
    const contentType = response.headers.get("Content-Type")!;
    const boundary = contentType.slice(contentType.indexOf("boundary=") + "boundary=".length);

    expect(await response.text()).toBe(
      `--${boundary}\r\nContent-Disposition: form-data; name="big"\r\n\r\n` +
        `${run}\r\n${run}\r\n${run}\r\n${run}\r\n` +
        `--${boundary}--\r\n`,
    );
  });

  test("round-trips every entry kind through Response.formData()", async () => {
    const formData = new FormData();
    formData.append("simple", "value");
    formData.append("dup", "first");
    formData.append("dup", "second");
    formData.append("unicode name ☺", "ünïcode välue 😊");
    formData.append("blob", new Blob(["blob-bytes"]));
    formData.append("file", new File(["<p>hi</p>"], "日本語ファイル名.html", { type: "text/html" }));

    const parsed = await new Response(formData).formData();
    const entries = await Promise.all(
      [...parsed.entries()].map(async ([name, value]) =>
        value instanceof Blob
          ? [
              name,
              { file: value instanceof File, name: (value as File).name, type: value.type, text: await value.text() },
            ]
          : [name, value],
      ),
    );

    expect(entries).toEqual([
      ["simple", "value"],
      ["dup", "first"],
      ["dup", "second"],
      ["unicode name ☺", "ünïcode välue 😊"],
      ["blob", { file: true, name: undefined as any, type: "application/octet-stream", text: "blob-bytes" }],
      ["file", { file: true, name: "日本語ファイル名.html", type: "text/html;charset=utf-8", text: "<p>hi</p>" }],
    ]);
  });

  test("round-trips large binary blob contents intact", async () => {
    const bytes = new Uint8Array(64 * 1024);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = (i * 31 + 7) & 0xff;
    }

    const formData = new FormData();
    formData.append("payload", new Blob([bytes]), "payload.bin");
    formData.append("after", "still-parses");

    const parsed = await new Response(formData).formData();
    const payload = parsed.get("payload") as File;
    expect(payload.size).toBe(bytes.length);
    expect(new Uint8Array(await payload.arrayBuffer())).toEqual(bytes);
    expect(parsed.get("after")).toBe("still-parses");
  });

  // Serializing an in-memory blob entry borrows its bytes; the only blob-sized
  // allocation made by `new Response(formData)` is the joined multipart body
  // itself, so peak memory grows by ~1x the blob size (measured ~1.0x on both
  // release and ASAN debug builds). Copying the blob's bytes into the joiner
  // (an extra full copy alive while the output is assembled) pushes the peak to
  // ~2x, which the 1.5x threshold catches with a wide margin on both sides.
  // Linux-only: peak RSS is read from /proc/self/status (VmHWM), which has no
  // portable equivalent.
  test.skipIf(!isLinux)("does not duplicate in-memory blob bytes while serializing", async () => {
    const blobSizeMB = 128;
    const script = `
      const blobSizeMB = ${blobSizeMB};
      const bytes = Buffer.alloc(blobSizeMB * 1024 * 1024, 0x61);
      // Two parts force the Blob to materialize its own store now, so the
      // baseline below already includes one copy of the payload and the only
      // thing measured across the Response constructor is serialization.
      const blob = new Blob([bytes, "x"]);
      const formData = new FormData();
      formData.append("payload", blob, "payload.bin");
      formData.append("field", "value");

      function peakRssMB() {
        const status = require("fs").readFileSync("/proc/self/status", "utf8");
        const start = status.indexOf("VmHWM:");
        return parseInt(status.slice(start + "VmHWM:".length), 10) / 1024;
      }

      const before = peakRssMB();
      const response = new Response(formData);
      const after = peakRssMB();
      console.log(JSON.stringify({ deltaMB: after - before, alive: response instanceof Response }));
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) {
      // Surface the crashed child's own error output in the assertion diff.
      expect(stderr).toBe("");
    }

    const { deltaMB, alive } = JSON.parse(stdout.trim());
    expect(alive).toBe(true);
    // Sanity: the serialized body was actually materialized during the sample.
    expect(deltaMB).toBeGreaterThan(blobSizeMB * 0.5);
    // An extra copy of the blob bytes would put this at ~2x the blob size.
    expect(deltaMB).toBeLessThan(blobSizeMB * 1.5);
    expect(exitCode).toBe(0);
  });
});

// An S3 file has no bytes in memory, and the serializer does not wait for a
// download. Its part used to go out as the part headers and an empty body: no
// S3 request, no error, and the receiver stored an empty file. Such a body is
// now a stream, and each object is requested when the stream reaches its part.
describe("multipart serialization of S3-backed entries", () => {
  type S3Request = { method: string; path: string; range: string | null };

  const key = "reports/2026.csv";
  const object = "0123456789abcdef";

  // A local server that plays the S3 endpoint. It honors `Range` and logs each request.
  function fakeS3(objects: Record<string, string | Uint8Array> = { [key]: object }) {
    const requests: S3Request[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        const range = request.headers.get("range");
        requests.push({ method: request.method, path, range });
        const stored = objects[path.slice("/bucket/".length)];
        if (stored === undefined) {
          return new Response(
            `<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>`,
            { status: 404, headers: { "Content-Type": "application/xml" } },
          );
        }
        const bytes = Buffer.from(stored);
        const window = /^bytes=(\d+)-(\d*)$/.exec(range ?? "");
        if (!window) return new Response(bytes);
        const first = Number(window[1]);
        const last = window[2] === "" ? bytes.length - 1 : Math.min(Number(window[2]), bytes.length - 1);
        return new Response(bytes.subarray(first, last + 1), { status: 206 });
      },
    });
    const credentials = { endpoint: server.url.href, accessKeyId: "access-key", secretAccessKey: "secret-key" };
    const s3 = new S3Client({ ...credentials, bucket: "bucket" });
    return {
      requests,
      credentials,
      s3,
      // A request that was sent earlier has arrived when this one has its answer.
      async settle() {
        expect(await s3.file("settle").exists()).toBe(false);
        return requests.splice(0).filter(request => request.path !== "/bucket/settle");
      },
      [Symbol.dispose]: () => void server.stop(true),
    };
  }

  function getOf(path = key, range: string | null = null): S3Request {
    return { method: "GET", path: `/bucket/${path}`, range };
  }

  function formDataWith(entry: Blob): FormData {
    const formData = new FormData();
    formData.append("before", "first");
    formData.append("report", entry, "2026.csv");
    formData.append("after", "last");
    return formData;
  }

  function boundaryOf(contentType: string | null): string {
    expect(contentType).toMatch(/^multipart\/form-data; boundary=----WebKitFormBoundary[0-9a-f]{32}$/);
    return contentType!.slice(contentType!.indexOf("boundary=") + "boundary=".length);
  }

  // The body of `formDataWith(entry)` when the entry holds `content`.
  function bodyWith(boundary: string, content: string): string {
    return [
      `--${boundary}\r\nContent-Disposition: form-data; name="before"\r\n\r\nfirst\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="report"; filename="2026.csv"\r\n`,
      `Content-Type: application/octet-stream\r\n\r\n${content}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="after"\r\n\r\nlast\r\n`,
      `--${boundary}--\r\n`,
    ].join("");
  }

  type Endpoint = ReturnType<typeof fakeS3>;

  test.each<[string, (endpoint: Endpoint) => Blob, string, S3Request[]]>([
    ["S3Client.file()", ({ s3 }) => s3.file(key), object, [getOf()]],
    [
      'Bun.file("s3://...")',
      ({ credentials }) => Bun.file(`s3://bucket/${key}`, credentials as BlobPropertyBag),
      object,
      [getOf()],
    ],
    ["a slice of an S3 file", ({ s3 }) => s3.file(key).slice(2, 6), "2345", [getOf(key, "bytes=2-5")]],
    // These share the store of the S3 file. They do not copy it.
    ["new File([s3file], name)", ({ s3 }) => new File([s3.file(key)], "wrapped.csv"), object, [getOf()]],
    ["new Blob([s3file])", ({ s3 }) => new Blob([s3.file(key)]), object, [getOf()]],
    ["an entry of another FormData", ({ s3 }) => formDataWith(s3.file(key)).get("report") as Blob, object, [getOf()]],
    // A window of no bytes is an empty part, and needs no request.
    ["a zero-length slice of an S3 file", ({ s3 }) => s3.file(key).slice(0, 0), "", []],
  ])("new Response(formData) reads %s when the body is read", async (_label, makeEntry, content, expected) => {
    using endpoint = fakeS3();
    const response = new Response(formDataWith(makeEntry(endpoint)));

    // The boundary is known at once. The object is not requested yet.
    const boundary = boundaryOf(response.headers.get("Content-Type"));
    expect(response.bodyUsed).toBe(false);
    expect(await endpoint.settle()).toEqual([]);

    expect(await response.text()).toBe(bodyWith(boundary, content));
    expect(await endpoint.settle()).toEqual(expected);
  });

  test("formData.set() and formData.append() give the same body", async () => {
    using endpoint = fakeS3();
    const formData = new FormData();
    formData.set("before", "first");
    formData.set("report", endpoint.s3.file(key), "2026.csv");
    formData.set("after", "last");

    const response = new Response(formData);
    const boundary = boundaryOf(response.headers.get("Content-Type"));
    expect(await response.text()).toBe(bodyWith(boundary, object));
  });

  test("S3 parts and in-memory parts arrive in entry order", async () => {
    // Larger than one chunk of the download, so a part arrives in several pieces.
    const large = Buffer.alloc(3 * 1024 * 1024, "abcdefghijklmnopqrstuvwxyz").toString();
    using endpoint = fakeS3({ [key]: object, "large.bin": large });
    const formData = new FormData();
    formData.append("first", endpoint.s3.file("large.bin"), "large.bin");
    formData.append("second", endpoint.s3.file(key, { type: "text/csv" }), "2026.csv");
    formData.append("memory", new Blob(["in memory"]), "memory.txt");
    formData.append("third", endpoint.s3.file(key).slice(10), "tail.csv");

    const response = new Response(formData);
    const boundary = boundaryOf(response.headers.get("Content-Type"));
    const text = await response.text();
    // Compared by length first: a diff of 3 MB strings is not readable.
    const expected = [
      `--${boundary}\r\nContent-Disposition: form-data; name="first"; filename="large.bin"\r\n`,
      `Content-Type: application/octet-stream\r\n\r\n${large}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="second"; filename="2026.csv"\r\n`,
      `Content-Type: text/csv\r\n\r\n${object}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="memory"; filename="memory.txt"\r\n`,
      `Content-Type: application/octet-stream\r\n\r\nin memory\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="third"; filename="tail.csv"\r\n`,
      `Content-Type: application/octet-stream\r\n\r\n${object.slice(10)}\r\n`,
      `--${boundary}--\r\n`,
    ].join("");
    expect(text.length).toBe(expected.length);
    expect(text === expected).toBe(true);

    const requests = await endpoint.settle();
    expect(requests.map(request => request.path)).toEqual(["/bucket/large.bin", `/bucket/${key}`, `/bucket/${key}`]);
    expect(requests[2].range).toStartWith("bytes=10-");
  });

  test("new Request() reads the object when the body is read", async () => {
    using endpoint = fakeS3();
    const request = new Request("http://localhost/upload", {
      method: "POST",
      body: formDataWith(endpoint.s3.file(key)),
    });
    const contentType = request.headers.get("Content-Type");
    const boundary = boundaryOf(contentType);
    expect(await endpoint.settle()).toEqual([]);

    // A Request made from a Request takes its body.
    const copy = new Request(request);
    expect(copy.headers.get("Content-Type")).toBe(contentType);
    expect(await copy.text()).toBe(bodyWith(boundary, object));
    expect(await endpoint.settle()).toEqual([getOf()]);
  });

  test("every reader of the body gets the object", async () => {
    using endpoint = fakeS3();
    const make = () => new Response(formDataWith(endpoint.s3.file(key)));

    const viaBytes = make();
    const expected = bodyWith(boundaryOf(viaBytes.headers.get("Content-Type")), object);
    expect(new TextDecoder().decode(await viaBytes.bytes())).toBe(expected);

    const viaArrayBuffer = make();
    expect(new TextDecoder().decode(await viaArrayBuffer.arrayBuffer())).toBe(
      bodyWith(boundaryOf(viaArrayBuffer.headers.get("Content-Type")), object),
    );

    const viaReader = make();
    let read = "";
    const decoder = new TextDecoder();
    for await (const chunk of viaReader.body!) read += decoder.decode(chunk, { stream: true });
    expect(read).toBe(bodyWith(boundaryOf(viaReader.headers.get("Content-Type")), object));

    const viaBlob = make();
    const contentType = viaBlob.headers.get("Content-Type");
    const blob = await viaBlob.blob();
    expect(blob.type).toBe(contentType!);
    expect(await blob.text()).toBe(bodyWith(boundaryOf(contentType), object));

    const parsed = await make().formData();
    const report = parsed.get("report") as File;
    expect({
      before: parsed.get("before"),
      name: report.name,
      type: report.type,
      text: await report.text(),
      after: parsed.get("after"),
    }).toEqual({
      before: "first",
      name: "2026.csv",
      type: "application/octet-stream",
      text: object,
      after: "last",
    });

    // One request for each of the five bodies.
    expect(await endpoint.settle()).toEqual([getOf(), getOf(), getOf(), getOf(), getOf()]);
  });

  test("Bun.write() stores the body with the object", async () => {
    using endpoint = fakeS3();
    using dir = tempDir("formdata-s3-part", {});
    const response = new Response(formDataWith(endpoint.s3.file(key)));
    const expected = bodyWith(boundaryOf(response.headers.get("Content-Type")), object);

    const path = join(String(dir), "body.bin");
    expect(await Bun.write(path, response)).toBe(expected.length);
    expect(await Bun.file(path).text()).toBe(expected);
  });

  test("a body is what the FormData held when the body was made", async () => {
    using endpoint = fakeS3();
    const formData = formDataWith(endpoint.s3.file(key));
    const response = new Response(formData);
    const boundary = boundaryOf(response.headers.get("Content-Type"));

    formData.set("report", "replaced");
    formData.append("extra", "late");

    expect(await response.text()).toBe(bodyWith(boundary, object));
  });

  test("two bodies of one FormData both have the object", async () => {
    using endpoint = fakeS3();
    const formData = formDataWith(endpoint.s3.file(key));
    const first = new Response(formData);
    const second = new Response(formData);

    expect(await first.text()).toBe(bodyWith(boundaryOf(first.headers.get("Content-Type")), object));
    expect(await second.text()).toBe(bodyWith(boundaryOf(second.headers.get("Content-Type")), object));
    expect(await endpoint.settle()).toEqual([getOf(), getOf()]);
  });

  // Serialization used to write size 0 into the entry. The next read of the S3 file then asked for `bytes=0-0`.
  test("the entry keeps its unknown size and still reads as the whole object", async () => {
    using endpoint = fakeS3();
    const formData = formDataWith(endpoint.s3.file(key));
    expect((formData.get("report") as Blob).size).toBeNaN();

    await new Response(formData).text();

    const entry = formData.get("report") as Blob;
    expect(entry.size).toBeNaN();
    expect(await entry.text()).toBe(object);
    expect(await endpoint.settle()).toEqual([getOf(), getOf()]);
  });

  test("clone() gives both bodies the object from one request", async () => {
    using endpoint = fakeS3();
    const response = new Response(formDataWith(endpoint.s3.file(key)));
    const clone = response.clone();

    const contentType = response.headers.get("Content-Type");
    expect(clone.headers.get("Content-Type")).toBe(contentType);
    const expected = bodyWith(boundaryOf(contentType), object);
    expect(await Promise.all([response.text(), clone.text()])).toEqual([expected, expected]);
    expect(await endpoint.settle()).toEqual([getOf()]);
  });

  test("a second read of the body rejects", async () => {
    using endpoint = fakeS3();
    const response = new Response(formDataWith(endpoint.s3.file(key)));
    await response.text();

    expect(response.bodyUsed).toBe(true);
    expect(
      await response.text().then(
        () => "resolved",
        error => error.code,
      ),
    ).toBe("ERR_BODY_ALREADY_USED");
    expect(await endpoint.settle()).toEqual([getOf()]);
  });

  test("a body that is cancelled before a read requests nothing", async () => {
    using endpoint = fakeS3();
    const response = new Response(formDataWith(endpoint.s3.file(key)));

    await response.body!.cancel();

    expect(response.bodyUsed).toBe(true);
    expect(await endpoint.settle()).toEqual([]);
  });

  test.each([
    ["the first S3 part", ["missing.csv", key]],
    ["a later S3 part", [key, "missing.csv"]],
  ])("an object that cannot be read rejects the reader when it is %s", async (_label, keys) => {
    using endpoint = fakeS3();
    const formData = new FormData();
    for (const name of keys) formData.append(name, endpoint.s3.file(name), name);

    // The constructor does not read, so it does not throw.
    const response = new Response(formData);
    boundaryOf(response.headers.get("Content-Type"));

    const error = await response.text().then(
      () => {
        throw new Error("text() resolved");
      },
      rejection => rejection,
    );
    expect({ name: error.name, code: error.code, path: error.path }).toEqual({
      name: "S3Error",
      code: "NoSuchKey",
      path: "missing.csv",
    });
    expect((await endpoint.settle()).map(request => request.path)).toEqual(
      keys.slice(0, keys.indexOf("missing.csv") + 1).map(name => `/bucket/${name}`),
    );
  });

  describe("fetch()", () => {
    type Upload = {
      transferEncoding: string | null;
      contentLength: string | null;
      contentType: string | null;
      body: string;
    };

    // Receives uploads at /upload and answers /redirect with a 307 to it.
    function receiver() {
      const uploads: Upload[] = [];
      const posts: string[] = [];
      const server = Bun.serve({
        port: 0,
        async fetch(request) {
          const path = new URL(request.url).pathname;
          posts.push(path);
          if (path === "/redirect") {
            return new Response(null, { status: 307, headers: { Location: "/upload" } });
          }
          uploads.push({
            transferEncoding: request.headers.get("Transfer-Encoding"),
            contentLength: request.headers.get("Content-Length"),
            contentType: request.headers.get("Content-Type"),
            body: await request.text(),
          });
          return new Response("stored");
        },
      });
      return { uploads, posts, url: server.url, [Symbol.dispose]: () => void server.stop(true) };
    }

    test.each<[string, (url: string, body: FormData) => Promise<Response>]>([
      ["fetch(url, { body: formData })", (url, body) => fetch(url, { method: "POST", body })],
      ["fetch(new Request(url, { body: formData }))", (url, body) => fetch(new Request(url, { method: "POST", body }))],
    ])("%s uploads the object", async (_label, send) => {
      using endpoint = fakeS3();
      using uploaded = receiver();

      const response = await send(`${uploaded.url}upload`, formDataWith(endpoint.s3.file(key)));
      expect(await response.text()).toBe("stored");

      expect(uploaded.uploads).toHaveLength(1);
      const [upload] = uploaded.uploads;
      // The length of the object is not known when the request starts.
      expect({ transferEncoding: upload.transferEncoding, contentLength: upload.contentLength }).toEqual({
        transferEncoding: "chunked",
        contentLength: null,
      });
      expect(upload.body).toBe(bodyWith(boundaryOf(upload.contentType), object));
      expect(await endpoint.settle()).toEqual([getOf()]);
    });

    test("rejects with the S3 error when the object cannot be read", async () => {
      using endpoint = fakeS3();
      using uploaded = receiver();

      const error = await fetch(`${uploaded.url}upload`, {
        method: "POST",
        body: formDataWith(endpoint.s3.file("missing.csv")),
      }).then(
        response => {
          throw new Error(`fetch() resolved with status ${response.status}`);
        },
        rejection => rejection,
      );
      expect({ name: error.name, code: error.code }).toEqual({ name: "S3Error", code: "NoSuchKey" });
      expect(uploaded.uploads).toEqual([]);
    });

    // The body is a stream, and a stream cannot be sent a second time. A body that is an S3 file has the same limit.
    test("rejects a redirect that needs the body again", async () => {
      using endpoint = fakeS3();
      using uploaded = receiver();

      const error = await fetch(`${uploaded.url}redirect`, {
        method: "POST",
        body: formDataWith(endpoint.s3.file(key)),
      }).then(
        response => {
          throw new Error(`fetch() resolved with status ${response.status}`);
        },
        rejection => rejection,
      );
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toBe("Request body is a ReadableStream and cannot be replayed for this redirect");
      expect(uploaded.posts).toEqual(["/redirect"]);
      expect(uploaded.uploads).toEqual([]);
    });
  });

  test("a Bun.serve() handler can answer with the FormData", async () => {
    using endpoint = fakeS3();
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response(formDataWith(endpoint.s3.file(key))),
    });

    const response = await fetch(server.url);
    const contentType = response.headers.get("Content-Type");
    expect(await response.text()).toBe(bodyWith(boundaryOf(contentType), object));
    expect(await endpoint.settle()).toEqual([getOf()]);
  });

  describe("lifetime", () => {
    function streams(): number {
      Bun.gc(true);
      return heapStats().objectTypeCounts.ReadableStream ?? 0;
    }

    test("a body that nothing reads is collected, and requests nothing", async () => {
      using endpoint = fakeS3();
      const make = () => void new Response(formDataWith(endpoint.s3.file(key)));
      for (let i = 0; i < 10; i++) make();
      const before = streams();

      for (let i = 0; i < 200; i++) make();

      expect(streams() - before).toBeLessThanOrEqual(10);
      expect(await endpoint.settle()).toEqual([]);
    });

    test("a body whose reader cancels in the middle of an object is collected", async () => {
      // The endpoint sends the start of the object and then nothing more.
      const requests: string[] = [];
      using server = Bun.serve({
        port: 0,
        idleTimeout: 0,
        fetch(request) {
          requests.push(new URL(request.url).pathname);
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("start of the object"));
              },
            }),
          );
        },
      });
      const s3 = new S3Client({
        endpoint: server.url.href,
        bucket: "bucket",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
      });
      async function readThenCancel() {
        const reader = new Response(formDataWith(s3.file(key))).body!.getReader();
        const decoder = new TextDecoder();
        let read = "";
        while (!read.includes("start of the object")) {
          const { value, done } = await reader.read();
          expect(done).toBe(false);
          read += decoder.decode(value, { stream: true });
        }
        await reader.cancel();
      }
      for (let i = 0; i < 5; i++) await readThenCancel();
      const before = streams();

      for (let i = 0; i < 30; i++) await readThenCancel();

      expect(streams() - before).toBeLessThanOrEqual(5);
      expect(requests).toHaveLength(35);
    });
  });
});
