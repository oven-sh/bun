import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/21788
// When a plain Blob (not a File) is appended to FormData without an explicit
// filename, the XHR spec says the filename should default to "blob".
// Previously Bun set it to "" (empty string).

test("FormData.set with Blob defaults filename to 'blob'", async () => {
  using server = Bun.serve({
    port: 0,
    fetch(req) {
      return req.text().then(t => new Response(t));
    },
  });

  const formData = new FormData();
  formData.set("file", new Blob(["hello"], { type: "text/plain" }));

  const res = await fetch(server.url, { method: "POST", body: formData });
  const text = await res.text();

  // The Content-Disposition header in the multipart body should contain filename="blob"
  expect(text).toContain('filename="blob"');
});

test("FormData.append with Blob defaults filename to 'blob'", async () => {
  using server = Bun.serve({
    port: 0,
    fetch(req) {
      return req.text().then(t => new Response(t));
    },
  });

  const formData = new FormData();
  formData.append("file", new Blob(["hello"], { type: "text/plain" }));

  const res = await fetch(server.url, { method: "POST", body: formData });
  const text = await res.text();

  expect(text).toContain('filename="blob"');
});

test("FormData.set with Blob and explicit filename uses provided name", async () => {
  using server = Bun.serve({
    port: 0,
    fetch(req) {
      return req.text().then(t => new Response(t));
    },
  });

  const formData = new FormData();
  formData.set("file", new Blob(["hello"], { type: "text/plain" }), "custom.txt");

  const res = await fetch(server.url, { method: "POST", body: formData });
  const text = await res.text();

  expect(text).toContain('filename="custom.txt"');
});

test("FormData.set with File preserves File name", async () => {
  using server = Bun.serve({
    port: 0,
    fetch(req) {
      return req.text().then(t => new Response(t));
    },
  });

  const formData = new FormData();
  formData.set("file", new File(["hello"], "myfile.txt", { type: "text/plain" }));

  const res = await fetch(server.url, { method: "POST", body: formData });
  const text = await res.text();

  expect(text).toContain('filename="myfile.txt"');
});

test("FormData.get returns File with name 'blob' for plain Blob", () => {
  const formData = new FormData();
  formData.set("file", new Blob(["hello"], { type: "text/plain" }));

  const entry = formData.get("file");
  expect(entry).toBeInstanceOf(File);
  expect((entry as File).name).toBe("blob");
});
