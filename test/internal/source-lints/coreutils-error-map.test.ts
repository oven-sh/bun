import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// bun_core::coreutils_error_map (src/bun_core/result.rs) is the errno ->
// strerror() text table behind shell builtin errors ("mkdir: x: File exists")
// and Output.err. It is stored as BASE (glibc's texts, used as-is on Linux and
// Windows) plus one #[cfg(target_os)] DELTA per OS whose libc words some
// errnos differently, so a test running on Linux never even compiles the macOS
// or FreeBSD rows. The macOS rows had been transcribed from the comments in
// Apple's <sys/errno.h> rather than from strerror() (EEXIST -> "File or folder
// exists", EPROCLIM -> "quotas & mush. Too many processes") and shipped that
// way for years. These lints check the tables as source text, against each
// OS's sys_errlist and against the SystemErrno enum (src/errno/<os>_errno.rs)
// whose variant names the tables are keyed by. The Node-facing libuv texts
// (src/sys/libuv_error_map.rs) are a different table with a different
// reference (uv.h) and are not covered here.

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

// Apple Libc, gen/FreeBSD/errlst.c (sys_errlist), i.e. what strerror() returns
// on macOS and therefore what bash and the BSD coreutils print there. One row
// per Darwin errno, in errno order.
const DARWIN_SYS_ERRLIST: [errno: number, name: string, text: string][] = [
  [1, "EPERM", "Operation not permitted"],
  [2, "ENOENT", "No such file or directory"],
  [3, "ESRCH", "No such process"],
  [4, "EINTR", "Interrupted system call"],
  [5, "EIO", "Input/output error"],
  [6, "ENXIO", "Device not configured"],
  [7, "E2BIG", "Argument list too long"],
  [8, "ENOEXEC", "Exec format error"],
  [9, "EBADF", "Bad file descriptor"],
  [10, "ECHILD", "No child processes"],
  [11, "EDEADLK", "Resource deadlock avoided"],
  [12, "ENOMEM", "Cannot allocate memory"],
  [13, "EACCES", "Permission denied"],
  [14, "EFAULT", "Bad address"],
  [15, "ENOTBLK", "Block device required"],
  [16, "EBUSY", "Resource busy"],
  [17, "EEXIST", "File exists"],
  [18, "EXDEV", "Cross-device link"],
  [19, "ENODEV", "Operation not supported by device"],
  [20, "ENOTDIR", "Not a directory"],
  [21, "EISDIR", "Is a directory"],
  [22, "EINVAL", "Invalid argument"],
  [23, "ENFILE", "Too many open files in system"],
  [24, "EMFILE", "Too many open files"],
  [25, "ENOTTY", "Inappropriate ioctl for device"],
  [26, "ETXTBSY", "Text file busy"],
  [27, "EFBIG", "File too large"],
  [28, "ENOSPC", "No space left on device"],
  [29, "ESPIPE", "Illegal seek"],
  [30, "EROFS", "Read-only file system"],
  [31, "EMLINK", "Too many links"],
  [32, "EPIPE", "Broken pipe"],
  [33, "EDOM", "Numerical argument out of domain"],
  [34, "ERANGE", "Result too large"],
  [35, "EAGAIN", "Resource temporarily unavailable"],
  [36, "EINPROGRESS", "Operation now in progress"],
  [37, "EALREADY", "Operation already in progress"],
  [38, "ENOTSOCK", "Socket operation on non-socket"],
  [39, "EDESTADDRREQ", "Destination address required"],
  [40, "EMSGSIZE", "Message too long"],
  [41, "EPROTOTYPE", "Protocol wrong type for socket"],
  [42, "ENOPROTOOPT", "Protocol not available"],
  [43, "EPROTONOSUPPORT", "Protocol not supported"],
  [44, "ESOCKTNOSUPPORT", "Socket type not supported"],
  [45, "ENOTSUP", "Operation not supported"],
  [46, "EPFNOSUPPORT", "Protocol family not supported"],
  [47, "EAFNOSUPPORT", "Address family not supported by protocol family"],
  [48, "EADDRINUSE", "Address already in use"],
  [49, "EADDRNOTAVAIL", "Can't assign requested address"],
  [50, "ENETDOWN", "Network is down"],
  [51, "ENETUNREACH", "Network is unreachable"],
  [52, "ENETRESET", "Network dropped connection on reset"],
  [53, "ECONNABORTED", "Software caused connection abort"],
  [54, "ECONNRESET", "Connection reset by peer"],
  [55, "ENOBUFS", "No buffer space available"],
  [56, "EISCONN", "Socket is already connected"],
  [57, "ENOTCONN", "Socket is not connected"],
  [58, "ESHUTDOWN", "Can't send after socket shutdown"],
  [59, "ETOOMANYREFS", "Too many references: can't splice"],
  [60, "ETIMEDOUT", "Operation timed out"],
  [61, "ECONNREFUSED", "Connection refused"],
  [62, "ELOOP", "Too many levels of symbolic links"],
  [63, "ENAMETOOLONG", "File name too long"],
  [64, "EHOSTDOWN", "Host is down"],
  [65, "EHOSTUNREACH", "No route to host"],
  [66, "ENOTEMPTY", "Directory not empty"],
  [67, "EPROCLIM", "Too many processes"],
  [68, "EUSERS", "Too many users"],
  [69, "EDQUOT", "Disc quota exceeded"],
  [70, "ESTALE", "Stale NFS file handle"],
  [71, "EREMOTE", "Too many levels of remote in path"],
  [72, "EBADRPC", "RPC struct is bad"],
  [73, "ERPCMISMATCH", "RPC version wrong"],
  [74, "EPROGUNAVAIL", "RPC prog. not avail"],
  [75, "EPROGMISMATCH", "Program version wrong"],
  [76, "EPROCUNAVAIL", "Bad procedure for program"],
  [77, "ENOLCK", "No locks available"],
  [78, "ENOSYS", "Function not implemented"],
  [79, "EFTYPE", "Inappropriate file type or format"],
  [80, "EAUTH", "Authentication error"],
  [81, "ENEEDAUTH", "Need authenticator"],
  [82, "EPWROFF", "Device power is off"],
  [83, "EDEVERR", "Device error"],
  [84, "EOVERFLOW", "Value too large to be stored in data type"],
  [85, "EBADEXEC", "Bad executable (or shared library)"],
  [86, "EBADARCH", "Bad CPU type in executable"],
  [87, "ESHLIBVERS", "Shared library version mismatch"],
  [88, "EBADMACHO", "Malformed Mach-o file"],
  [89, "ECANCELED", "Operation canceled"],
  [90, "EIDRM", "Identifier removed"],
  [91, "ENOMSG", "No message of desired type"],
  [92, "EILSEQ", "Illegal byte sequence"],
  [93, "ENOATTR", "Attribute not found"],
  [94, "EBADMSG", "Bad message"],
  [95, "EMULTIHOP", "EMULTIHOP (Reserved)"],
  [96, "ENODATA", "No message available on STREAM"],
  [97, "ENOLINK", "ENOLINK (Reserved)"],
  [98, "ENOSR", "No STREAM resources"],
  [99, "ENOSTR", "Not a STREAM"],
  [100, "EPROTO", "Protocol error"],
  [101, "ETIME", "STREAM ioctl timeout"],
  [102, "EOPNOTSUPP", "Operation not supported on socket"],
  [103, "ENOPOLICY", "Policy not found"],
  [104, "ENOTRECOVERABLE", "State not recoverable"],
  [105, "EOWNERDEAD", "Previous owner died"],
  [106, "EQFULL", "Interface output queue is full"],
];

