import { describe, expect, it } from "bun:test";

describe("FormData multipart encoding hardening", () => {
  describe("name and filename percent-encoding per WHATWG spec", () => {
    it("should percent-encode double quotes in filename", async () => {
      const fd = new FormData();
      fd.append("file", new Blob(["hello"]), 'my"file.txt');

      const response = new Response(fd);
      const body = await response.text();

      // The double quote must be percent-encoded as %22
      expect(body).toContain('filename="my%22file.txt"');
      // Must NOT contain an unescaped quote that breaks out of the filename field
      expect(body).not.toContain('filename="my"file.txt"');
    });

    it("should percent-encode CR and LF in filename", async () => {
      const fd = new FormData();
      fd.append("file", new Blob(["hello"]), "file\r\nname.txt");

      const response = new Response(fd);
      const body = await response.text();

      // CR and LF must be percent-encoded
      expect(body).toContain('filename="file%0D%0Aname.txt"');
    });

    it("should percent-encode LF alone in filename", async () => {
      const fd = new FormData();
      fd.append("file", new Blob(["hello"]), "file\nname.txt");

      const response = new Response(fd);
      const body = await response.text();

      expect(body).toContain('filename="file%0Aname.txt"');
    });

    it("should percent-encode CR alone in filename", async () => {
      const fd = new FormData();
      fd.append("file", new Blob(["hello"]), "file\rname.txt");

      const response = new Response(fd);
      const body = await response.text();

      expect(body).toContain('filename="file%0Dname.txt"');
    });

    it("should percent-encode double quotes in name", async () => {
      const fd = new FormData();
      fd.append('na"me', "value");

      const response = new Response(fd);
      const body = await response.text();

      expect(body).toContain('name="na%22me"');
    });

    it("should percent-encode CR and LF in name", async () => {
      const fd = new FormData();
      fd.append("na\r\nme", "value");

      const response = new Response(fd);
      const body = await response.text();

      expect(body).toContain('name="na%0D%0Ame"');
    });

    it("should percent-encode multiple special chars in filename", async () => {
      const fd = new FormData();
      fd.append("file", new Blob(["content"]), 'a"b\rc\nd');

      const response = new Response(fd);
      const body = await response.text();

      expect(body).toContain('filename="a%22b%0Dc%0Ad"');
    });

    it("should not alter names/filenames without special characters", async () => {
      const fd = new FormData();
      fd.append("file", new Blob(["content"]), "normal-file.txt");

      const response = new Response(fd);
      const body = await response.text();

      expect(body).toContain('filename="normal-file.txt"');
      expect(body).toContain('name="file"');
    });

    it("should handle filename that is only special characters", async () => {
      const fd = new FormData();
      fd.append("file", new Blob(["x"]), '"\r\n');

      const response = new Response(fd);
      const body = await response.text();

      expect(body).toContain('filename="%22%0D%0A"');
    });

    it("should properly encode name for file entries too", async () => {
      const fd = new FormData();
      fd.append('up"load', new Blob(["data"]), "file.bin");

      const response = new Response(fd);
      const body = await response.text();

      expect(body).toContain('name="up%22load"');
      expect(body).toContain('filename="file.bin"');
    });
  });

  describe("content-type sanitization", () => {
    it("should strip CR/LF from blob content-type in multipart output", async () => {
      const blob = new Blob(["data"], { type: "text/evil\r\nx-injected: true" });
      const fd = new FormData();
      fd.append("file", blob, "test.txt");

      const response = new Response(fd);
      const body = await response.text();

      // CR/LF should be stripped from the content-type value
      const match = body.match(/Content-Type: ([^\r\n]*)/);
      expect(match).not.toBeNull();
      const ctValue = match![1];
      expect(ctValue).not.toContain("\r");
      expect(ctValue).not.toContain("\n");
      expect(ctValue).toBe("text/evilx-injected: true");
    });

    it("should fallback to application/octet-stream when content-type is all CR/LF", async () => {
      const blob = new Blob(["data"], { type: "\r\n" });
      const fd = new FormData();
      fd.append("file", blob, "test.bin");

      const response = new Response(fd);
      const body = await response.text();

      // All-CR/LF content-type should fallback to application/octet-stream
      const match = body.match(/Content-Type: ([^\r\n]*)/);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("application/octet-stream");
    });

    it("should not contain bare CR or LF in content-type header line", async () => {
      // Use a content-type with embedded CR/LF to exercise sanitization
      const fd = new FormData();
      fd.append("file", new Blob(["data"], { type: "text/plain\r\nX-Bad: header" }), "test.bin");

      const response = new Response(fd);
      const body = await response.text();

      // Extract the Content-Type value using regex against the raw body
      const match = body.match(/Content-Type: ([^\r\n]*)/);
      expect(match).not.toBeNull();
      const ctValue = match![1];
      expect(ctValue).not.toContain("\r");
      expect(ctValue).not.toContain("\n");
    });
  });

  describe("roundtrip with special characters", () => {
    it("should roundtrip FormData with quotes in filename", async () => {
      const fd = new FormData();
      const content = "file content here";
      fd.append("upload", new Blob([content]), 'my"file.txt');

      // Serialize to multipart
      const response = new Response(fd);
      const contentType = response.headers.get("Content-Type")!;

      // Parse back
      const parsed = await new Response(await response.blob(), {
        headers: { "Content-Type": contentType },
      }).formData();

      // Verify the file content survived
      const file = parsed.get("upload") as File;
      expect(file).toBeInstanceOf(File);
      expect(await file.text()).toBe(content);
    });

    it("should roundtrip FormData with CRLF in name", async () => {
      const fd = new FormData();
      fd.append("field\r\nname", "value123");

      const response = new Response(fd);
      const contentType = response.headers.get("Content-Type")!;

      const parsed = await new Response(await response.blob(), {
        headers: { "Content-Type": contentType },
      }).formData();

      // The value should be retrievable (name may be decoded differently
      // depending on parser, but the structure should not be corrupted)
      const entries = Array.from(parsed.entries());
      expect(entries.length).toBe(1);
      expect(entries[0][1]).toBe("value123");
    });

    it("should not allow filename to inject additional form fields", async () => {
      // This is the key test: a crafted filename should not be able to
      // inject extra multipart fields into the serialized body.
      const fd = new FormData();
      const maliciousFilename =
        'safe.png"\r\nContent-Type: text/html\r\n\r\n<script>alert(1)</script>\r\n--boundary\r\nContent-Disposition: form-data; name="injected"\r\n\r\nevil';
      fd.append("file", new Blob(["real content"]), maliciousFilename);

      const response = new Response(fd);
      const contentType = response.headers.get("Content-Type")!;
      const body = await response.text();

      // The double quotes and CRLF in the filename must be percent-encoded
      // so they can't break out of the Content-Disposition header value.
      // Verify no raw CRLF appears between the filename quotes.
      const filenameMatch = body.match(/filename="([^"]*)"/);
      expect(filenameMatch).not.toBeNull();
      const filenameValue = filenameMatch![1];
      // The encoded filename must not contain raw CR or LF
      expect(filenameValue).not.toContain("\r");
      expect(filenameValue).not.toContain("\n");
      // The quote in the original filename must be percent-encoded
      expect(filenameValue).toContain("%22");
      // CR and LF must be percent-encoded
      expect(filenameValue).toContain("%0D");
      expect(filenameValue).toContain("%0A");

      // The multipart body should have exactly one boundary-delimited part
      // (the crafted filename must not create additional parts)
      const boundary = contentType.split("boundary=")[1];
      const parts = body.split("--" + boundary).filter((p: string) => p !== "" && p !== "--\r\n");
      expect(parts.length).toBe(1);
    });

    it("should not allow name to inject additional headers", async () => {
      const fd = new FormData();
      fd.append('field"\r\nEvil-Header: injected\r\n\r\nbadcontent', "legitimate value");

      const response = new Response(fd);
      const body = await response.text();

      // The CRLF in the name should be percent-encoded, preventing it
      // from being parsed as a separate header line.
      // Split body into actual lines and check no line starts with "Evil-Header:"
      const lines = body.split("\r\n");
      const hasInjectedHeader = lines.some((line: string) => line.startsWith("Evil-Header:"));
      expect(hasInjectedHeader).toBe(false);

      // The value should still be present
      expect(body).toContain("legitimate value");
    });
  });
});
