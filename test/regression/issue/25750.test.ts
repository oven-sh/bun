import { S3Client } from "bun";
import { describe, expect, it } from "bun:test";

// Test for GitHub issue #25750: S3 File.presign() ignores contentDisposition and type options
describe("issue #25750 - S3 presign contentDisposition and type", () => {
  const s3Client = new S3Client({
    region: "us-east-1",
    endpoint: "https://s3.us-east-1.amazonaws.com",
    accessKeyId: "test-key",
    secretAccessKey: "test-secret",
    bucket: "test-bucket",
  });

  it("should include response-content-disposition in presigned URL", () => {
    const file = s3Client.file("example.txt");

    const url = file.presign({
      method: "GET",
      expiresIn: 900,
      contentDisposition: 'attachment; filename="quarterly-report.txt"',
    });

    expect(url).toContain("response-content-disposition=");
    expect(url).toContain("attachment");
    expect(url).toContain("quarterly-report.txt");
  });

  it("should include response-content-type in presigned URL", () => {
    const file = s3Client.file("example.txt");

    const url = file.presign({
      method: "GET",
      expiresIn: 900,
      type: "application/octet-stream",
    });

    expect(url).toContain("response-content-type=");
    expect(url).toContain("application%2Foctet-stream");
  });

  it("should include both response-content-disposition and response-content-type in presigned URL", () => {
    const file = s3Client.file("example.txt");

    const url = file.presign({
      method: "GET",
      expiresIn: 900,
      contentDisposition: 'attachment; filename="quarterly-report.txt"',
      type: "application/octet-stream",
    });

    expect(url).toContain("response-content-disposition=");
    expect(url).toContain("response-content-type=");
    expect(url).toContain("attachment");
    expect(url).toContain("application%2Foctet-stream");
  });

  it("should work with S3Client.presign static method", () => {
    const url = S3Client.presign("example.txt", {
      region: "us-east-1",
      endpoint: "https://s3.us-east-1.amazonaws.com",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      bucket: "test-bucket",
      contentDisposition: 'attachment; filename="report.pdf"',
      type: "application/pdf",
      expiresIn: 3600,
    });

    expect(url).toContain("response-content-disposition=");
    expect(url).toContain("response-content-type=");
    expect(url).toContain("report.pdf");
    expect(url).toContain("application%2Fpdf");
  });

  it("should properly URL-encode special characters in contentDisposition", () => {
    const file = s3Client.file("test.txt");

    const url = file.presign({
      method: "GET",
      contentDisposition: 'attachment; filename="file with spaces & symbols.txt"',
    });

    expect(url).toContain("response-content-disposition=");
    // Special characters should be URL encoded
    expect(url).toContain("%20"); // space
    expect(url).toContain("%26"); // &
  });

  it("should not include response-content-disposition when empty string is provided", () => {
    const file = s3Client.file("test.txt");

    const url = file.presign({
      method: "GET",
      contentDisposition: "",
    });

    expect(url).not.toContain("response-content-disposition=");
  });

  it("should not include response-content-type when empty string is provided", () => {
    const file = s3Client.file("test.txt");

    const url = file.presign({
      method: "GET",
      type: "",
    });

    expect(url).not.toContain("response-content-type=");
  });

  it("query parameters should be in correct alphabetical order", () => {
    const file = s3Client.file("test.txt");

    const url = file.presign({
      method: "GET",
      contentDisposition: "inline",
      type: "text/plain",
    });

    // Check that response-content-disposition comes before response-content-type
    // and both come after X-Amz-SignedHeaders and before any x-amz-* lowercase params
    const dispositionIndex = url.indexOf("response-content-disposition=");
    const typeIndex = url.indexOf("response-content-type=");
    const signedHeadersIndex = url.indexOf("X-Amz-SignedHeaders=");

    expect(dispositionIndex).toBeGreaterThan(signedHeadersIndex);
    expect(typeIndex).toBeGreaterThan(dispositionIndex);
  });
});