// FreeBSD lib/libc/gen/errlst.c. Both lists descend from 4.4BSD's, so FreeBSD
// words every errno it shares with Darwin the same way except these four, and
// adds four of its own; everything else must read as on Darwin.
const FREEBSD_SYS_ERRLIST_DIFFERENCES: Record<string, string> = {
  EBUSY: "Device busy",
  EOPNOTSUPP: "Operation not supported",
  EMULTIHOP: "Multihop attempted",
  ENOLINK: "Link has been severed",
  ECAPMODE: "Not permitted in capability mode",
  EDOOFUS: "Programming error",
  EINTEGRITY: "Integrity check failed",
  ENOTCAPABLE: "Capabilities insufficient",
};

// Linux has no text for these two: they are aliases of EAGAIN and EDEADLK in
// <errno.h>, and the enum only reserves their historical slots (41 and 58,
// for which glibc itself says "Unknown error 41").
const LINUX_ERRNOS_WITHOUT_TEXT = ["EWOULDBLOCK", "EDEADLOCK"];

const BSD_TARGETS: [targetOs: string, enumFile: string][] = [
  ["macos", "darwin_errno.rs"],
  ["freebsd", "freebsd_errno.rs"],
];

test.each(BSD_TARGETS)("%s: BASE + DELTA resolve every errno to the OS's strerror() text", (targetOs, enumFile) => {
  const base = parseStringMap("BASE");
  const delta = parseStringMap("DELTA", targetOs);
  const reference = strerrorTexts(targetOs, enumFile);

  const wrong: string[] = [];
  for (const [name, text] of reference) {
    const actual = delta.get(name) ?? base.get(name);
    if (actual !== text) wrong.push(`${name}: ${JSON.stringify(actual)}, strerror() says ${JSON.stringify(text)}`);
  }
  expect(wrong).toEqual([]);
});

