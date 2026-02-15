import { expect, test } from "bun:test";
import { tempDir } from "harness";

test("Content-Disposition header injection via CRLF in File name", async () => {
  await using server = Bun.serve({
    port: 0,
    fetch() {
      // The File name contains a CRLF sequence that could inject a header.
      // Use application/octet-stream so autosetFilename() returns true.
      const maliciousName = "evil.bin\r\nX-Injected: true";
      const file = new File(["hello"], maliciousName, { type: "application/octet-stream" });
      return new Response(file);
    },
  });

  const response = await fetch(server.url);
  const body = await response.text();

  // The injected header must NOT appear
  expect(response.headers.get("X-Injected")).toBeNull();

  // The Content-Disposition header must not contain CRLF
  const contentDisposition = response.headers.get("content-disposition");
  if (contentDisposition) {
    expect(contentDisposition).not.toContain("\r");
    expect(contentDisposition).not.toContain("\n");
  }

  expect(body).toBe("hello");
});

test("Content-Disposition header injection via quotes in File name", async () => {
  await using server = Bun.serve({
    port: 0,
    fetch() {
      // The File name contains quotes that could break out of filename=""
      const maliciousName = 'evil.bin" ; malicious="true';
      const file = new File(["hello"], maliciousName, { type: "application/octet-stream" });
      return new Response(file);
    },
  });

  const response = await fetch(server.url);
  const body = await response.text();

  const contentDisposition = response.headers.get("content-disposition");
  if (contentDisposition) {
    expect(contentDisposition).not.toContain("\r");
    expect(contentDisposition).not.toContain("\n");
    // The filename parameter value should not contain unescaped double quotes
    const match = contentDisposition.match(/filename="([^"]*)"/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toContain('"');
  }

  expect(body).toBe("hello");
});

test("Content-Disposition header injection via Bun.file with crafted path", async () => {
  // Create a temp dir, then add a file with CRLF in its name (Linux allows this)
  using dir = tempDir("crlf-filename", {});
  const maliciousFilename = "evil.bin\r\nX-Injected: true";
  const filePath = `${dir}/${maliciousFilename}`;

  let fileCreated = false;
  try {
    await Bun.write(filePath, "hello from file");
    fileCreated = true;
  } catch {
    // Some filesystems may not support CRLF in filenames
    console.log("Skipping Bun.file test - filesystem does not support CRLF in filenames");
  }

  if (fileCreated) {
    await using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(Bun.file(filePath));
      },
    });

    const response = await fetch(server.url);
    const body = await response.text();

    // The injected header must NOT appear
    expect(response.headers.get("X-Injected")).toBeNull();

    const contentDisposition = response.headers.get("content-disposition");
    if (contentDisposition) {
      expect(contentDisposition).not.toContain("\r");
      expect(contentDisposition).not.toContain("\n");
    }

    expect(body).toBe("hello from file");
  }
});
