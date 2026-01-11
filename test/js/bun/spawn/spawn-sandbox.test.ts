import { describe, expect, test } from "bun:test";

// BPF instruction that returns SECCOMP_RET_ALLOW (0x7fff0000)
// struct sock_filter { __u16 code; __u8 jt; __u8 jf; __u32 k; }
// BPF_RET | BPF_K = 0x0006, jt=0, jf=0, k=0x7fff0000
// Little-endian bytes: [0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x7f]
const ALLOW_ALL_FILTER = new Uint8Array([0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x7f]);

// BPF instruction that returns SECCOMP_RET_KILL_PROCESS (0x80000000)
// This will kill the process on any syscall
const KILL_ALL_FILTER = new Uint8Array([0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80]);

// BPF filter that blocks write() syscall on x86_64 with EPERM
// This allows the process to continue but write() calls will fail with "Operation not permitted"
//
// BPF program logic:
//   0: Load arch from seccomp_data (offset 4)
//   1: If arch == AUDIT_ARCH_X86_64 (0xc000003e), continue; else jump to kill
//   2: Load syscall number (offset 0)
//   3: If syscall == write (1), jump to block with EPERM
//   4: Allow all other syscalls
//   5: Return ERRNO | EPERM (0x00050001)
//   6: Kill process (for wrong architecture)
//
// prettier-ignore
const BLOCK_WRITE_FILTER_X86_64 = new Uint8Array([
  // struct sock_filter { __u16 code; __u8 jt; __u8 jf; __u32 k; }
  // Byte order: [code_lo, code_hi, jt, jf, k_0, k_1, k_2, k_3]
  //
  // Instruction 0: Load architecture (BPF_LD | BPF_W | BPF_ABS, offset=4)
  0x20, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00,
  // Instruction 1: If arch == x86_64, continue (jt=0); else jump to instruction 6 (jf=4)
  0x15, 0x00, 0x00, 0x04, 0x3e, 0x00, 0x00, 0xc0,
  // Instruction 2: Load syscall number (offset=0)
  0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  // Instruction 3: If syscall == 1 (write), jump to instruction 5 (jt=1); else continue (jf=0)
  0x15, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00,
  // Instruction 4: Allow (SECCOMP_RET_ALLOW = 0x7fff0000)
  0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x7f,
  // Instruction 5: Block with EPERM (SECCOMP_RET_ERRNO | 1 = 0x00050001)
  0x06, 0x00, 0x00, 0x00, 0x01, 0x00, 0x05, 0x00,
  // Instruction 6: Kill (SECCOMP_RET_KILL_PROCESS = 0x80000000) for wrong arch
  0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80,
]);

