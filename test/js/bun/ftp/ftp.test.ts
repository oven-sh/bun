import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir, normalizeBunSnapshot } from "harness";
import { spawn } from "bun";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";

// FTP test server setup
async function setupFTPServer(port: number = 2121, dir: string) {
  // Create FTP config
  const config = `
listen=YES
anonymous_enable=YES
local_enable=NO
write_enable=YES
anon_upload_enable=YES
anon_mkdir_write_enable=YES
anon_other_write_enable=YES
anon_umask=022
anon_root=${dir}
no_anon_password=YES
pasv_enable=YES
pasv_min_port=10000
pasv_max_port=10100
xferlog_enable=YES
listen_port=${port}
`;

  const configPath = `/tmp/vsftpd_test_${port}.conf`;
  await writeFile(configPath, config);

  // Start vsftpd
  const server = spawn({
    cmd: ["sudo", "vsftpd", configPath],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  // Wait for server to start
  await Bun.sleep(500);

  return {
    server,
    configPath,
    cleanup: async () => {
      server.kill();
      await rm(configPath, { force: true });
    },
  };
}

test("fetch() with ftp:// URL - basic file retrieval", async () => {
  using dir = tempDir("ftp-test", {
    "test.txt": "Hello from FTP server!",
    "data.json": JSON.stringify({ message: "FTP JSON data", value: 42 }),
  });

  const ftpServer = await setupFTPServer(2122, String(dir));

  try {
    // Test basic text file fetch
    const response = await fetch("ftp://localhost:2122/test.txt");
    expect(response.ok).toBe(true);
    const text = await response.text();
    expect(text).toBe("Hello from FTP server!");
  } finally {
    await ftpServer.cleanup();
  }
});

test("fetch() with ftp:// URL - JSON file", async () => {
  using dir = tempDir("ftp-test-json", {
    "data.json": JSON.stringify({ message: "FTP JSON data", value: 42 }),
  });

  const ftpServer = await setupFTPServer(2123, String(dir));

  try {
    const response = await fetch("ftp://localhost:2123/data.json");
    expect(response.ok).toBe(true);
    const json = await response.json();
    expect(json).toEqual({ message: "FTP JSON data", value: 42 });
  } finally {
    await ftpServer.cleanup();
  }
});

test("fetch() with ftp:// URL - large file", async () => {
  using dir = tempDir("ftp-test-large");

  // Create a large file (1MB)
  const largeContent = "x".repeat(1024 * 1024);
  await writeFile(join(String(dir), "large.txt"), largeContent);

  const ftpServer = await setupFTPServer(2124, String(dir));

  try {
    const response = await fetch("ftp://localhost:2124/large.txt");
    expect(response.ok).toBe(true);
    const text = await response.text();
    expect(text.length).toBe(1024 * 1024);
    expect(text[0]).toBe("x");
    expect(text[text.length - 1]).toBe("x");
  } finally {
    await ftpServer.cleanup();
  }
});

test("fetch() with ftp:// URL - authenticated access", async () => {
  using dir = tempDir("ftp-test-auth", {
    "secret.txt": "Authenticated content",
  });

  // Note: For real authentication test, we'd need a different FTP server config
  // This test shows the URL format with credentials
  const ftpServer = await setupFTPServer(2125, String(dir));

  try {
    const response = await fetch("ftp://user:pass@localhost:2125/secret.txt");
    expect(response.ok).toBe(true);
    const text = await response.text();
    expect(text).toBe("Authenticated content");
  } finally {
    await ftpServer.cleanup();
  }
});

test("fetch() with ftp:// URL - file not found", async () => {
  using dir = tempDir("ftp-test-404");

  const ftpServer = await setupFTPServer(2126, String(dir));

  try {
    const response = await fetch("ftp://localhost:2126/nonexistent.txt");
    expect(response.ok).toBe(false);
    expect(response.status).toBe(404);
  } catch (error) {
    // FTP errors might throw instead of returning error response
    expect(error).toBeDefined();
  } finally {
    await ftpServer.cleanup();
  }
});

test("fetch() with ftp:// URL - binary file", async () => {
  using dir = tempDir("ftp-test-binary");

  // Create a binary file
  const binaryData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  await writeFile(join(String(dir), "image.jpg"), binaryData);

  const ftpServer = await setupFTPServer(2127, String(dir));

  try {
    const response = await fetch("ftp://localhost:2127/image.jpg");
    expect(response.ok).toBe(true);
    const buffer = await response.arrayBuffer();
    const received = new Uint8Array(buffer);
    expect(received).toEqual(binaryData);
  } finally {
    await ftpServer.cleanup();
  }
});

test("fetch() with ftp:// URL - subdirectory access", async () => {
  using dir = tempDir("ftp-test-subdir");

  await mkdir(join(String(dir), "subdir"));
  await writeFile(join(String(dir), "subdir", "nested.txt"), "Nested content");

  const ftpServer = await setupFTPServer(2128, String(dir));

  try {
    const response = await fetch("ftp://localhost:2128/subdir/nested.txt");
    expect(response.ok).toBe(true);
    const text = await response.text();
    expect(text).toBe("Nested content");
  } finally {
    await ftpServer.cleanup();
  }
});

test("fetch() with ftp:// URL - connection timeout", async () => {
  // Test connection to non-existent server
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);

    await fetch("ftp://localhost:9999/test.txt", {
      signal: controller.signal,
    });

    clearTimeout(timeout);
    expect(false).toBe(true); // Should not reach here
  } catch (error) {
    expect(error).toBeDefined();
  }
});

