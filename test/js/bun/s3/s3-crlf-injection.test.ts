import { S3Client } from "bun";
import { describe, expect, it } from "bun:test";

// Test that S3 header values reject CRLF characters to prevent HTTP header injection.
// This validates the fix for header injection via contentDisposition, type, and contentEncoding.

describe("S3 - CRLF Header Injection Prevention", () => {
  const baseOptions = {
    accessKeyId: "FAKE_ACCESS_KEY",
    secretAccessKey: "FAKE_SECRET",
    endpoint: "http://127.0.0.1:1234",
    bucket: "test",
  };

  describe("contentDisposition", () => {
    it("should reject CRLF", () => {
      expect(() => {
        new S3Client({
          ...baseOptions,
          contentDisposition: "attachment\r\nX-Injected: true",
        });
      }).toThrow(/contentDisposition/);
    });

    it("should reject lone CR", () => {
      expect(() => {
        new S3Client({
          ...baseOptions,
          contentDisposition: "attachment\rX-Injected: true",
        });
      }).toThrow(/contentDisposition/);
    });

    it("should reject lone LF", () => {
      expect(() => {
        new S3Client({
          ...baseOptions,
          contentDisposition: "attachment\nX-Injected: true",
        });
      }).toThrow(/contentDisposition/);
    });

    it("should reject null bytes", () => {
      expect(() => {
        new S3Client({
          ...baseOptions,
          contentDisposition: "attachment\x00injected",
        });
      }).toThrow(/contentDisposition/);
    });

    it("should allow valid values", () => {
      expect(() => {
        new S3Client({
          ...baseOptions,
          contentDisposition: 'attachment; filename="report.pdf"',
        });
      }).not.toThrow();
    });
  });

  describe("type (content-type)", () => {
    it("should reject CRLF", () => {
      expect(() => {
        new S3Client({
          ...baseOptions,
          type: "text/plain\r\nX-Injected: true",
        });
      }).toThrow(/type/);
    });

    it("should reject lone LF", () => {
      expect(() => {
        new S3Client({
          ...baseOptions,
          type: "text/plain\nX-Injected: true",
        });
      }).toThrow(/type/);
    });

    it("should allow valid values", () => {
      expect(() => {
        new S3Client({
          ...baseOptions,
          type: "application/octet-stream",
        });
      }).not.toThrow();
    });
  });

  describe("contentEncoding", () => {
    it("should reject CRLF", () => {
      expect(() => {
        new S3Client({
          ...baseOptions,
          contentEncoding: "gzip\r\nX-Injected: true",
        });
      }).toThrow(/contentEncoding/);
    });

    it("should reject lone LF", () => {
      expect(() => {
        new S3Client({
          ...baseOptions,
          contentEncoding: "gzip\nX-Injected: true",
        });
      }).toThrow(/contentEncoding/);
    });

    it("should allow valid values", () => {
      expect(() => {
        new S3Client({
          ...baseOptions,
          contentEncoding: "gzip",
        });
      }).not.toThrow();
    });
  });

  describe("per-file options", () => {
    it("should reject CRLF in contentDisposition on file()", () => {
      const client = new S3Client(baseOptions);
      expect(() => {
        client.file("test-key", {
          contentDisposition: "attachment\r\nX-Injected: true",
        });
      }).toThrow(/contentDisposition/);
    });

    it("should reject CRLF in type on file()", () => {
      const client = new S3Client(baseOptions);
      expect(() => {
        client.file("test-key", {
          type: "text/plain\r\nX-Injected: true",
        });
      }).toThrow(/type/);
    });

    it("should reject CRLF in contentEncoding on file()", () => {
      const client = new S3Client(baseOptions);
      expect(() => {
        client.file("test-key", {
          contentEncoding: "gzip\r\nX-Injected: true",
        });
      }).toThrow(/contentEncoding/);
    });
  });

  describe("write() options path", () => {
    it("should reject CRLF in contentDisposition on write()", async () => {
      const client = new S3Client(baseOptions);
      const file = client.file("test-key");
      await expect(async () => {
        await file.write("data", { contentDisposition: "attachment\r\nX-Injected: true" });
      }).toThrow(/contentDisposition/);
    });

    it("should reject CRLF in contentEncoding on write()", async () => {
      const client = new S3Client(baseOptions);
      const file = client.file("test-key");
      await expect(async () => {
        await file.write("data", { contentEncoding: "gzip\r\nX-Injected: true" });
      }).toThrow(/contentEncoding/);
    });
  });

  it("CRLF in contentDisposition should not reach the wire", async () => {
    const requests: string[] = [];
    using server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket, data) {
          requests.push(data.toString());
          socket.write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
          socket.end();
        },
        open() {},
        close() {},
        error() {},
      },
    });

    const client = new S3Client({
      accessKeyId: "FAKE_ACCESS_KEY",
      secretAccessKey: "FAKE_SECRET",
      endpoint: `http://127.0.0.1:${server.port}`,
      bucket: "test",
    });

    const file = client.file("test-key");
    try {
      await file.write("test-data", {
        contentDisposition: "attachment; filename=report.pdf\r\nX-Injected: true",
      });
    } catch {
      // Expected to throw
    }

    // Verify no injected header made it to the wire
    for (const req of requests) {
      expect(req).not.toContain("X-Injected");
    }
  });
});
