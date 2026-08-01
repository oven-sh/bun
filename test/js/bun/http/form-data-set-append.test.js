import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/29630
// FormData must produce a boundary matching WebKit exactly:
//   declared: "----WebKitFormBoundary{hex}" (4 leading dashes, capital K)
//   body markers: "------WebKitFormBoundary{hex}" (6 dashes)
// Previously Bun emitted "-WebkitFormBoundary{hex}" (1 dash, lowercase k),
// which produced 3-dash body markers — a format no other mainstream client
// uses and which trips buggy downstream multipart parsers.
test("FormData request body uses WebKit-compatible boundary (#29630)", async () => {
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "application/octet-stream" }), "page-17.pdf");
  fd.append("purpose", "user_data");

  const req = new Request("http://localhost/", { method: "POST", body: fd });

  const contentType = req.headers.get("content-type");
  // Must match WebKit exactly: 4 leading dashes, capital K, followed by 32 hex chars
  expect(contentType).toMatch(/^multipart\/form-data; boundary=----WebKitFormBoundary[0-9a-f]{32}$/);

  const boundary = contentType.slice("multipart/form-data; boundary=".length);

  const body = await req.text();
  // Body markers are "--" + boundary, so 6 dashes before WebKitFormBoundary.
  expect(body.startsWith(`--${boundary}\r\n`)).toBe(true);
  expect(body.startsWith("------WebKitFormBoundary")).toBe(true);
  // Terminator is "--" + boundary + "--\r\n".
  expect(body.endsWith(`\r\n--${boundary}--\r\n`)).toBe(true);
});

test("FormData via Response uses WebKit-compatible boundary (#29630)", async () => {
  const fd = new FormData();
  fd.append("field", "value");

  const res = new Response(fd);
  const contentType = res.headers.get("content-type");
  expect(contentType).toMatch(/^multipart\/form-data; boundary=----WebKitFormBoundary[0-9a-f]{32}$/);

  const body = await res.text();
  expect(body.startsWith("------WebKitFormBoundary")).toBe(true);
});

// https://github.com/oven-sh/bun/issues/12325
test("formdata set with File works as expected", async () => {
  const expected = ["617580375", "text-notes1.txt"];

  using server = Bun.serve({
    port: 0,
    fetch: async req => {
      const data = await req.formData();
      const chat_id = data.get("chat_id");
      const document = data.get("document");
      expect(chat_id).toEqual(expected[0]);
      expect(document.name).toEqual(expected[1]);
      return new Response("");
    },
  });

  async function sendDocument(body) {
    const response = await fetch(server.url, {
      method: "POST",
      body: body,
    });
    const text = await response.text();
    return text;
  }

  const formDataSet = new FormData();
  formDataSet.set("chat_id", expected[0]);
  formDataSet.set("document", new File(["some text notes 1"], expected[1]));
  await sendDocument(formDataSet);
});

test("formdata apppend with File works as expected", async () => {
  const expected = ["617580376", "text-notes2.txt"];

  using server = Bun.serve({
    port: 0,
    fetch: async req => {
      const data = await req.formData();
      const chat_id = data.get("chat_id");
      const document = data.get("document");
      expect(chat_id).toEqual(expected[0]);
      expect(document.name).toEqual(expected[1]);
      return new Response("");
    },
  });

  async function sendDocument(body) {
    const response = await fetch(server.url, {
      method: "POST",
      body: body,
    });
    const text = await response.text();
    return text;
  }

  const formDataSet = new FormData();
  formDataSet.append("chat_id", expected[0]);
  formDataSet.append("document", new File(["some text notes 2"], expected[1]));
  await sendDocument(formDataSet);
});
