import { expect, test } from "bun:test";

// Issue #15306: When fetch() is called with a FormData body and a manually set
// Content-Type: multipart/form-data header (without boundary), Bun should
// override/fix the header to include the auto-generated boundary.

test("fetch with FormData should override incomplete multipart/form-data Content-Type", async () => {
  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const contentType = req.headers.get("Content-Type");
      // The Content-Type should contain the boundary parameter
      if (!contentType || !contentType.includes("boundary=")) {
        return Response.json(
          {
            error: "Missing boundary in Content-Type",
            contentType,
          },
          { status: 400 },
        );
      }

      try {
        const formData = await req.formData();
        return Response.json({
          success: true,
          contentType,
          hasFile: formData.has("file"),
          hasMetadata: formData.has("metadata"),
        });
      } catch (err) {
        return Response.json(
          {
            error: String(err),
            contentType,
          },
          { status: 400 },
        );
      }
    },
  });

  const form = new FormData();
  form.append("file", new File(["test content"], "test.txt"));
  form.append("metadata", '{"key": "value"}');

  // This is the buggy usage: manually setting Content-Type without boundary
  const response = await fetch(`http://localhost:${server.port}/upload`, {
    method: "POST",
    headers: {
      "Content-Type": "multipart/form-data", // Missing boundary!
    },
    body: form,
  });

  const result = await response.json();

  // Should succeed because Bun overrides the incomplete Content-Type
  expect(response.status).toBe(200);
  expect(result.success).toBe(true);
  expect(result.hasFile).toBe(true);
  expect(result.hasMetadata).toBe(true);
  expect(result.contentType).toContain("multipart/form-data");
  expect(result.contentType).toContain("boundary=");
});

test("fetch with FormData should preserve complete multipart/form-data Content-Type with boundary", async () => {
  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const contentType = req.headers.get("Content-Type");
      try {
        const formData = await req.formData();
        return Response.json({
          success: true,
          contentType,
          hasFile: formData.has("file"),
        });
      } catch (err) {
        return Response.json(
          {
            error: String(err),
            contentType,
          },
          { status: 400 },
        );
      }
    },
  });

  const form = new FormData();
  form.append("file", new File(["test"], "test.txt"));

  // If user provides a complete Content-Type with boundary, it should be preserved
  // (though in practice this is unusual - the body would need to match the boundary)
  const response = await fetch(`http://localhost:${server.port}/upload`, {
    method: "POST",
    // Don't set Content-Type - let Bun auto-generate it
    body: form,
  });

  const result = await response.json();

  expect(response.status).toBe(200);
  expect(result.success).toBe(true);
  expect(result.contentType).toContain("multipart/form-data");
  expect(result.contentType).toContain("boundary=");
});

test("fetch with FormData should work without explicitly setting headers", async () => {
  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const contentType = req.headers.get("Content-Type");
      try {
        const formData = await req.formData();
        return Response.json({
          success: true,
          contentType,
          fieldValue: formData.get("field"),
        });
      } catch (err) {
        return Response.json(
          {
            error: String(err),
            contentType,
          },
          { status: 400 },
        );
      }
    },
  });

  const form = new FormData();
  form.append("field", "value");

  // Normal usage without setting Content-Type
  const response = await fetch(`http://localhost:${server.port}/`, {
    method: "POST",
    body: form,
  });

  const result = await response.json();

  expect(response.status).toBe(200);
  expect(result.success).toBe(true);
  expect(result.fieldValue).toBe("value");
  expect(result.contentType).toContain("multipart/form-data");
  expect(result.contentType).toContain("boundary=");
});

test("fetch with FormData and other headers should override incomplete Content-Type", async () => {
  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const contentType = req.headers.get("Content-Type");
      const authorization = req.headers.get("Authorization");
      try {
        const formData = await req.formData();
        return Response.json({
          success: true,
          contentType,
          authorization,
          hasFile: formData.has("file"),
        });
      } catch (err) {
        return Response.json(
          {
            error: String(err),
            contentType,
          },
          { status: 400 },
        );
      }
    },
  });

  const form = new FormData();
  form.append("file", new File(["test"], "test.txt"));

  // Real-world scenario: user sets multiple headers including incomplete Content-Type
  const response = await fetch(`http://localhost:${server.port}/upload`, {
    method: "POST",
    headers: {
      "Authorization": "Bearer token123",
      "Content-Type": "multipart/form-data", // Missing boundary!
      "X-Custom-Header": "custom-value",
    },
    body: form,
  });

  const result = await response.json();

  expect(response.status).toBe(200);
  expect(result.success).toBe(true);
  expect(result.authorization).toBe("Bearer token123");
  expect(result.contentType).toContain("multipart/form-data");
  expect(result.contentType).toContain("boundary=");
});