describe("spawn sandbox", () => {
  const isLinux = process.platform === "linux";

  test("sandbox.linux is silently ignored on non-Linux", async () => {
    if (isLinux) {
      return; // Skip on Linux
    }

    // On non-Linux, sandbox.linux should be silently ignored
    // This allows users to specify all platform options at once
    await using proc = Bun.spawn({
      cmd: ["echo", "test"],
      sandbox: { linux: ALLOW_ALL_FILTER },
    });

    const stdout = await proc.stdout.text();
    expect(stdout).toBe("test\n");
    expect(await proc.exited).toBe(0);
  });

  test("rejects filter with invalid length (not multiple of 8)", () => {
    if (!isLinux) {
      return; // Skip on non-Linux
    }

    expect(() => {
      Bun.spawn({
        cmd: ["echo", "test"],
        sandbox: { linux: new Uint8Array([0x06, 0x00, 0x00]) }, // 3 bytes, not multiple of 8
      });
    }).toThrow("multiple of 8 bytes");
  });

  test("rejects non-ArrayBuffer sandbox.linux value", () => {
    if (!isLinux) {
      return; // Skip on non-Linux
    }

    expect(() => {
      Bun.spawn({
        cmd: ["echo", "test"],
        sandbox: { linux: "not a buffer" as unknown as Uint8Array },
      });
    }).toThrow("ArrayBuffer or TypedArray");
  });

  test("accepts empty filter (no-op)", async () => {
    if (!isLinux) {
      return; // Skip on non-Linux
    }

    // Empty filter should be treated as no filter
    await using proc = Bun.spawn({
      cmd: ["echo", "hello"],
      sandbox: { linux: new Uint8Array(0) },
    });

    const stdout = await proc.stdout.text();
    expect(stdout).toBe("hello\n");
    expect(await proc.exited).toBe(0);
  });

  test("spawn with allow-all filter works with echo", async () => {
    if (!isLinux) {
      return; // Skip on non-Linux
    }

    await using proc = Bun.spawn({
      cmd: ["echo", "sandboxed"],
      sandbox: { linux: ALLOW_ALL_FILTER },
    });

    const stdout = await proc.stdout.text();
    expect(stdout).toBe("sandboxed\n");
    expect(await proc.exited).toBe(0);
  });

  test("spawnSync with allow-all filter works with echo", () => {
    if (!isLinux) {
      return; // Skip on non-Linux
    }

    const result = Bun.spawnSync({
      cmd: ["echo", "sync-sandboxed"],
      sandbox: { linux: ALLOW_ALL_FILTER },
    });

    expect(result.stdout.toString()).toBe("sync-sandboxed\n");
    expect(result.exitCode).toBe(0);
  });

  test("spawnSync with kill-all filter terminates process with SIGSYS", () => {
    if (!isLinux) {
      return; // Skip on non-Linux
    }

    const result = Bun.spawnSync({
      cmd: ["/bin/true"],
      sandbox: { linux: KILL_ALL_FILTER },
    });

    // Process is killed before it can do anything
    expect(result.stdout.toString()).toBe("");

    // When killed by signal, exitCode is null and signalCode contains the signal name
    expect(result.exitCode).toBeNull();
    expect(result.signalCode).toBe("SIGSYS");
    expect(result.success).toBe(false);
  });

  test("spawn with kill-all filter terminates process with SIGSYS", async () => {
    if (!isLinux) {
      return; // Skip on non-Linux
    }

    // The process should be killed immediately when it tries to make any syscall.
    // seccomp sends SIGSYS (signal 31) to terminate the process.
    await using proc = Bun.spawn({
      cmd: ["/bin/true"],
      sandbox: { linux: KILL_ALL_FILTER },
      stderr: "pipe",
    });

    await proc.exited;
    const stdout = await proc.stdout.text();
    const stderr = await proc.stderr.text();

    // Process is killed before it can output anything
    expect(stdout).toBe("");
    expect(stderr).toBe("");

    // When killed by signal, exitCode is null and signalCode contains the signal name.
    // SIGSYS indicates seccomp blocked a syscall.
    expect(proc.exitCode).toBeNull();
    expect(proc.signalCode).toBe("SIGSYS");
  });

  test("accepts ArrayBuffer", async () => {
    if (!isLinux) {
      return; // Skip on non-Linux
    }

    const buffer = ALLOW_ALL_FILTER.buffer.slice(
      ALLOW_ALL_FILTER.byteOffset,
      ALLOW_ALL_FILTER.byteOffset + ALLOW_ALL_FILTER.byteLength,
    );

    await using proc = Bun.spawn({
      cmd: ["echo", "arraybuffer"],
      sandbox: { linux: buffer },
    });

    const stdout = await proc.stdout.text();
    expect(stdout).toBe("arraybuffer\n");
    expect(await proc.exited).toBe(0);
  });

  test("accepts different TypedArray types", async () => {
    if (!isLinux) {
      return; // Skip on non-Linux
    }

    // Test with Uint16Array (same bytes, different view)
    const uint16View = new Uint16Array(ALLOW_ALL_FILTER.buffer);

    await using proc = Bun.spawn({
      cmd: ["echo", "uint16"],
      sandbox: { linux: uint16View },
    });

    const stdout = await proc.stdout.text();
    expect(stdout).toBe("uint16\n");
    expect(await proc.exited).toBe(0);
  });

  test("filter that blocks write() causes echo to fail", async () => {
    if (!isLinux) {
      return; // Skip on non-Linux
    }

    // echo uses write() to output to stdout
    // With write() blocked, echo should fail
    await using proc = Bun.spawn({
      cmd: ["echo", "this should not appear"],
      sandbox: { linux: BLOCK_WRITE_FILTER_X86_64 },
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    const stdout = await proc.stdout.text();

    // echo should fail to write and exit with error, or produce no output
    // The exact behavior depends on how echo handles write() errors
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  });

  test("filter that blocks write() allows /bin/true to succeed", async () => {
    if (!isLinux) {
      return; // Skip on non-Linux
    }

    // /bin/true doesn't write anything, it just exits with 0
    // So blocking write() shouldn't affect it
    await using proc = Bun.spawn({
      cmd: ["/bin/true"],
      sandbox: { linux: BLOCK_WRITE_FILTER_X86_64 },
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });

  test("filter that blocks write() causes /bin/false to exit non-zero", async () => {
    if (!isLinux) {
      return; // Skip on non-Linux
    }

    // /bin/false doesn't write anything, it just exits with 1
    // So blocking write() shouldn't affect it - it should still exit 1
    await using proc = Bun.spawn({
      cmd: ["/bin/false"],
      sandbox: { linux: BLOCK_WRITE_FILTER_X86_64 },
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(1);
  });

  test("spawnSync filter that blocks write() causes echo to fail", () => {
    if (!isLinux) {
      return; // Skip on non-Linux
    }

    const result = Bun.spawnSync({
      cmd: ["echo", "this should not appear"],
      sandbox: { linux: BLOCK_WRITE_FILTER_X86_64 },
    });

    // echo should fail to write
    expect(result.stdout.toString()).toBe("");
    expect(result.exitCode).not.toBe(0);
  });
});
