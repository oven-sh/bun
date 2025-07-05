import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe("bytes loader", () => {
  test("imports binary data as Uint8Array", async () => {
    const dir = tempDirWithFiles("bytes-loader", {
      "index.ts": `
        import data from './binary.dat' with { type: "bytes" };
        console.log(data);
        console.log(data.constructor.name);
        console.log(data.length);
        console.log(Array.from(data));
      `,
      "binary.dat": Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff]),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: dir,
    });

    const stdout = await new Response(proc.stdout).text();
    expect(stdout).toContain("Uint8Array");
    expect(stdout).toContain("5");
    expect(stdout).toContain("[ 0, 1, 2, 3, 255 ]");
    expect(await proc.exited).toBe(0);
  });

  test("handles empty files", async () => {
    const dir = tempDirWithFiles("bytes-loader-empty", {
      "index.ts": `
        import data from './empty.bin' with { type: "bytes" };
        console.log(JSON.stringify({
          type: data.constructor.name,
          length: data.length,
          data: Array.from(data)
        }));
      `,
      "empty.bin": Buffer.from([]),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: dir,
    });

    const stdout = await new Response(proc.stdout).text();
    expect(stdout.trim()).toBe('{"type":"Uint8Array","length":0,"data":[]}');
    expect(await proc.exited).toBe(0);
  });

  test("preserves binary data integrity", async () => {
    const testData = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) {
      testData[i] = i;
    }

    const dir = tempDirWithFiles("bytes-loader-integrity", {
      "index.ts": `
        import data from './data.bin' with { type: "bytes" };
        const expected = new Uint8Array(256);
        for (let i = 0; i < 256; i++) expected[i] = i;
        
        console.log(data.length === expected.length);
        console.log(data.every((byte, i) => byte === expected[i]));
      `,
      "data.bin": testData,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: dir,
    });

    const stdout = await new Response(proc.stdout).text();
    expect(stdout.trim()).toBe("true\ntrue");
    expect(await proc.exited).toBe(0);
  });

  test("only allows default import", async () => {
    const dir = tempDirWithFiles("bytes-loader-named", {
      "index.ts": `
        import { something } from './data.bin' with { type: "bytes" };
      `,
      "data.bin": Buffer.from([1, 2, 3]),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const output = stdout + stderr;
    expect(output).toContain('This loader type only supports the "default" import');
    expect(exitCode).not.toBe(0);
  });

  test("works with unicode text files", async () => {
    const dir = tempDirWithFiles("bytes-loader-unicode", {
      "index.ts": `
        import data from './text.txt' with { type: "bytes" };
        const decoder = new TextDecoder();
        console.log(decoder.decode(data));
      `,
      "text.txt": "Hello, 世界! 🌍 émojis ñ",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: dir,
    });

    const stdout = await new Response(proc.stdout).text();
    expect(stdout.trim()).toBe("Hello, 世界! 🌍 émojis ñ");
    expect(await proc.exited).toBe(0);
  });
});
