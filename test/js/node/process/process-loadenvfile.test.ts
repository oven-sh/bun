import { describe, expect, it } from "bun:test";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("process.loadEnvFile", () => {
  it("should load environment variables from a .env file", () => {
    const tempDir = tmpdir();
    const envFile = join(tempDir, "test.env");

    // Create a test .env file
    const envContent = `
FOO=bar
BAZ=qux
MULTILINE="line1
line2"
QUOTED='single quoted'
EMPTY=
`;

    writeFileSync(envFile, envContent);

    try {
      const result = process.loadEnvFile(envFile);

      expect(result).toEqual({
        FOO: "bar",
        BAZ: "qux",
        MULTILINE: "line1\nline2",
        QUOTED: "single quoted",
        EMPTY: "",
      });
    } finally {
      unlinkSync(envFile);
    }
  });

  it("should handle variable expansion", () => {
    const tempDir = tmpdir();
    const envFile = join(tempDir, "test-expand.env");

    // Create a test .env file with variable expansion
    const envContent = `
BASE_URL=https://example.com
API_URL=$BASE_URL/api
FULL_URL=\${API_URL}/v1
`;

    writeFileSync(envFile, envContent);

    try {
      const result = process.loadEnvFile(envFile);

      expect(result).toEqual({
        BASE_URL: "https://example.com",
        API_URL: "https://example.com/api", 
        FULL_URL: "https://example.com/api/v1",
      });
    } finally {
      unlinkSync(envFile);
    }
  });

  it("should handle export statements", () => {
    const tempDir = tmpdir();
    const envFile = join(tempDir, "test-export.env");

    const envContent = `
export NODE_ENV=development
export PORT=3000
DEBUG=1
`;

    writeFileSync(envFile, envContent);

    try {
      const result = process.loadEnvFile(envFile);

      expect(result).toEqual({
        NODE_ENV: "development",
        PORT: "3000",
        DEBUG: "1",
      });
    } finally {
      unlinkSync(envFile);
    }
  });

  it("should handle comments and empty lines", () => {
    const tempDir = tmpdir();
    const envFile = join(tempDir, "test-comments.env");

    const envContent = `
# This is a comment
FOO=bar

# Another comment
BAZ=qux
`;

    writeFileSync(envFile, envContent);

    try {
      const result = process.loadEnvFile(envFile);

      expect(result).toEqual({
        FOO: "bar",
        BAZ: "qux",
      });
    } finally {
      unlinkSync(envFile);
    }
  });

  it("should throw an error for non-existent files", () => {
    expect(() => {
      process.loadEnvFile("/non/existent/file.env");
    }).toThrow();
  });

  it("should throw an error when no path is provided", () => {
    expect(() => {
      // @ts-ignore
      process.loadEnvFile();
    }).toThrow();
  });

  it("should throw an error when path is not a string", () => {
    expect(() => {
      // @ts-ignore
      process.loadEnvFile(123);
    }).toThrow();
  });
});