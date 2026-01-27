import { S3Client } from "bun";
import { describe, expect, test } from "bun:test";

describe("S3 presign response override options (#18016)", () => {
  const s3 = new S3Client({
    accessKeyId: "test-key",
    secretAccessKey: "test-secret",
    endpoint: "https://s3.example.com",
    bucket: "test-bucket",
  });

  test("presign should support responseCacheControl option", () => {
    const url = s3.presign("test-file.txt", {
      expiresIn: 300,
      responseCacheControl: "max-age=3600, public",
    });

    const urlObj = new URL(url);

    // Verify response-cache-control parameter is present
    expect(urlObj.searchParams.get("response-cache-control")).toBe("max-age=3600, public");
  });

  test("presign should support responseContentDisposition option", () => {
    const url = s3.presign("test-file.txt", {
      expiresIn: 300,
      responseContentDisposition: 'attachment; filename="report.pdf"',
    });

    const urlObj = new URL(url);

    // Verify response-content-disposition parameter is present
    expect(urlObj.searchParams.get("response-content-disposition")).toBe('attachment; filename="report.pdf"');
  });

  test("presign should support responseContentEncoding option", () => {
    const url = s3.presign("test-file.txt", {
      expiresIn: 300,
      responseContentEncoding: "gzip",
    });

    const urlObj = new URL(url);

    // Verify response-content-encoding parameter is present
    expect(urlObj.searchParams.get("response-content-encoding")).toBe("gzip");
  });

  test("presign should support responseContentLanguage option", () => {
    const url = s3.presign("test-file.txt", {
      expiresIn: 300,
      responseContentLanguage: "en-US",
    });

    const urlObj = new URL(url);

    // Verify response-content-language parameter is present
    expect(urlObj.searchParams.get("response-content-language")).toBe("en-US");
  });

  test("presign should support responseContentType option", () => {
    const url = s3.presign("test-file.txt", {
      expiresIn: 300,
      responseContentType: "application/pdf",
    });

    const urlObj = new URL(url);

    // Verify response-content-type parameter is present
    expect(urlObj.searchParams.get("response-content-type")).toBe("application/pdf");
  });

  test("presign should support responseExpires option", () => {
    const url = s3.presign("test-file.txt", {
      expiresIn: 300,
      responseExpires: "Wed, 21 Oct 2025 07:28:00 GMT",
    });

    const urlObj = new URL(url);

    // Verify response-expires parameter is present
    expect(urlObj.searchParams.get("response-expires")).toBe("Wed, 21 Oct 2025 07:28:00 GMT");
  });

  test("presign should support multiple response override options", () => {
    const url = s3.presign("test-file.txt", {
      expiresIn: 300,
      responseCacheControl: "max-age=3600",
      responseContentDisposition: 'inline; filename="doc.pdf"',
      responseContentType: "application/pdf",
    });

    const urlObj = new URL(url);
    const params = Array.from(urlObj.searchParams.keys());

    // Verify all parameters are present and in alphabetical order
    expect(params).toContain("response-cache-control");
    expect(params).toContain("response-content-disposition");
    expect(params).toContain("response-content-type");

    // Verify values
    expect(urlObj.searchParams.get("response-cache-control")).toBe("max-age=3600");
    expect(urlObj.searchParams.get("response-content-disposition")).toBe('inline; filename="doc.pdf"');
    expect(urlObj.searchParams.get("response-content-type")).toBe("application/pdf");

    // Verify alphabetical order
    const expected = params.slice().sort();
    expect(params).toEqual(expected);
  });

  test("presign should prefer responseContentType over type for response override", () => {
    const url = s3.presign("test-file.txt", {
      expiresIn: 300,
      type: "text/plain",
      responseContentType: "application/json",
    });

    const urlObj = new URL(url);

    // responseContentType should take precedence
    expect(urlObj.searchParams.get("response-content-type")).toBe("application/json");
  });

  test("presign should prefer responseContentDisposition over contentDisposition for response override", () => {
    const url = s3.presign("test-file.txt", {
      expiresIn: 300,
      contentDisposition: "inline",
      responseContentDisposition: "attachment",
    });

    const urlObj = new URL(url);

    // responseContentDisposition should take precedence
    expect(urlObj.searchParams.get("response-content-disposition")).toBe("attachment");
  });

  test("S3File presign method should support response override options", () => {
    const file = s3.file("test-file.txt");
    const url = file.presign({
      expiresIn: 300,
      responseCacheControl: "no-cache",
      responseContentType: "image/png",
    });

    const urlObj = new URL(url);

    expect(urlObj.searchParams.get("response-cache-control")).toBe("no-cache");
    expect(urlObj.searchParams.get("response-content-type")).toBe("image/png");
  });
});
