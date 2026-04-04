import { test } from "bun:test";

// A malformed multipart Content-Type with a single quote after boundary=
// used to panic in FormData.getBoundary (src/url.zig) because it treated the
// lone quote as both the opening and closing quote and produced an invalid
// slice range.
test('Response.formData() does not crash on boundary=" (single quote)', async () => {
  const response = new Response("body", {
    headers: { "content-type": 'multipart/form-data; boundary="' },
  });
  // Either rejects or resolves — we only care that it does NOT panic.
  await response.formData().catch(() => {});
});

test('Request.formData() does not crash on boundary=" (single quote)', async () => {
  const request = new Request("http://example.com", {
    method: "POST",
    body: "body",
    headers: { "content-type": 'multipart/form-data; boundary="' },
  });
  await request.formData().catch(() => {});
});

test('Blob.formData() does not crash on boundary=" (single quote)', async () => {
  const blob = new Blob(["body"], { type: 'multipart/form-data; boundary="' });
  await blob.formData().catch(() => {});
});
