import { describe, expect, test } from "bun:test";

// Serializing a FormData body (`new Response(formData)` / `new Request(..., { body: formData })`)
// goes through Blob::from_dom_form_data, which joins the multipart parts out of
// borrowed views of the FormData's strings and blob bytes. These tests lock in
// the exact wire format (boundary shape, part layout, name/filename escaping,
// content-type fallback) and verify the serialize → parse round-trip, including
// non-ASCII strings and large binary payloads.
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
      ["blob", { file: true, name: undefined, type: "", text: "blob-bytes" }],
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
});
