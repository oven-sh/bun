import { expect, test } from "bun:test";

// Regression test for https://github.com/oven-sh/bun/issues/26959
// Content-Disposition header injection via unsanitized filename
test("Content-Disposition filename sanitizes CRLF characters", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      const file = new File(["hello"], "evil.bin\r\nX-Injected: true", {
        type: "application/octet-stream",
      });
      return new Response(file);
    },
  });

  const resp = await fetch(`http://localhost:${server.port}/`);
  expect(resp.headers.get("X-Injected")).toBeNull();

  const disposition = resp.headers.get("content-disposition");
  expect(disposition).toBe('filename="evil.binX-Injected: true"');
  expect(await resp.text()).toBe("hello");
});

test("Content-Disposition filename sanitizes double quotes", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      const file = new File(["hello"], 'file"name.bin', {
        type: "application/octet-stream",
      });
      return new Response(file);
    },
  });

  const resp = await fetch(`http://localhost:${server.port}/`);

  const disposition = resp.headers.get("content-disposition");
  expect(disposition).toBe('filename="filename.bin"');
  expect(await resp.text()).toBe("hello");
});

test("Content-Disposition filename sanitizes backslashes", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      const file = new File(["hello"], "file\\name.bin", {
        type: "application/octet-stream",
      });
      return new Response(file);
    },
  });

  const resp = await fetch(`http://localhost:${server.port}/`);

  const disposition = resp.headers.get("content-disposition");
  expect(disposition).toBe('filename="filename.bin"');
  expect(await resp.text()).toBe("hello");
});

test("Content-Disposition with clean filename is unchanged", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      const file = new File(["hello"], "normal-file.bin", {
        type: "application/octet-stream",
      });
      return new Response(file);
    },
  });

  const resp = await fetch(`http://localhost:${server.port}/`);

  const disposition = resp.headers.get("content-disposition");
  expect(disposition).toBe('filename="normal-file.bin"');
  expect(await resp.text()).toBe("hello");
});
