// Installs a seccomp filter that makes sendfile(2) fail with the errno in
// argv[2], then uploads a Bun.file() body over plain HTTP. The upload must
// complete through the read+write fallback. Linux only.
import { dlopen, ptr } from "bun:ffi";
import { libcPathForDlopen } from "harness";
import { join } from "node:path";

const errnoByName: Record<string, number> = { EINVAL: 22, ENOSYS: 38, EOPNOTSUPP: 95, EPERM: 1 };
const errno = errnoByName[process.argv[2]];
if (errno === undefined) throw new Error(`unknown errno ${process.argv[2]}`);

const NR_sendfile = process.arch === "x64" ? 40 : 71;
const NR_seccomp = process.arch === "x64" ? 317 : 277;

const { symbols: libc } = dlopen(libcPathForDlopen(), {
  prctl: { args: ["i32", "u64", "u64", "u64", "u64"], returns: "i32" },
  syscall: { args: ["i64", "i64", "i64", "ptr"], returns: "i64" },
});

// struct sock_filter { u16 code; u8 jt; u8 jf; u32 k; }
const filter = new DataView(new ArrayBuffer(4 * 8));
function insn(i: number, code: number, jt: number, jf: number, k: number) {
  filter.setUint16(i * 8, code, true);
  filter.setUint8(i * 8 + 2, jt);
  filter.setUint8(i * 8 + 3, jf);
  filter.setUint32(i * 8 + 4, k, true);
}
const BPF_LD_W_ABS = 0x20;
const BPF_JMP_JEQ_K = 0x15;
const BPF_RET_K = 0x06;
const SECCOMP_RET_ERRNO = 0x00050000;
const SECCOMP_RET_ALLOW = 0x7fff0000;
insn(0, BPF_LD_W_ABS, 0, 0, 0); // A = seccomp_data.nr
insn(1, BPF_JMP_JEQ_K, 0, 1, NR_sendfile);
insn(2, BPF_RET_K, 0, 0, SECCOMP_RET_ERRNO | errno);
insn(3, BPF_RET_K, 0, 0, SECCOMP_RET_ALLOW);

// struct sock_fprog { u16 len; struct sock_filter *filter; }
const prog = new DataView(new ArrayBuffer(16));
prog.setUint16(0, 4, true);
prog.setBigUint64(8, BigInt(ptr(filter.buffer)), true);

const PR_SET_NO_NEW_PRIVS = 38;
if (libc.prctl(PR_SET_NO_NEW_PRIVS, 1n, 0n, 0n, 0n) !== 0) {
  console.log("SKIP: prctl(PR_SET_NO_NEW_PRIVS) failed");
  process.exit(77);
}
const SECCOMP_SET_MODE_FILTER = 1;
const SECCOMP_FILTER_FLAG_TSYNC = 1;
if (libc.syscall(BigInt(NR_seccomp), BigInt(SECCOMP_SET_MODE_FILTER), BigInt(SECCOMP_FILTER_FLAG_TSYNC), ptr(prog.buffer)) !== 0n) {
  console.log("SKIP: seccomp(SET_MODE_FILTER) failed");
  process.exit(77);
}

const size = 256 * 1024 + 123;
const bytes = Buffer.alloc(size);
for (let i = 0; i < size; i++) bytes[i] = (i * 7) & 0xff;
const path = join(process.argv[3], "upload.bin");
await Bun.write(path, bytes);
const sliceStart = 12345;
const sliceEnd = sliceStart + 100_000;

// The whole file, then the same file again after the first refusal, then a
// slice so the fallback has to start at an offset other than 0.
const uploads = [
  { body: Bun.file(path), bytes },
  { body: Bun.file(path), bytes },
  { body: Bun.file(path).slice(sliceStart, sliceEnd), bytes: bytes.subarray(sliceStart, sliceEnd) },
];

await using server = Bun.serve({
  port: 0,
  development: false,
  maxRequestBodySize: size * 2,
  async fetch(req) {
    const hasher = new Bun.CryptoHasher("sha256");
    let received = 0;
    for await (const chunk of req.body!) {
      hasher.update(chunk);
      received += chunk.length;
    }
    return Response.json({
      contentLength: req.headers.get("content-length"),
      received,
      hash: hasher.digest("hex"),
    });
  },
});

const results = [];
for (const upload of uploads) {
  const res = await fetch(server.url, { method: "PUT", body: upload.body });
  const body = await res.json();
  results.push({
    status: res.status,
    ok: body.hash === Bun.CryptoHasher.hash("sha256", upload.bytes, "hex"),
    contentLength: body.contentLength,
    received: body.received,
    expected: upload.bytes.length,
  });
}
console.log(JSON.stringify(results));