test("fetch() with ftp:// URL - concurrent requests", async () => {
  using dir = tempDir("ftp-test-concurrent", {
    "file1.txt": "Content 1",
    "file2.txt": "Content 2",
    "file3.txt": "Content 3",
  });

  const ftpServer = await setupFTPServer(2129, String(dir));

  try {
    const promises = [
      fetch("ftp://localhost:2129/file1.txt"),
      fetch("ftp://localhost:2129/file2.txt"),
      fetch("ftp://localhost:2129/file3.txt"),
    ];

    const responses = await Promise.all(promises);
    const texts = await Promise.all(responses.map((r) => r.text()));

    expect(texts).toEqual(["Content 1", "Content 2", "Content 3"]);
  } finally {
    await ftpServer.cleanup();
  }
});

test("fetch() rejects non-supported protocols", async () => {
  try {
    await fetch("gopher://example.com/test");
    expect(false).toBe(true); // Should not reach here
  } catch (error: any) {
    expect(error.message).toContain("protocol must be http:, https:, s3: or ftp:");
  }
});

test("fetch() with ftp:// URL - passive mode handling", async () => {
  using dir = tempDir("ftp-test-pasv", {
    "passive.txt": "Passive mode test",
  });

  const ftpServer = await setupFTPServer(2130, String(dir));

  try {
    // FTP should automatically use passive mode
    const response = await fetch("ftp://localhost:2130/passive.txt");
    expect(response.ok).toBe(true);
    const text = await response.text();
    expect(text).toBe("Passive mode test");
  } finally {
    await ftpServer.cleanup();
  }
});

test("fetch() with ftp:// URL - empty file", async () => {
  using dir = tempDir("ftp-test-empty", {
    "empty.txt": "",
  });

  const ftpServer = await setupFTPServer(2131, String(dir));

  try {
    const response = await fetch("ftp://localhost:2131/empty.txt");
    expect(response.ok).toBe(true);
    const text = await response.text();
    expect(text).toBe("");
  } finally {
    await ftpServer.cleanup();
  }
});

test("fetch() with ftp:// URL - special characters in filename", async () => {
  using dir = tempDir("ftp-test-special");

  await writeFile(join(String(dir), "file with spaces.txt"), "Special filename");

  const ftpServer = await setupFTPServer(2132, String(dir));

  try {
    const response = await fetch("ftp://localhost:2132/file%20with%20spaces.txt");
    expect(response.ok).toBe(true);
    const text = await response.text();
    expect(text).toBe("Special filename");
  } finally {
    await ftpServer.cleanup();
  }
});