// A row whose text is already BASE's is dead weight; a key the OS's enum does
// not have can never be looked up.
test.each(BSD_TARGETS)("%s: DELTA holds exactly the errnos whose text differs from BASE", (targetOs, enumFile) => {
  const base = parseStringMap("BASE");
  const delta = parseStringMap("DELTA", targetOs);
  const reference = strerrorTexts(targetOs, enumFile);

  const divergent = [...reference].filter(([name, text]) => base.get(name) !== text).map(([name]) => name);
  expect([...delta.keys()].sort()).toEqual(divergent.sort());
});

test("BASE has a text for every Linux errno and no row that no OS can reach", () => {
  const base = parseStringMap("BASE");
  const linux = [...parseSystemErrno("linux_errno.rs").keys()];

  const missing = linux.filter(name => !base.has(name) && !LINUX_ERRNOS_WITHOUT_TEXT.includes(name));
  expect(missing).toEqual([]);

  const reachable = new Set(linux);
  for (const [, enumFile] of BSD_TARGETS) {
    for (const name of parseSystemErrno(enumFile).keys()) reachable.add(name);
  }
  expect([...base.keys()].filter(name => !reachable.has(name))).toEqual([]);
});

// Variant name -> strerror() text for every variant of the OS's SystemErrno.
// Also cross-checks the enum against the reference list: on Darwin the enum
// must define exactly sys_errlist's errnos under sys_errlist's numbers; on
// FreeBSD every variant must be in the differences table or in Darwin's list.
function strerrorTexts(targetOs: string, enumFile: string): Map<string, string> {
  const errnos = parseSystemErrno(enumFile);
  const darwin = new Map(DARWIN_SYS_ERRLIST.map(([, name, text]) => [name, text]));

  if (targetOs === "macos") {
    expect(errnos).toEqual(new Map(DARWIN_SYS_ERRLIST.map(([errno, name]) => [name, errno])));
    return darwin;
  }

  expect(Object.keys(FREEBSD_SYS_ERRLIST_DIFFERENCES).filter(name => !errnos.has(name))).toEqual([]);
  const texts = new Map<string, string>();
  const unknown: string[] = [];
  for (const name of errnos.keys()) {
    const text = FREEBSD_SYS_ERRLIST_DIFFERENCES[name] ?? darwin.get(name);
    if (text === undefined) unknown.push(name);
    else texts.set(name, text);
  }
  expect(unknown).toEqual([]);
  return texts;
}

// The `"ENOENT" => "No such file or directory",` rows of one
// `comptime_string_map! { static <name>: ... }` block in result.rs; the DELTA
// blocks are told apart by the `#[cfg(target_os = "...")]` preceding them.
function parseStringMap(name: string, targetOs?: string): Map<string, string> {
  const source = readFileSync(path.join(repoRoot, "src", "bun_core", "result.rs"), "utf8");
  const cfg = targetOs === undefined ? 0 : source.indexOf(`#[cfg(target_os = "${targetOs}")]`);
  expect(cfg).toBeGreaterThan(-1);
  const start = source.indexOf(`static ${name}: &'static str = {`, cfg);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("};", start);
  expect(end).toBeGreaterThan(start);

  const rows = new Map<string, string>();
  for (const [, key, text] of source.slice(start, end).matchAll(/^\s*"(\w+)" => "([^"\\]*)",/gm)) {
    expect(rows.has(key)).toBeFalse();
    rows.set(key, text);
  }
  expect(rows.size).toBeGreaterThan(0);
  return rows;
}

// Variant name -> errno of the `pub enum SystemErrno` in src/errno/<file>.
function parseSystemErrno(file: string): Map<string, number> {
  const source = readFileSync(path.join(repoRoot, "src", "errno", file), "utf8");
  const start = source.indexOf("pub enum SystemErrno {");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);

  const errnos = new Map<string, number>();
  for (const [, name, errno] of source.slice(start, end).matchAll(/^\s+(E\w+) = (\d+),/gm)) {
    errnos.set(name, Number(errno));
  }
  expect(errnos.size).toBeGreaterThan(0);
  return errnos;
}
