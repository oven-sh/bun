import { expect, test } from "bun:test";

// A malformed multipart Content-Type with a lone double-quote after boundary=
// used to panic in FormData.getBoundary (src/url.zig) because it treated the
// lone quote as both the opening and closing quote and produced an invalid
// slice range.
test('Response.formData() rejects on boundary=" (lone double-quote)', async () => {
  const response = new Response("body", {
    headers: { "content-type": 'multipart/form-data; boundary="' },
  });
  expect(response.formData()).rejects.toThrow();
});

test('Request.formData() rejects on boundary=" (lone double-quote)', async () => {
  const request = new Request("http://example.com", {
    method: "POST",
    body: "body",
    headers: { "content-type": 'multipart/form-data; boundary="' },
  });
  expect(request.formData()).rejects.toThrow();
});

test('Blob.formData() rejects on boundary=" (lone double-quote)', async () => {
  const blob = new Blob(["body"], { type: 'multipart/form-data; boundary="' });
  expect(blob.formData()).rejects.toThrow();
});

test('Response.formData() rejects on boundary="abc (unclosed double-quote)', async () => {
  const response = new Response("body", {
    headers: { "content-type": 'multipart/form-data; boundary="abc' },
  });
  expect(response.formData()).rejects.toThrow();
});

test('Response.formData() rejects on boundary="; (lone double-quote before semicolon)', async () => {
  const response = new Response("body", {
    headers: { "content-type": 'multipart/form-data; boundary="; charset=utf-8' },
  });
  expect(response.formData()).rejects.toThrow();
});
