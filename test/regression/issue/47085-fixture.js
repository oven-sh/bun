// Installs a seccomp filter that returns EPERM for one syscall (argv[2]:
// "sendto" or "recvfrom"), then runs the scenario named by argv[3].
// prctl(PR_SET_SECCOMP) is per thread. Every read and write below runs on the
// main thread, so that is enough.
const { dlopen, FFIType, ptr } = require("bun:ffi");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const nr = { x64: { sendto: 44, recvfrom: 45 }, arm64: { sendto: 206, recvfrom: 207 } }[process.arch][process.argv[2]];
const mode = process.argv[3];

// struct sock_filter { u16 code; u8 jt; u8 jf; u32 k; }
const BPF_LD_W_ABS = 0x20;
const BPF_JMP_JEQ_K = 0x15;
const BPF_RET_K = 0x06;
const SECCOMP_RET_ERRNO = 0x00050000;
const SECCOMP_RET_ALLOW = 0x7fff0000;
const EPERM = 1;
const insns = [
  [BPF_LD_W_ABS, 0, 0, 0], // A = seccomp_data.nr
  [BPF_JMP_JEQ_K, 0, 1, nr], // A == nr ? next : skip one
  [BPF_RET_K, 0, 0, SECCOMP_RET_ERRNO | EPERM],
  [BPF_RET_K, 0, 0, SECCOMP_RET_ALLOW],
];
const filter = new Uint8Array(insns.length * 8);
const fv = new DataView(filter.buffer);
insns.forEach(([code, jt, jf, k], i) => {
  fv.setUint16(i * 8, code, true);
  fv.setUint8(i * 8 + 2, jt);
  fv.setUint8(i * 8 + 3, jf);
  fv.setUint32(i * 8 + 4, k, true);
});
// struct sock_fprog { u16 len; struct sock_filter* filter; }
const prog = new Uint8Array(16);
const pv = new DataView(prog.buffer);
pv.setUint16(0, insns.length, true);
pv.setBigUint64(8, BigInt(ptr(filter)), true);

const PR_SET_SECCOMP = 22;
const PR_SET_NO_NEW_PRIVS = 38;
const SECCOMP_MODE_FILTER = 2;
const libc = dlopen("libc.so.6", {
  prctl: { args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.i32 },
});
if (libc.symbols.prctl(PR_SET_NO_NEW_PRIVS, 1n, 0n, 0n, 0n) !== 0) process.exit(99);
if (libc.symbols.prctl(PR_SET_SECCOMP, BigInt(SECCOMP_MODE_FILTER), BigInt(ptr(prog)), 0n, 0n) !== 0) {
  process.exit(99);
}

switch (mode) {
  case "probe":
    break;
  case "stdout":
    fs.writeSync(1, "S");
    process.stdout.write("A", err => fs.writeSync(2, err ? "callback:" + err.code : "callback:ok"));
    break;
  case "stdin": {
    let got = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => (got += chunk));
    process.stdin.on("error", err => fs.writeSync(2, "error:" + err.code));
    process.stdin.on("end", () => fs.writeSync(1, "got:" + got));
    break;
  }
  case "bun-stdin":
    Bun.stdin.text().then(
      text => fs.writeSync(1, "got:" + text),
      err => fs.writeSync(2, "error:" + err.code),
    );
    break;
  case "spawn-sync": {
    // The child inherits the filter. It writes with write(2), which the filter allows.
    const result = spawnSync(process.execPath, ["-e", "require('node:fs').writeSync(1, 'from child')"], {
      encoding: "utf8",
    });
    fs.writeSync(
      1,
      JSON.stringify({ status: result.status, stdout: result.stdout, error: result.error?.code ?? null }),
    );
    break;
  }
}
