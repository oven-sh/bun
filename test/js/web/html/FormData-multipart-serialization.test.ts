import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";

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
      ["blob", { file: true, name: undefined, type: "application/octet-stream", text: "blob-bytes" }],
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
