import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { openSync, writeSync, closeSync } from "node:fs";
import { join } from "node:path";

// fetch(url, { body: formData }) where the FormData holds a Bun.file() entry
// used to read the whole file into memory while building the multipart body.
// The fix streams file-backed parts in fixed-size chunks, so peak RSS stays
// bounded regardless of file size.
test("fetch streams FormData with a Bun.file() part instead of buffering it", async () => {
  const MB = 1024 * 1024;
  const fileSizeMB = 48;
  const fileSize = fileSizeMB * MB;

  using dir = tempDir("formdata-file-stream", {});
  const filePath = join(String(dir), "big.bin");
  {
    const fd = openSync(filePath, "w");
    const chunk = Buffer.alloc(1024);
    for (let i = 0; i < 1024; i++) chunk[i] = i & 0xff;
    for (let i = 0; i < fileSize / 1024; i++) writeSync(fd, chunk);
    closeSync(fd);
  }

  // ASAN's free quarantine retains every freed stream chunk, so RSS growth
  // under ASAN tracks the quarantine rather than live allocations and masks
  // the buffered-vs-streamed difference. Disable it for the fixture process.
  const asanOpts = [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0"].filter(Boolean).join(":");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", join(import.meta.dir, "FormData-file-stream-fixture.ts")],
    env: { ...bunEnv, FILE_PATH: filePath, FILE_SIZE: String(fileSize), ASAN_OPTIONS: asanOpts },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) console.error(stderr);
  const result = JSON.parse(stdout.trim());

  console.log(
    `FormData Bun.file() upload: file=${fileSizeMB} MB, ` +
      `stream peak=${result.stream.peakDeltaMB} MB, form peak=${result.form.peakDeltaMB} MB`,
  );

  // Content-Type carries the boundary and the body is sent with an explicit
  // Content-Length, not chunked transfer-encoding.
  expect(result.form.ct).toMatch(/^multipart\/form-data; boundary=----WebKitFormBoundary[0-9a-f]{32}$/);
  expect(result.form.te).toBeUndefined();
  expect(result.form.n).toBe(Number(result.form.cl));
  expect(result.form.n).toBeGreaterThan(fileSize);

  // Wire bytes match an independently rebuilt multipart body.
  expect(result.form.hash).toBe(result.expectedHash);

  // Pre-fix, `from_dom_form_data` read the whole file and copied it into the
  // joiner (peak roughly 2x file size). The streamed path keeps the peak far
  // below one file's worth; it should be in the same ballpark as a bare
  // `Bun.file().stream()` body.
  expect(result.form.peakDeltaMB).toBeLessThan(fileSizeMB);
  expect(result.form.peakDeltaMB).toBeLessThan(result.stream.peakDeltaMB + fileSizeMB);

  expect(exitCode).toBe(0);
}, 60_000);
