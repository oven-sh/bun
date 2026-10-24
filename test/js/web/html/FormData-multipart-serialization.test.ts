import { randomUUIDv7, S3Client } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";
import { serve, type S3Server } from "s3-server";

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
      ["blob", { file: true, name: undefined as any, type: "", text: "blob-bytes" }],
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

// The serializer is synchronous and an S3 object's bytes can only be fetched
// asynchronously, so an S3-backed entry cannot be serialized. It used to be
// written out as the part headers followed by an empty body: no error, no S3
// request, and the receiver stored an empty file.
describe("multipart serialization of S3-backed entries", () => {
  const object = "id,name\n1,bun\n";
  const remedy = "new File([await s3file.bytes()], s3file.name, { type: s3file.type })";

  let server: S3Server;
  let client: S3Client;
  beforeAll(() => {
    server = serve({ buckets: ["bucket"] });
    client = new S3Client(server.clientOptions("bucket"));
  });
  afterAll(() => server.stop());

  /** An S3 file under a new key. Nothing is stored there: only one test downloads. */
  function s3Object(type?: string) {
    const key = `${randomUUIDv7()}.csv`;
    return {
      key,
      file: () => client.file(key, { type }),
      /** The operation and the Range header of each request for the key so far. */
      requests: () =>
        server.requests
          .filter(request => request.key === key)
          .map(request => [request.operation, request.headers.get("range")]),
    };
  }

  // `quotedName` is the entry name as the message renders it, quotes included.
  function messageFor(quotedName: string): string {
    return (
      `FormData entry ${quotedName} is an S3 file, which cannot be read while the body is serialized. ` +
      `Pass its bytes instead: ${remedy}`
    );
  }

  function formDataWith(entry: Blob, name = "report"): FormData {
    const formData = new FormData();
    formData.append("before", "first");
    formData.append(name, entry, "reports/2026.csv");
    formData.append("after", "last");
    return formData;
  }

  // What `fn` throws, or what the promise it returns rejects with.
  async function failureOf(fn: () => unknown): Promise<unknown> {
    try {
      await fn();
    } catch (error) {
      return error;
    }
    throw new Error("did not fail");
  }

  const shapes: [string, (file: Bun.S3File) => Blob][] = [
    ["S3Client.file()", file => file],
    ["a slice of an S3 file", file => file.slice(2, 5)],
    ["new File([s3file], name)", file => new File([file], "wrapped.csv")],
  ];
  const consumers: [string, (formData: FormData, url: URL) => unknown][] = [
    ["new Response(formData)", formData => new Response(formData)],
    ["new Request(url, { body })", (formData, url) => new Request(url, { method: "POST", body: formData })],
    ["fetch(url, { body })", (formData, url) => fetch(url, { method: "POST", body: formData })],
  ];

  describe.each(shapes)("%s", (_shape, makeEntry) => {
    test.each(consumers)("%s fails and sends nothing", async (_consumer, consume) => {
      const stored = s3Object("text/csv");
      let received = 0;
      using receiver = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch() {
          received++;
          return new Response("stored");
        },
      });
      const formData = formDataWith(makeEntry(stored.file()));
      const sizeBefore = (formData.get("report") as Blob).size;

      const error = await failureOf(() => consume(formData, receiver.url));
      expect(error).toBeInstanceOf(TypeError);
      expect({
        message: (error as TypeError).message,
        s3Requests: stored.requests(),
        received,
        sizeAfter: (formData.get("report") as Blob).size,
      }).toEqual({
        message: messageFor('"report"'),
        s3Requests: [],
        received: 0,
        sizeAfter: sizeBefore,
      });
    });
  });

  test('new Response(formData) fails for Bun.file("s3://...")', async () => {
    const formData = formDataWith(Bun.file("s3://bucket/reports/2026.csv"));

    const error = await failureOf(() => new Response(formData));
    expect(error).toBeInstanceOf(TypeError);
    expect((error as TypeError).message).toBe(messageFor('"report"'));
  });

  test.each([
    ["a plain name", "report", '"report"'],
    ["a non-ASCII name", "レポート ☺", '"レポート ☺"'],
    ["a name containing a quote", 'quote"name', '"quote\\"name"'],
    ["a name containing CRLF", "crlf\r\nname", '"crlf\\r\\nname"'],
  ])("the message quotes %s", async (_label, name, quotedName) => {
    const formData = formDataWith(s3Object().file(), name);

    const error = await failureOf(() => new Response(formData));
    expect((error as TypeError).message).toBe(messageFor(quotedName));
  });

  // The entries before the S3 file are ones the serializer can write.
  test("the message names the first S3 file, after a Blob and an empty S3 slice", async () => {
    const stored = s3Object();
    const formData = new FormData();
    formData.append("blob", new Blob(["in memory"]), "blob.txt");
    formData.append("empty", stored.file().slice(4, 4), "empty.csv");
    formData.append("first", stored.file(), "first.csv");
    formData.append("second", stored.file(), "second.csv");

    const error = await failureOf(() => new Response(formData));
    expect(error).toBeInstanceOf(TypeError);
    expect({ message: (error as TypeError).message, s3Requests: stored.requests() }).toEqual({
      message: messageFor('"first"'),
      s3Requests: [],
    });
  });

  test("the message names the first of two entries that hold the same S3 file", async () => {
    const s3file = s3Object().file();
    const formData = new FormData();
    formData.append("text", "value");
    formData.append("one", s3file);
    formData.append("two", s3file);

    const error = await failureOf(() => new Response(formData));
    expect(error).toBeInstanceOf(TypeError);
    expect((error as TypeError).message).toBe(messageFor('"one"'));
  });

  // An empty window of an S3 object has no bytes to fetch.
  test.each([
    ["slice(0, 0)", 0],
    ["slice(3, 3)", 3],
  ])("s3file.%s serializes as an empty part", async (_label, at) => {
    const stored = s3Object("text/csv");
    const formData = new FormData();
    formData.append("report", stored.file().slice(at, at), "empty.csv");
    formData.append("after", "last");

    const response = new Response(formData);
    const contentType = response.headers.get("Content-Type")!;
    const boundary = contentType.slice(contentType.indexOf("boundary=") + "boundary=".length);
    expect({ body: await response.text(), s3Requests: stored.requests() }).toEqual({
      body:
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="report"; filename="empty.csv"\r\n` +
        `Content-Type: text/csv\r\n\r\n\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="after"\r\n\r\nlast\r\n` +
        `--${boundary}--\r\n`,
      s3Requests: [],
    });
  });

  // Each of these calls used to leave the size of the S3 file at 0, which
  // made the file look like an empty window.
  test.each<[string, (s3file: Bun.S3File) => unknown]>([
    ["structuredClone()", s3file => structuredClone(s3file)],
    ["postMessage()", s3file => new MessageChannel().port1.postMessage(s3file)],
    ["expect().toHaveLength()", s3file => expect(s3file).toHaveLength(0)],
  ])("an S3 file still fails after %s asked for its size", async (_label, ask) => {
    const stored = s3Object("text/csv");
    const s3file = stored.file();
    try {
      ask(s3file);
    } catch {}

    const error = await failureOf(() => new Response(formDataWith(s3file)));
    expect(error).toBeInstanceOf(TypeError);
    expect({ message: (error as TypeError).message, size: s3file.size, s3Requests: stored.requests() }).toEqual({
      message: messageFor('"report"'),
      size: NaN,
      s3Requests: [],
    });
  });

  // Runs the expression the message prints, character for character.
  test("the File that the message says to pass uploads the bytes, the type and the filename", async () => {
    const stored = s3Object("text/csv");
    await client.write(stored.key, object);
    const s3file = stored.file();
    const error = await failureOf(() => new Response(formDataWith(s3file)));
    const printed = (error as TypeError).message.slice((error as TypeError).message.indexOf("new File("));
    expect(printed).toBe(remedy);

    const AsyncFunction = (async () => {}).constructor as new (...args: string[]) => (s3file: Blob) => Promise<File>;
    const formData = new FormData();
    formData.append("report", await new AsyncFunction("s3file", `return ${printed};`)(s3file));

    const response = new Response(formData);
    const contentType = response.headers.get("Content-Type")!;
    const boundary = contentType.slice(contentType.indexOf("boundary=") + "boundary=".length);
    expect({ body: await response.text(), s3Requests: stored.requests() }).toEqual({
      body:
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="report"; filename="${stored.key}"\r\n` +
        `Content-Type: text/csv\r\n\r\n${object}\r\n` +
        `--${boundary}--\r\n`,
      s3Requests: [
        ["PutObject", null],
        ["GetObject", null],
      ],
    });
  });
});
