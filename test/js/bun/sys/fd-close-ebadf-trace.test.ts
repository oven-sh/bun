// The debug-build EBADF warning printed by `Fd::close_allowing_standard_io`
// dumps a short (4-frame) stack trace anchored at the close() call site so fd
// use-after-free bugs are diagnosable. The Zig `FD.close()` threaded
// `@returnAddress()` through each close wrapper so the trace starts at the
// caller; the Rust port forwarded `None` and the anchor resolved inside
// `bun_core::dump_current_stack_trace` instead, so all 4 frames pointed at the
// dump/close plumbing and the actual caller never appeared.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isLinux } from "harness";

// Linux-only: relies on ELF `nm -S` emitting a size column with no extra
// Mach-O underscore prefix on symbol names.
test.skipIf(!isDebug || !isLinux)(
  "EBADF debug stack trace is anchored at the close() caller, not inside the dump helper",
  async () => {
    const exe = bunExe();

    // Locate the close/dump plumbing in the binary's static symbol table. The
    // Rust v0 mangling crate-hash varies between builds, so match on the stable
    // suffix. `__bun_crash_handler_dump_stack_trace` is #[no_mangle]. Filter in
    // the child (full `nm -S` output is >100 MB on an ASAN debug binary).
    await using nm = Bun.spawn({
      cmd: [
        "sh",
        "-c",
        `nm -S "$1" | grep -E ' (__bun_crash_handler_dump_stack_trace|_R[[:alnum:]_]*8bun_core6Global24dump_current_stack_trace|_R[[:alnum:]_]*7bun_sys[[:alnum:]_]*26close_allowing_standard_io|_R[[:alnum:]_]*7bun_sys[[:alnum:]_]*34close_allowing_bad_file_descriptor)$'`,
        "sh",
        exe,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [nmOut, nmErr, nmExit] = await Promise.all([nm.stdout.text(), nm.stderr.text(), nm.exited]);
    expect({ nmErr, nmExit }).toEqual({ nmErr: "", nmExit: 0 });

    type Range = { lo: bigint; hi: bigint; name: string };
    const ranges: Range[] = [];
    for (const line of nmOut.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length !== 4) continue;
      const lo = BigInt("0x" + parts[0]);
      const size = BigInt("0x" + parts[1]);
      ranges.push({ lo, hi: lo + size, name: parts[3] });
    }
    // Precondition: all four plumbing symbols must resolve, otherwise this
    // test cannot assert anything.
    expect(ranges.map(r => r.name).sort()).toHaveLength(4);

    // Trigger an EBADF close via fs.closeSync on an already-closed fd.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const fs=require("fs");const fd=fs.openSync("/dev/null","r");fs.closeSync(fd);try{fs.closeSync(fd)}catch(e){}`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain("EBADF. This is an indication of a file descriptor UAF");

    // Parse the dumped frame addresses: lines like
    //   "1   0xd3d3c80 ./build/debug/bun-debug() [0xd3d3c80]"
    const frames: bigint[] = [];
    for (const line of stderr.split("\n")) {
      const m = line.match(/^\s*\d+\s+0x([0-9a-fA-F]+)\s/);
      if (m) frames.push(BigInt("0x" + m[1]));
    }
    expect(frames.length).toBeGreaterThanOrEqual(1);

    // None of the dumped frames may lie inside the dump/close plumbing. With
    // the anchor threaded through correctly, frame 1 is the fs.closeSync
    // handler in node_fs.rs and deeper frames are its callers.
    const hits = frames
      .map((addr, i) => {
        const r = ranges.find(r => addr >= r.lo && addr < r.hi);
        return r ? `frame ${i + 1} @ 0x${addr.toString(16)} is inside ${r.name}` : null;
      })
      .filter(Boolean);
    expect(hits).toEqual([]);

    expect(exitCode).toBe(0);
  },
);
