// winsysfuzz runtime: trace log, fault schedule, per-call context.
//
// Trace format (one line per record, written to WSF_LOG_DIR\wsf-<pid>.log):
//   # header lines: pid, image bases, mode
//   X <seq> <tid> <sysid> <status_hex> <key> <cands>          normal exit
//   X <seq> <tid> <sysid> <status_hex> <key> <cands> !P       pre-fault (real call skipped)
//   X <seq> <tid> <sysid> <status_hex> <key> <cands> !Q/!M/!D  post/mangle/delay
// <key> is the coordinate identity: "<tag>:<hexrva>" - the syscall's
// immediate return address, module-tagged and module-relative (b=bun,
// k=kernelbase, n=ntdll, o=other). Deterministic per calling instruction
// and ASLR-stable. <cands> is a comma list of scraped bun.exe frames used
// only for attribution/display (never identity).
//
// Schedule format (WSF_SCHEDULE file), one rule per line:
//   <SyscallName> <key|*> <hit_index|*> <mode> <arg>
//   e.g.  NtCreateFile b:1a2b3c 3 pre C0000034
// A rule fires when its (syscall, key) match count reaches hit_index
// ('*' = every match). This is the enumerable fault coordinate the fuzzer
// sweeps - deterministic given the same JS program.

#include "common.h"
#include "generated/hooks.gen.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

namespace wsf {

namespace {

// --- reentrancy guard -------------------------------------------------------
// Our own log writes hit NtWriteFile, which is hooked. Any hook entered while
// another is active on this thread passes straight through: no logging, no
// faulting. Depth (not a bool) so nested reentry stays correct.
//
// NOT compiler TLS (__declspec(thread)): hooks fire on the loader's parallel
// worker threads during process init, before those threads have a TLS array
// — gs:[58h] is null there and implicit TLS access AVs. Instead the depth
// lives in a TlsAlloc'd index inside TEB->TlsSlots, the inline 64-slot array
// present in every TEB from thread birth, read directly (no TlsGetValue,
// which would clobber last-error mid-syscall).
DWORD g_tls = TLS_OUT_OF_INDEXES;

inline intptr_t Depth() { return (intptr_t)NtCurrentTeb()->TlsSlots[g_tls]; }
inline void SetDepth(intptr_t d) { NtCurrentTeb()->TlsSlots[g_tls] = (PVOID)d; }

// --- state ------------------------------------------------------------------
volatile bool g_ready = false;
HANDLE g_log = INVALID_HANDLE_VALUE;
SRWLOCK g_logLock = SRWLOCK_INIT;
volatile LONG64 g_seq = 0;

uintptr_t g_bunBase = 0;
uintptr_t g_bunEnd = 0;
// Union of bun.exe's executable sections; scraped callsite candidates must
// point here (data pointers into .rdata/.data are not return addresses).
uintptr_t g_txtBase = 0;
uintptr_t g_txtEnd = 0;

// Module ranges for the COORDINATE KEY. The key is the syscall's immediate
// return address (_ReturnAddress: the stub's real caller) - deterministic
// per calling instruction, unlike a scraped stack frame which can be a
// leftover from a finished call. It is stored module-tagged and
// module-relative so it is stable across ASLR: 'b' bun.exe, 'k'
// kernelbase, 'n' ntdll, 'o' other (absolute; rare - mswsock etc.). Scraped
// bun frames remain as attribution/display candidates, never as identity.
uintptr_t g_kbBase = 0, g_kbEnd = 0; // kernelbase
uintptr_t g_ntBase = 0, g_ntEnd = 0; // ntdll

struct CallKey {
  char tag;      // 'b' 'k' 'n' 'o'
  uintptr_t rva; // module-relative (absolute for 'o')
};
inline CallKey KeyOf(uintptr_t ret) {
  if (ret >= g_bunBase && ret < g_bunEnd) return {'b', ret - g_bunBase};
  if (ret >= g_kbBase && ret < g_kbEnd) return {'k', ret - g_kbBase};
  if (ret >= g_ntBase && ret < g_ntEnd) return {'n', ret - g_ntBase};
  return {'o', ret};
}
uintptr_t ImageSize(HMODULE m) {
  if (!m) return 0;
  auto* dos = (IMAGE_DOS_HEADER*)m;
  auto* nt = (IMAGE_NT_HEADERS*)((uintptr_t)m + dos->e_lfanew);
  return nt->OptionalHeader.SizeOfImage;
}

// A return address points just past a call. Checking the preceding bytes
// for a call encoding filters stack garbage that merely looks like a code
// pointer. Covers the encodings compilers emit: E8 rel32, and FF /2
// (register/memory) with optional REX prefix and displacement.
inline bool AfterCall(uintptr_t ip) {
  const uint8_t* p = (const uint8_t*)ip;
  if (ip < g_txtBase + 7) return false;
  if (p[-5] == 0xE8) return true;                                     // call rel32
  auto reg2 = [](uint8_t modrm) { return ((modrm >> 3) & 7) == 2; };
  if (p[-2] == 0xFF && reg2(p[-1])) return true;                        // call reg / [reg]
  if (p[-3] == 0xFF && reg2(p[-2])) return true;                        // call [reg+disp8] / SIB
  if (p[-3] >= 0x40 && p[-3] <= 0x4F && p[-2] == 0xFF && reg2(p[-1])) return true; // REX call reg
  if (p[-4] >= 0x40 && p[-4] <= 0x4F && p[-3] == 0xFF && reg2(p[-2])) return true;
  if (p[-6] == 0xFF && reg2(p[-5])) return true;                        // call [reg+disp32]
  if (p[-7] >= 0x40 && p[-7] <= 0x4F && p[-6] == 0xFF && reg2(p[-5])) return true; // REX + disp32
  return false;
}

// WSF_FRAMES scales the stack-scrape depth (x32 qwords); 0 = _ReturnAddress only.
int g_frames = 6;
// WSF_MAXRECS caps X/E trace records per process (default 3M). A stress
// workload issues tens of millions of syscalls whose tail is repetition;
// unbounded traces reached 200+ MB per run and filled the disk mid-sweep.
// Faults keep firing past the cap (hit counting never depends on logging);
// only the record emission stops. # notes and T records stay exempt.
LONG64 g_maxRecs = 3000000;
// WSF_ARGS=1: decode and log the NT path handed to path-bearing syscalls
// ('A' records) — the hostile-argument attack's ground truth.
bool g_logArgs = false;

// --- handle typing ---------------------------------------------------------
// A per-process open-handle table: when a create/open succeeds we remember
// what the handle refers to (a file's path tail, a named pipe, the AFD
// socket device), so later reads/writes/ioctls can say "write to
// scratch.sqlite" or "AFD ioctl on socket" instead of a bare 0x1c4 - and
// so faults can later target WHAT is being touched, not just where. Bounded
// hash table, lock-free-ish (relaxed correctness is fine: worst case a stale
// tag), never allocates in a hook.
struct HandleEnt {
  volatile ULONG_PTR h; // 0 = empty
  char kind;            // 'f' file, 's' socket(AFD), 'p' pipe, 'k' key, 'o' other
  bool own;             // file lives under bun's own executable directory
  char tail[46];        // trailing bytes of the object name (ASCII-narrowed)
};

// bun's own image directory (NT-path form, lowercase, no trailing slash),
// e.g. "\??\c:\bun\build\debug". A file whose full path is under it is
// part of the runtime itself: infeasible to corrupt, so garbage skips it.
wchar_t g_exeDirW[MAX_PATH] = L"";
constexpr int kHandleSlots = 4096;
HandleEnt g_handles[kHandleSlots];

inline int HandleSlot(ULONG_PTR h) { return (int)(((uintptr_t)h >> 2) & (kHandleSlots - 1)); }

// --- pending receives: poison peer data at COMPLETION time ---------------
// An overlapped AFD_RECV returns STATUS_PENDING; the received bytes land
// LATER, when its completion (same IO_STATUS_BLOCK pointer, Information =
// byte count) is dequeued by NtRemoveIoCompletionEx. So a garbage rule on
// a receive records the WSABUF array here at entry, keyed by the IOSB, and
// the poison is applied when the matching completion is dequeued - real
// peer data, corrupted the way a hostile/broken remote would send it.
struct PendingRecv {
  volatile ULONG_PTR iosb; // 0 = empty slot; the completion's identity
  ULONG_PTR wsabuf;        // WSABUF array (from AFD_RECV_INFO)
  ULONG count;             // BufferCount
  ULONG seed;              // rule status = corruption seed
};
constexpr int kPendingSlots = 1024;
PendingRecv g_pending[kPendingSlots];
inline int PendingSlot(ULONG_PTR io) { return (int)(((uintptr_t)io >> 4) & (kPendingSlots - 1)); }

void RememberRecv(ULONG_PTR iosb, ULONG_PTR wsabuf, ULONG count, ULONG seed) {
  if (!iosb || !wsabuf) return;
  PendingRecv& e = g_pending[PendingSlot(iosb)];
  e.wsabuf = wsabuf;
  e.count = count;
  e.seed = seed;
  e.iosb = iosb; // publish last
}
// Poison the transferred bytes of a completed receive; returns true if the
// completion matched a pending poisoned recv.
bool PoisonCompletedRecv(ULONG_PTR iosb, ULONG_PTR transferred) {
  PendingRecv& e = g_pending[PendingSlot(iosb)];
  if (e.iosb != iosb) return false;
  uint32_t st = (uint32_t)e.seed * 2654435761u + (uint32_t)transferred;
  __try {
    auto* wsa = (unsigned char*)e.wsabuf; // WSABUF{ULONG len; CHAR* buf;} x count
    size_t left = (size_t)transferred;
    for (ULONG w = 0; w < e.count && left > 0; w++) {
      ULONG len = *(ULONG*)(wsa + w * 16);
      auto* b = *(unsigned char**)(wsa + w * 16 + 8);
      size_t take = len < left ? len : left;
      for (size_t i = 0; i < take; i++) {
        st = st * 1664525u + 1013904223u;
        if ((st >> 29) == 0) b[i] ^= (unsigned char)(st >> 21);
      }
      left -= take;
    }
  } __except (EXCEPTION_EXECUTE_HANDLER) {}
  e.iosb = 0;
  return true;
}

// Classify a decoded NT path into a handle kind, and keep its readable tail.
void RememberHandle(ULONG_PTR h, const wchar_t* path, size_t units) {
  if (!h || !units) return;
  HandleEnt& e = g_handles[HandleSlot(h)];
  char kind = 'o';
  // Under bun's own exe directory? (case-insensitive NT-path prefix)
  bool own = false;
  size_t dl = wcslen(g_exeDirW);
  if (dl && units > dl && _wcsnicmp(path, g_exeDirW, dl) == 0) own = true;
  // \Device\Afd = a socket; \Device\NamedPipe or \??\pipe\ = a pipe.
  for (size_t i = 0; i + 3 < units; i++) {
    if ((path[i] == L'A' || path[i] == L'a') && path[i + 1] == L'f' && path[i + 2] == L'd') { kind = 's'; break; }
    if ((path[i] == L'P' || path[i] == L'p') && (path[i + 1] == L'i') && (path[i + 2] == L'p') && (path[i + 3] == L'e')) { kind = 'p'; break; }
  }
  if (kind == 'o') kind = 'f';
  // keep the last ~44 chars of the name for readability
  size_t start = units > 44 ? units - 44 : 0;
  size_t o = 0;
  for (size_t i = start; i < units && o < sizeof e.tail - 1; i++) {
    wchar_t c = path[i];
    e.tail[o++] = (c > 0x20 && c < 0x7f) ? (char)c : '_';
  }
  e.tail[o] = 0;
  e.kind = kind;
  e.own = own;
  e.h = h; // publish last
}

const HandleEnt* LookupHandle(ULONG_PTR h) {
  if (!h) return nullptr;
  const HandleEnt& e = g_handles[HandleSlot(h)];
  return e.h == h ? &e : nullptr;
}

void ForgetHandle(ULONG_PTR h) {
  HandleEnt& e = g_handles[HandleSlot(h)];
  if (e.h == h) e.h = 0;
}

// Decode the AFD (winsock kernel driver) ioctls bun's sockets go through -
// which turns "some NtDeviceIoControlFile failed" into "AFD_RECV failed".
const char* AfdName(ULONG code) {
  switch (code) {
    case 0x12003: return "AFD_BIND";
    case 0x12007: return "AFD_CONNECT";
    case 0x1200B: return "AFD_START_LISTEN";
    case 0x1200F: return "AFD_WAIT_FOR_LISTEN";
    case 0x12010: return "AFD_ACCEPT";
    case 0x12017: return "AFD_RECV";
    case 0x1201B: return "AFD_RECV_DATAGRAM";
    case 0x1201F: return "AFD_SEND";
    case 0x12023: return "AFD_SEND_DATAGRAM";
    case 0x12024: return "AFD_POLL";
    case 0x1202B: return "AFD_GET_ADDRESS";
    case 0x1202F: return "AFD_QUERY_HANDLES";
    case 0x12043: return "AFD_GET_INFO";
    case 0x12047: return "AFD_SET_CONTEXT";
    case 0x1204B: return "AFD_SET_CONNECT_JOIN_HANDLES";
    case 0x1207B: return "AFD_TRANSMIT_FILE";
    case 0x120BB: return "AFD_SUPER_CONNECT";
    case 0x120BF: return "AFD_SUPER_DISCONNECT";
    case 0x120C7: return "AFD_RIO";
    case 0x120D3: return "AFD_ADDRESS_LIST_QUERY";
    default: return nullptr;
  }
}

// Copy an OBJECT_ATTRIBUTES' ObjectName into 'out' (UTF-16), tolerating a
// wild pointer from the target: reading through a bad pointer bun passed
// must fault into __except here, not crash the process and get blamed on
// bun. Returns the number of UTF-16 units copied.
static size_t SafeCopyObjectName(const void* oaPtr, wchar_t* out, size_t cap) {
  __try {
    auto* oa = (const OBJECT_ATTRIBUTES*)oaPtr;
    if (!oa || !oa->ObjectName || !oa->ObjectName->Buffer) return 0;
    size_t units = oa->ObjectName->Length / sizeof(wchar_t);
    if (units > cap) units = cap;
    for (size_t i = 0; i < units; i++) out[i] = oa->ObjectName->Buffer[i];
    return units;
  } __except (EXCEPTION_EXECUTE_HANDLER) {
    return 0;
  }
}

// Escape UTF-16 into printable ASCII: printable ASCII as-is (except space,
// backslash and quote, which are hex-escaped so the record stays one token
// and unambiguous), everything else as \uXXXX. Hostile paths keep every
// odd byte visible: lone surrogates, embedded NULs, trailing spaces.
static size_t EscapeUtf16(const wchar_t* s, size_t n, char* out, size_t cap) {
  size_t o = 0;
  static const char hex[] = "0123456789abcdef";
  for (size_t i = 0; i < n && o + 7 < cap; i++) {
    wchar_t c = s[i];
    if (c > 0x20 && c < 0x7f && c != L'\\' && c != L'"') {
      out[o++] = (char)c;
    } else {
      out[o++] = '\\';
      out[o++] = 'u';
      out[o++] = hex[(c >> 12) & 15];
      out[o++] = hex[(c >> 8) & 15];
      out[o++] = hex[(c >> 4) & 15];
      out[o++] = hex[c & 15];
    }
  }
  out[o] = '\0';
  return o;
}

struct Rule {
  uint32_t sys;
  bool anyCallsite; // '*' key
  char keyTag;      // 'b' 'k' 'n' 'o' - which module the return address is in
  uintptr_t keyRva; // module-relative return address (the stable identity)
  ULONG ioctlCode;  // "afd:RECV|SEND|<hex>" key: match NtDeviceIoControlFile
                    // by its decoded control code at ANY callsite (payload
                    // faults need "the Nth AFD_RECV", not a return address).
  LONG hitIndex; // 0 => every match
  Fault mode;
  MangleKind mangle;
  ULONG_PTR status;
  volatile LONG hits;
};
Rule* g_rules = nullptr;
int g_ruleCount = 0;
// Per-syscall index into g_rules for O(1) "any rules for this syscall?"
// -1 = none. Rules for a syscall are contiguous after sorting by sysid.
int g_ruleStart[SYS__COUNT];
int g_ruleEnd[SYS__COUNT];

// --- helpers ----------------------------------------------------------------
void LogRaw(const char* s, size_t n) {
  if (g_log == INVALID_HANDLE_VALUE) return;
  // Our own WriteFile hits the hooked NtWriteFile. From a syscall hook the
  // depth is already >0 so it passes through; but from any OTHER context
  // (the CreateProcessW hook, attach) depth is 0 - the nested hook would
  // then try to take g_logLock, which this thread already holds: SRW is not
  // recursive, self-deadlock. Raise the depth around our own write, always.
  intptr_t d = Depth();
  SetDepth(d + 1);
  AcquireSRWLockExclusive(&g_logLock);
  DWORD w;
  WriteFile(g_log, s, (DWORD)n, &w, nullptr);
  ReleaseSRWLockExclusive(&g_logLock);
  SetDepth(d);
}

void LogLine(const char* fmt, ...);

} // namespace

// Depth guard for non-syscall-hook code (recursive injection housekeeping):
// syscalls made inside the guarded region pass through untraced, so the
// fuzzer's own machinery never appears in bun's trace or matches a fault.
void DepthPush() { SetDepth(Depth() + 1); }
void DepthPop() { SetDepth(Depth() - 1); }

// Public: header/note lines. Same writer as LogLine.
void LogNote(const char* fmt, ...) {
  char buf[512];
  va_list ap;
  va_start(ap, fmt);
  int n = vsnprintf(buf, sizeof buf, fmt, ap);
  va_end(ap);
  if (n < 0) return;
  if (n >= (int)sizeof buf) n = sizeof buf - 1;
  LogRaw(buf, (size_t)n);
}

namespace {

void LogLine(const char* fmt, ...) {
  char buf[512];
  va_list ap;
  va_start(ap, fmt);
  int n = vsnprintf(buf, sizeof buf, fmt, ap);
  va_end(ap);
  if (n < 0) return;
  if (n >= (int)sizeof buf) n = sizeof buf - 1;
  LogRaw(buf, (size_t)n);
}

bool EnvA(const char* name, char* buf, DWORD cap) {
  DWORD n = GetEnvironmentVariableA(name, buf, cap);
  return n > 0 && n < cap;
}

uint32_t SysIdByName(const char* name) {
  for (uint32_t i = 0; i < SYS__COUNT; i++)
    if (strcmp(kHooks[i].name, name) == 0) return i;
  return SYS__COUNT;
}

void LoadSchedule(const char* path) {
  FILE* f = nullptr;
  if (fopen_s(&f, path, "r") != 0 || !f) {
    LogLine("# schedule open failed: %s\n", path);
    return;
  }
  int cap = 64;
  g_rules = (Rule*)calloc(cap, sizeof(Rule));
  char line[256];
  while (fgets(line, sizeof line, f)) {
    char sysName[80], rvaTok[32], hitTok[16], modeTok[24], statusTok[24];
    if (sscanf_s(line, "%79s %31s %15s %23s %23s", sysName, (unsigned)sizeof sysName, rvaTok,
                 (unsigned)sizeof rvaTok, hitTok, (unsigned)sizeof hitTok, modeTok,
                 (unsigned)sizeof modeTok, statusTok, (unsigned)sizeof statusTok) != 5)
      continue;
    if (sysName[0] == '#') continue;
    uint32_t sys = SysIdByName(sysName);
    if (sys == SYS__COUNT) {
      LogLine("# schedule: unknown syscall %s\n", sysName);
      continue;
    }
    if (g_ruleCount == cap) {
      cap *= 2;
      g_rules = (Rule*)realloc(g_rules, cap * sizeof(Rule));
    }
    Rule& r = g_rules[g_ruleCount++];
    memset(&r, 0, sizeof r);
    r.sys = sys;
    r.anyCallsite = rvaTok[0] == '*';
    // "afd:RECV" / "afd:SEND" / "afd:<hex>": match the ioctl by its decoded
    // AFD control code at any callsite - socket payloads travel through
    // varying stubs, so payload faults key on the code, not the address.
    if (_strnicmp(rvaTok, "afd:", 4) == 0) {
      const char* c = rvaTok + 4;
      r.anyCallsite = true;
      if (_stricmp(c, "RECV") == 0) r.ioctlCode = 0x12017;
      else if (_stricmp(c, "SEND") == 0) r.ioctlCode = 0x1201F;
      else if (_stricmp(c, "RECVDG") == 0) r.ioctlCode = 0x1201B;
      else r.ioctlCode = (ULONG)strtoul(c, nullptr, 16);
    }
    // Key format "<tag>:<hexrva>", e.g. b:1a2b3c (bun), k:4a77 (kernelbase).
    // A bare hex value is accepted as a bun key for hand-written schedules.
    else if (!r.anyCallsite) {
      if (rvaTok[1] == ':') {
        r.keyTag = rvaTok[0];
        r.keyRva = (uintptr_t)strtoull(rvaTok + 2, nullptr, 16);
      } else {
        r.keyTag = 'b';
        r.keyRva = (uintptr_t)strtoull(rvaTok, nullptr, 16);
      }
    }
    r.hitIndex = hitTok[0] == '*' ? 0 : (LONG)strtol(hitTok, nullptr, 10);
    // mode: pre | post | mangle:short | mangle:zero | delay
    // status field is hex for statuses; for delay it is decimal milliseconds.
    if (strncmp(modeTok, "mangle", 6) == 0) {
      r.mode = Fault::Mangle;
      r.mangle = strstr(modeTok, "zero")      ? MangleKind::Zero
                 : strstr(modeTok, "garbage") ? MangleKind::Garbage
                                               : MangleKind::Short;
      r.status = 0;
    } else if (strncmp(modeTok, "delay", 5) == 0) {
      r.mode = Fault::Delay;
      r.status = (ULONG_PTR)strtoul(statusTok, nullptr, 10);
    } else if ((modeTok[0] == 'p' || modeTok[0] == 'P') && (modeTok[1] == 'r' || modeTok[1] == 'R')) {
      r.mode = Fault::Pre;
      r.status = (ULONG_PTR)strtoull(statusTok, nullptr, 16);
    } else {
      r.mode = Fault::Post;
      r.status = (ULONG_PTR)strtoull(statusTok, nullptr, 16);
    }
  }
  fclose(f);
  // Group rules by syscall so a hook checks only its own.
  for (int i = 0; i < g_ruleCount; i++)
    for (int j = i + 1; j < g_ruleCount; j++)
      if (g_rules[j].sys < g_rules[i].sys) {
        Rule t = g_rules[i];
        g_rules[i] = g_rules[j];
        g_rules[j] = t;
      }
  for (uint32_t s = 0; s < SYS__COUNT; s++) g_ruleStart[s] = g_ruleEnd[s] = -1;
  for (int i = 0; i < g_ruleCount; i++) {
    uint32_t s = g_rules[i].sys;
    if (g_ruleStart[s] < 0) g_ruleStart[s] = i;
    g_ruleEnd[s] = i + 1;
  }
  LogLine("# schedule loaded: %d rules from %s\n", g_ruleCount, path);
}

} // namespace

// Entry-only record for syscalls that never return (NtContinue, ...). No
// context spans the call, so the depth guard is balanced entirely here —
// nothing leaks when control never comes back. 'E' record, no status.
void LogEntryOnly(uint32_t sysId, uintptr_t retAddr) {
  intptr_t d = Depth();
  if (!g_ready || d != 0) return;
  SetDepth(1);
  CallKey k = KeyOf(retAddr);
  LONG64 seq = InterlockedIncrement64(&g_seq);
  if (seq <= g_maxRecs)
    LogLine("E %lld %lu %u %c:%llx 0\n", seq, GetCurrentThreadId(), sysId, k.tag,
            (unsigned long long)k.rva);
  SetDepth(0);
}

// The terminating thread's call stack, captured in-process at
// NtTerminateProcess: abort()/_exit and bun's crash handler all funnel here
// with the fatal path still on the stack, so a deep conservative scrape
// (same lock-free reader as CallCtx) recovers "_wassert <- uv__poll_set <-
// uv_poll_start <- us_poll_start" - the crash's why - with no debugger.
// Logged as one 'T' record: comma list of bun.exe RVAs, nearest first.
void LogTerminateStack(uintptr_t retAddr) {
  intptr_t d = Depth();
  if (!g_ready || d != 0) return;
  SetDepth(1);
  constexpr int kDeep = 40;
  uintptr_t frames[kDeep];
  int n = 0;
  auto* tib = (NT_TIB*)NtCurrentTeb();
  uintptr_t* sp = (uintptr_t*)&sp;
  uintptr_t* end = (uintptr_t*)tib->StackBase;
  for (uintptr_t* p = sp; p < end && n < kDeep; p++) {
    uintptr_t v = *p;
    if (v < g_txtBase || v >= g_txtEnd) continue;
    if (!AfterCall(v)) continue;
    bool dup = false;
    for (int i = 0; i < n; i++) if (frames[i] == v) { dup = true; break; }
    if (dup) continue;
    frames[n++] = v;
  }
  char buf[24 * kDeep];
  int o = 0;
  for (int i = 0; i < n; i++)
    o += snprintf(buf + o, sizeof buf - o, "%s%llx", i ? "," : "", (unsigned long long)(frames[i] - g_bunBase));
  buf[o] = 0;
  CallKey k = KeyOf(retAddr);
  LogLine("T %lu %c:%llx %s\n", GetCurrentThreadId(), k.tag, (unsigned long long)k.rva, n ? buf : "0");
  SetDepth(0);
}

// The leak oracle: at process termination the handle table holds every
// handle this process opened and never closed. Named entries (files,
// pipes, sockets, keys - not anonymous events/threads, which the process
// exit reaps by design and which flood the count) are the leak set.
// One 'L' record per leaked named handle: kind + name tail. The driver
// diffs the leak set against baseline - a fault that makes bun leak a
// file/pipe/socket handle it normally closes is a real, quiet bug that no
// crash or hang would ever reveal.
void LogLeakedHandles() {
  intptr_t d = Depth();
  if (!g_ready || d != 0) return;
  SetDepth(1);
  int emitted = 0;
  for (int i = 0; i < kHandleSlots && emitted < 400; i++) {
    const HandleEnt& e = g_handles[i];
    if (!e.h) continue;
    if (e.own) continue;              // bun's own installation files: never a leak
    if (!e.tail[0]) continue;          // anonymous object: reaped by process exit
    if (e.kind != 'f' && e.kind != 'p' && e.kind != 's' && e.kind != 'k') continue;
    LogLine("L %c %llx %s\n", e.kind, (unsigned long long)e.h, e.tail);
    emitted++;
  }
  SetDepth(0);
}

// --- CallCtx ---------------------------------------------------------------

CallCtx::CallCtx(uint32_t sysId, uintptr_t retAddr, ULONG_PTR* args, int argc)
    : sys_(sysId), args_(args), argc_(argc) {
  intptr_t d = Depth();
  live_ = g_ready && d == 0;
  SetDepth(d + 1);
  nframes_ = 0;
  if (!live_) return;
  frames_[0] = retAddr;
  nframes_ = 1;
  if (retAddr >= g_bunBase && retAddr < g_bunEnd) bunFrame_ = retAddr;
  // Find the bun.exe frame behind kernelbase/ntdll wrappers WITHOUT the
  // unwinder: RtlCaptureStackBackTrace takes the function-table lock, and
  // hooks fire on threads already holding it (loader, heap, JIT table
  // registration) — deadlock. Instead scrape our own stack conservatively:
  // scan raw qwords above us (bounded by TEB StackBase) for the nearest
  // value inside bun's image. Lock-free pure reads; stable per code path,
  // which is all the schedule's callsite key requires.
  if (g_frames > 0) {
    auto* tib = (NT_TIB*)NtCurrentTeb();
    uintptr_t* sp = (uintptr_t*)&sp;
    uintptr_t* end = (uintptr_t*)tib->StackBase;
    uintptr_t* limit = sp + (size_t)g_frames * 32;
    if (limit > end) limit = end;
    for (uintptr_t* p = sp; p < limit && nframes_ < kMaxFrames; p++) {
      uintptr_t v = *p;
      if (v < g_txtBase || v >= g_txtEnd) continue;
      if (!AfterCall(v)) continue;
      // The same return address recurs across recursive/loop frames and as
      // stack leftovers; a duplicate carries no new attribution, so skip it
      // to let the walk reach deeper distinct callers.
      bool dup = false;
      for (uint8_t k = 0; k < nframes_; k++) if (frames_[k] == v) { dup = true; break; }
      if (dup) continue;
      frames_[nframes_++] = v;
      if (bunFrame_ == 0) bunFrame_ = v;
    }
  }
}

bool CallCtx::PreFault() {
  if (!live_) return false;
  int start = g_ruleStart[sys_];
  if (start < 0) return false;
  // Match on the STABLE identity: the immediate return address, module-tagged.
  CallKey k = KeyOf(frames_[0]);
  for (int i = start; i < g_ruleEnd[sys_]; i++) {
    Rule& r = g_rules[i];
    if (!r.anyCallsite && (r.keyTag != k.tag || r.keyRva != k.rva)) continue;
    if (r.ioctlCode != 0) {
      int8_t xi = kHooks[sys_].ioctlIndex;
      if (!(sys_ == SYS_NtDeviceIoControlFile && xi >= 0 && xi < argc_ &&
            (ULONG)args_[xi] == r.ioctlCode))
        continue;
      // A code match at ANY callsite would land on the socket ioctls that
      // mswsock issues internally ('o:' key) - that module's own plumbing,
      // whose buffers and IOSBs are not bun's. A payload fault must land at
      // the boundary bun crosses: only bun-issued ('b') or API-boundary
      // ('k'/'n') calls. Same principle as every other o:-key exclusion.
      if (KeyOf(frames_[0]).tag == 'o') continue;
    }
    LONG hit = InterlockedIncrement(&r.hits);
    if (r.hitIndex != 0 && hit != r.hitIndex) continue;
    fault_ = r.mode;
    mangle_ = r.mangle;
    injected_ = r.status;
    // A garbage mangle on an overlapped AFD_RECV cannot be applied at exit
    // (the data arrives later, on completion): record the WSABUF array now,
    // keyed by the IOSB, and the dequeue hook poisons it when it completes.
    if (fault_ == Fault::Mangle && mangle_ == MangleKind::Garbage &&
        sys_ == SYS_NtDeviceIoControlFile) {
      int8_t xi = kHooks[sys_].ioctlIndex;
      int8_t ii = kHooks[sys_].iosbIndex;
      // The AFD_RECV_INFO lives in InputBuffer (argument 6), an IN param -
      // NOT the codegen bufIndex, which targets the transfer OUTPUT buffer
      // and is -1 for ioctls (that misdirection silently skipped the arm).
      const int kAfdInfoArg = 6;
      if (xi >= 0 && ii >= 0 && xi < argc_ && ii < argc_ && kAfdInfoArg < argc_ &&
          ((ULONG)args_[xi] == 0x12017 || (ULONG)args_[xi] == 0x1201B)) {
        __try {
          auto* info = (ULONG_PTR*)args_[kAfdInfoArg]; // AFD_RECV_INFO{WSABUF* arr; ULONG cnt;...}
          if (info && info[0]) {
            RememberRecv(args_[ii], info[0], (ULONG)info[1], (ULONG)injected_);
            deferredRecv_ = true; // poison happens at completion time
            if (g_logArgs) {
              char note[96];
              _snprintf_s(note, sizeof note, _TRUNCATE,
                          "# recv-arm iosb=%llx apcarg=%llx bufs=%lu\n",
                          (unsigned long long)args_[ii],
                          (unsigned long long)args_[kHooks[sys_].apcIndex >= 0 ? kHooks[sys_].apcIndex : ii],
                          (unsigned long)info[1]);
              LogNote(note);
            }
          }
        } __except (EXCEPTION_EXECUTE_HANDLER) {}
      }
    }
    if (fault_ == Fault::Mangle && mangle_ == MangleKind::Short) {
      // Realistic short transfer: shrink the requested Length BEFORE the
      // call so the kernel really moves fewer bytes - the file offset,
      // the buffer and IO_STATUS_BLOCK.Information all agree, exactly as
      // with a genuine short read/write. (Fudging Information after a full
      // transfer would leave the offset advanced past unread bytes: an
      // unrealistic lie a correct read loop cannot survive by design.)
      int8_t li = kHooks[sys_].lengthIndex;
      int8_t xi = kHooks[sys_].ioctlIndex;
      if (sys_ == SYS_NtDeviceIoControlFile && xi >= 0 && xi < argc_) {
        // AFD sockets: the payload is INDIRECT - a WSABUF array inside the
        // AFD_SEND_INFO the input buffer points at. Input/OutputBufferLength
        // describe that struct, so shrinking them fabricates a malformed
        // call. For a genuine partial send, halve the first WSABUF.len: the
        // kernel then really accepts fewer payload bytes.
        ULONG code = (ULONG)args_[xi];
        // NB: for ANY ioctl the info-struct length is never shrunk (a
        // malformed call the OS never makes) - only the AFD_SEND payload
        // is followed. Non-AFD ioctls therefore never get a Short mangle.
        if (code == 0x1201F /* AFD_SEND */ && argc_ > 6) {
          __try {
            auto* info = (ULONG_PTR*)args_[6]; // AFD_SEND_INFO (InputBuffer, arg 6)
            if (info && info[0]) {
              ULONG* wsabuf = (ULONG*)info[0]; // WSABUF{ ULONG len; CHAR* buf; }
              if (wsabuf[0] > 1) {
                wsabuf[0] = wsabuf[0] / 2;
                shrunk_ = true;
              }
            }
          } __except (EXCEPTION_EXECUTE_HANDLER) {}
        }
      } else if (sys_ != SYS_NtDeviceIoControlFile && sys_ != SYS_NtFsControlFile &&
                 li >= 0 && li < argc_ && args_[li] > 1) {
        // Plain read/query calls: Length IS the caller's output buffer.
        args_[li] = args_[li] / 2;
        shrunk_ = true;
      }
    }
    if (fault_ == Fault::Pre) {
      // Real call is skipped: log the exit record here.
      char rvas[64];
      char kbuf[24];
      FormatRvas(rvas, sizeof rvas);
      LONG64 seq = InterlockedIncrement64(&g_seq);
      if (seq <= g_maxRecs) {
        CallCtx::Key(kbuf, sizeof kbuf, frames_[0]);
        LogLine("X %lld %lu %u %llx %s %s !P\n", seq, GetCurrentThreadId(), sys_,
                (unsigned long long)injected_, kbuf, rvas);
        LogDetail(seq, injected_);
      }
      return true;
    }
    return false; // post-fault: real call runs, Exit() substitutes
  }
  return false;
}

CallCtx::~CallCtx() { SetDepth(Depth() - 1); }

// Format the coordinate key "<tag>:<hexrva>" from a return address.
void CallCtx::Key(char* out, size_t cap, uintptr_t retAddr) {
  CallKey k = KeyOf(retAddr);
  snprintf(out, cap, "%c:%llx", k.tag, (unsigned long long)k.rva);
}

void CallCtx::FormatRvas(char* out, size_t cap) const {
  size_t len = 0;
  int emitted = 0;
  out[0] = '\0';
  for (int i = 0; i < nframes_ && emitted < 4; i++) {
    uintptr_t ip = frames_[i];
    if (ip < g_txtBase || ip >= g_txtEnd) continue; // frame0 may be outside bun
    int n = snprintf(out + len, cap - len, "%s%llx", emitted ? "," : "",
                     (unsigned long long)(ip - g_bunBase));
    if (n < 0 || (size_t)n >= cap - len) break;
    len += (size_t)n;
    emitted++;
  }
  if (!emitted) snprintf(out, cap, "0");
}

ULONG_PTR CallCtx::Exit(ULONG_PTR real) {
  ULONG_PTR ret = real;
  // A post-fault lies "the call failed" - but if the real return was
  // STATUS_PENDING the operation is genuinely queued and its completion WILL
  // arrive on the IOCP. "Failed AND completed later" is a world the kernel
  // never produces (double-processing the request follows), so a lie there
  // manufactures unreal bugs. Drop the post-fault; keep the truth.
  // ...and whenever the operation is OVERLAPPED (a non-null ApcContext):
  // its completion is posted to the IOCP even when the call succeeds
  // synchronously, so lying "failed" would have the request processed
  // twice - accounting the kernel makes impossible.
  bool overlapped = false;
  int8_t apc = kHooks[sys_].apcIndex;
  if (apc >= 0 && apc < argc_ && args_[apc] != 0) overlapped = true;
  if (fault_ == Fault::Post && ((ULONG)real == 0x103 || overlapped)) {
    fault_ = Fault::None;
    LogNote((ULONG)real == 0x103
                ? "# post-fault dropped: real return was STATUS_PENDING (completion is coming)\n"
                : "# post-fault dropped: overlapped op posts a completion (would double-process)\n");
  }
  if (live_) {
    const char* tag = "";
    if (fault_ == Fault::Post) {
      ret = injected_;
      tag = " !Q";
    } else if (fault_ == Fault::Delay) {
      // Real status returns after a deterministic pause at this coordinate.
      // The nested NtDelayExecution passes through unlogged (depth > 0).
      // A close issued from inside a system DLL ('n'/'o' key) is that
      // module's own bookkeeping; delaying it only manufactures system-side
      // stalls. Delays land on bun-issued ('b') and API-boundary ('k') calls.
      char kt = KeyOf(frames_[0]).tag;
      if (sys_ == SYS_NtClose && (kt == 'n' || kt == 'o')) {
        tag = "";
      } else {
        Sleep((DWORD)injected_);
        tag = " !D";
      }
    } else if (fault_ == Fault::Mangle) {
      bool applied = false;
      // Only a synchronous success has a filled IO_STATUS_BLOCK to mangle;
      // a pending async op's IOSB is written by the kernel later.
      // A shrunk-Length short transfer is already coherent; only the
      // no-Length-arg fallback and mangle:zero touch the IOSB here.
      int8_t idx = kHooks[sys_].iosbIndex;
      if (shrunk_) applied = true;
      if (!shrunk_ && (ULONG)ret == 0 && idx >= 0 && idx < argc_) {
        auto* iosb = (IO_STATUS_BLOCK*)args_[idx];
        if (iosb) {
          if (mangle_ == MangleKind::Zero) {
            iosb->Information = 0;
            applied = true;
          } else if (mangle_ == MangleKind::Garbage) {
            // The transfer really succeeded; corrupt what landed. The lying
            // filter driver / bad hardware class: well-formed success,
            // poisoned data. XOR pattern from a rule-seeded LCG (injected_ =
            // seed) so every replay corrupts the identical bytes. Flip a
            // sparse ~1/8 of the buffer, never past the transferred count.
            // Never corrupt a read of bun's own installation files (its
            // bundled JS, its own binary/pdb): poisoning the runtime's own
            // image is infeasible - no user environment does that - and only
            // manufactures release-asserts in the module loader.
            int8_t bi = kHooks[sys_].bufIndex;
            size_t n = (size_t)iosb->Information;
            // Skip infeasible corruption targets: bun's own installation
            // files, and code/config the module graph loads (corrupting
            // those manufactures parse errors / loader asserts, not the
            // data-path bugs garbage is for). Data files, pipes and
            // sockets stay in scope.
            bool skip = false; // infeasible target => the mangle does not fire
            // A call whose immediate caller is another module ('o' key) is
            // that module operating on ITS OWN private buffer (e.g. mswsock's
            // internal ioctls inside accept/select). Corrupting it sabotages
            // system code from inside its machinery - not bun's data path.
            if (KeyOf(frames_[0]).tag == 'o') skip = true;
            int8_t hi = kHooks[sys_].handleIndex;
            if (hi >= 0 && hi < argc_) {
              const HandleEnt* he = LookupHandle(args_[hi]);
              if (he) {
                if (he->own) skip = true;
                if (he->kind == 'f') {
                  static const char* kCodeExt[] = {
                    ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".tsx", ".jsx",
                    ".json", ".jsonc", ".toml", ".node", ".dll", ".exe", ".pdb",
                    ".map", ".d.ts", ".lockb", ".yaml", ".yml"};
                  size_t tl = strlen(he->tail);
                  for (const char* ext : kCodeExt) {
                    size_t el = strlen(ext);
                    if (tl >= el && _stricmp(he->tail + tl - el, ext) == 0) { skip = true; break; }
                  }
                }
              }
            }
            // AFD sockets: the received payload is INDIRECT - args_[bi] is
            // the AFD_RECV_INFO whose WSABUF array holds the real buffers.
            // Poison the actually-received bytes (n = Information) across
            // those buffers - malformed data from a hostile/broken peer,
            // maximally realistic - instead of the info struct itself.
            int8_t xi = kHooks[sys_].ioctlIndex;
            bool afdRecv = sys_ == SYS_NtDeviceIoControlFile && xi >= 0 && xi < argc_ &&
                           ((ULONG)args_[xi] == 0x12017 /* AFD_RECV */ ||
                            (ULONG)args_[xi] == 0x1201B /* AFD_RECV_DATAGRAM */);
            if (afdRecv) skip = false; // peer data, always in scope
            if (!skip && afdRecv && argc_ > 6 && args_[6] && n > 0) {
              applied = true;
              uint32_t st = (uint32_t)injected_ * 2654435761u + (uint32_t)n;
              __try {
                auto* info = (ULONG_PTR*)args_[6];        // AFD_RECV_INFO (InputBuffer, arg 6)
                auto* wsa = (unsigned char*)info[0];         // WSABUF array
                ULONG count = (ULONG)info[1];               // BufferCount
                size_t left = n;
                for (ULONG w = 0; w < count && left > 0; w++) {
                  ULONG len = *(ULONG*)(wsa + w * 16);       // WSABUF{ULONG len; CHAR* buf;}
                  auto* b = *(unsigned char**)(wsa + w * 16 + 8);
                  size_t take = len < left ? len : left;
                  for (size_t i = 0; i < take; i++) {
                    st = st * 1664525u + 1013904223u;
                    if ((st >> 29) == 0) b[i] ^= (unsigned char)(st >> 21);
                  }
                  left -= take;
                }
              } __except (EXCEPTION_EXECUTE_HANDLER) {
              }
            } else if (sys_ == SYS_NtDeviceIoControlFile || sys_ == SYS_NtFsControlFile) {
              // Any other ioctl: args_[bi] is a request/info struct, never a
              // payload we may poison. (Overlapped AFD_RECV is handled at
              // completion time; a non-AFD ioctl gets no garbage at all.)
            } else if (!skip && bi >= 0 && bi < argc_ && args_[bi] && n > 0) {
              applied = true;
              auto* b = (unsigned char*)args_[bi];
              uint32_t st = (uint32_t)injected_ * 2654435761u + (uint32_t)n;
              __try {
                for (size_t i = 0; i < n; i++) {
                  st = st * 1664525u + 1013904223u;
                  if ((st >> 29) == 0) b[i] ^= (unsigned char)(st >> 21);
                }
              } __except (EXCEPTION_EXECUTE_HANDLER) {
              }
            }
          } else if (iosb->Information > 1) {
            iosb->Information /= 2; // short (fallback)
            applied = true;
          }
        }
      }
      // Honest tagging: an infeasible/inapplicable mangle did not fire.
      if (applied) tag = " !M";
      // A garbage mangle deferred to completion time DID engage (tag it so
      // the run counts as fired); the poison lands when the recv completes.
      if (deferredRecv_) tag = " !M";
    }
    // Completion-time poison: a dequeued completion whose IO_STATUS_BLOCK
    // matches a pending poisoned AFD_RECV gets its transferred bytes
    // corrupted now, when the data has actually landed. The dequeue's out
    // array is FILE_IO_COMPLETION_INFORMATION{KeyContext, ApcContext,
    // IoStatusBlock{Status, Information}} (32 bytes each); AFD echoes the
    // original IOSB pointer as ApcContext for overlapped socket ops.
    if (sys_ == SYS_NtRemoveIoCompletionEx && (ULONG)ret == 0 && argc_ > 3) {
      __try {
        auto* arr = (unsigned char*)args_[1];
        ULONG n = args_[3] ? *(ULONG*)args_[3] : 0;
        if (n > 512) n = 512;
        for (ULONG i = 0; arr && i < n; i++) {
          ULONG_PTR key = *(ULONG_PTR*)(arr + i * 32 + 0);
          ULONG_PTR apc = *(ULONG_PTR*)(arr + i * 32 + 8);
          ULONG_PTR st = *(ULONG_PTR*)(arr + i * 32 + 16);
          ULONG_PTR info = *(ULONG_PTR*)(arr + i * 32 + 24);
          // Diagnostic: which field carries the recv's IOSB? Log each
          // completion's raw fields and whether ANY field matches a
          // pending recv, so the layout is read from data, not assumed.
          if (g_logArgs) {
            int hit = -1;
            if (g_pending[PendingSlot(key)].iosb == key) hit = 0;
            else if (g_pending[PendingSlot(apc)].iosb == apc) hit = 1;
            char note[128];
            _snprintf_s(note, sizeof note, _TRUNCATE,
                        "# cq-entry key=%llx apc=%llx st=%llx info=%llx match=%d\n",
                        (unsigned long long)key, (unsigned long long)apc,
                        (unsigned long long)st, (unsigned long long)info, hit);
            LogNote(note);
          }
          if (apc && PoisonCompletedRecv(apc, info)) LogNote("# recv completion poisoned at dequeue\n");
        }
      } __except (EXCEPTION_EXECUTE_HANDLER) {}
    }
    char rvas[64];
    char kbuf[24];
    FormatRvas(rvas, sizeof rvas);
    Key(kbuf, sizeof kbuf, frames_[0]);
    LONG64 seq = InterlockedIncrement64(&g_seq);
    if (seq <= g_maxRecs) {
      LogLine("X %lld %lu %u %llx %s %s%s\n", seq, GetCurrentThreadId(), sys_,
              (unsigned long long)ret, kbuf, rvas, tag);
      LogDetail(seq, ret);
    } else if (seq == g_maxRecs + 1) {
      LogNote("# record cap reached: further X/E records suppressed (faults still fire)\n");
    }
  }
  return ret;
}

// Detail decoding + handle-table maintenance for one syscall exit.
//  - Handle table (always on): remember what each newly created handle
//    refers to, forget closed ones - so later ops can name their target.
//  - 'A' record: the NT path handed to a path-bearing syscall.
//  - 'D' record: typed detail - the handle's target/kind, the AFD ioctl,
//    the requested length and bytes actually transferred.
// A and D share the X record's seq. Only when WSF_ARGS=1 (they cost log volume).
void CallCtx::LogDetail(LONG64 seq, ULONG_PTR ret) const {
  const HookEntry& e = kHooks[sys_];
  bool success = (ULONG)ret == 0;

  // Handle table maintenance.
  if (sys_ == SYS_NtClose && argc_ > 0) {
    ForgetHandle(args_[0]);
  } else if (success && e.hOutIndex >= 0 && e.hOutIndex < argc_) {
    ULONG_PTR h = 0;
    __try {
      h = (ULONG_PTR)(*(HANDLE*)args_[e.hOutIndex]);
    } __except (EXCEPTION_EXECUTE_HANDLER) {
      h = 0;
    }
    if (h && e.oaIndex >= 0 && e.oaIndex < argc_) {
      wchar_t p[128];
      size_t u = SafeCopyObjectName((const void*)args_[e.oaIndex], p, 128);
      if (u) RememberHandle(h, p, u);
    }
  }

  if (!g_logArgs) return;

  // 'A': path.
  if (e.oaIndex >= 0 && e.oaIndex < argc_) {
    wchar_t path[400];
    size_t units = SafeCopyObjectName((const void*)args_[e.oaIndex], path, 400);
    if (units) {
      char esc[900];
      EscapeUtf16(path, units, esc, sizeof esc);
      LogLine("A %lld %u %s\n", seq, sys_, esc);
    }
  }

  // 'D': typed detail. Build "k=v k=v" only for fields this syscall has.
  char d[256];
  int o = 0;
  d[0] = 0;
  if (e.handleIndex >= 0 && e.handleIndex < argc_) {
    ULONG_PTR h = args_[e.handleIndex];
    const HandleEnt* he = LookupHandle(h);
    if (he) o += snprintf(d + o, sizeof d - o, " h=%c:%s", he->kind, he->tail);
    else o += snprintf(d + o, sizeof d - o, " h=%llx", (unsigned long long)h);
  }
  if (e.ioctlIndex >= 0 && e.ioctlIndex < argc_ && o < (int)sizeof d) {
    ULONG code = (ULONG)args_[e.ioctlIndex];
    const char* name = AfdName(code);
    o += name ? snprintf(d + o, sizeof d - o, " ioctl=%s", name)
              : snprintf(d + o, sizeof d - o, " ioctl=%lx", code);
  }
  if (e.lengthIndex >= 0 && e.lengthIndex < argc_ && o < (int)sizeof d)
    o += snprintf(d + o, sizeof d - o, " len=%lu", (ULONG)args_[e.lengthIndex]);
  if (success && e.iosbIndex >= 0 && e.iosbIndex < argc_ && o < (int)sizeof d) {
    ULONG_PTR info = 0;
    bool ok = true;
    __try {
      auto* iosb = (IO_STATUS_BLOCK*)args_[e.iosbIndex];
      info = iosb ? iosb->Information : 0;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
      ok = false;
    }
    if (ok) o += snprintf(d + o, sizeof d - o, " xfer=%llu", (unsigned long long)info);
  }
  if (o > 0) LogLine("D %lld %u%s\n", seq, sys_, d);
}

// --- runtime init ----------------------------------------------------------

bool RuntimeInit() {
  g_tls = TlsAlloc();
  // TlsSlots is the TEB's inline 64-entry array; higher indexes live in
  // an expansion block that may not exist on early threads.
  if (g_tls == TLS_OUT_OF_INDEXES || g_tls >= 64) return false;
  SetDepth(Depth() + 1); // everything during init passes through, unlogged

  // bun.exe image range for callsite attribution.
  HMODULE exe = GetModuleHandleW(nullptr);
  g_bunBase = (uintptr_t)exe;
  auto* dos = (IMAGE_DOS_HEADER*)exe;
  auto* nt = (IMAGE_NT_HEADERS*)((uintptr_t)exe + dos->e_lfanew);
  g_bunEnd = g_bunBase + nt->OptionalHeader.SizeOfImage;
  // Executable-section span, for the callsite scrape's code-pointer test.
  auto* sec = IMAGE_FIRST_SECTION(nt);
  for (int i = 0; i < nt->FileHeader.NumberOfSections; i++, sec++) {
    if (!(sec->Characteristics & IMAGE_SCN_MEM_EXECUTE)) continue;
    uintptr_t lo = g_bunBase + sec->VirtualAddress;
    uintptr_t hi = lo + sec->Misc.VirtualSize;
    if (g_txtBase == 0 || lo < g_txtBase) g_txtBase = lo;
    if (hi > g_txtEnd) g_txtEnd = hi;
  }

  char dir[MAX_PATH] = ".";
  EnvA("WSF_LOG_DIR", dir, sizeof dir);
  char path[MAX_PATH];
  snprintf(path, sizeof path, "%s\\wsf-%lu.log", dir, GetCurrentProcessId());
  g_log = CreateFileA(path, FILE_APPEND_DATA, FILE_SHARE_READ, nullptr, CREATE_ALWAYS,
                      FILE_ATTRIBUTE_NORMAL, nullptr);

  char tmp[MAX_PATH];
  if (EnvA("WSF_FRAMES", tmp, sizeof tmp)) g_frames = atoi(tmp);
  if (g_frames < 0) g_frames = 0; // 0 = no stack walk, _ReturnAddress only
  if (g_frames > kMaxFrames - 1) g_frames = kMaxFrames - 1;
  if (EnvA("WSF_ARGS", tmp, sizeof tmp)) g_logArgs = tmp[0] == '1';
  if (EnvA("WSF_MAXRECS", tmp, sizeof tmp)) {
    LONG64 v = _atoi64(tmp);
    if (v > 0) g_maxRecs = v;
  }

  char exePath[MAX_PATH];
  GetModuleFileNameA(nullptr, exePath, sizeof exePath);
  LogLine("# wsf 1 pid=%lu exe=%s\n", GetCurrentProcessId(), exePath);
  LogLine("# base bun %llx %llx\n", (unsigned long long)g_bunBase,
          (unsigned long long)(g_bunEnd - g_bunBase));
  LogLine("# text bun %llx %llx\n", (unsigned long long)(g_txtBase - g_bunBase),
          (unsigned long long)(g_txtEnd - g_txtBase));
  HMODULE ntdll = GetModuleHandleA("ntdll.dll");
  HMODULE kb = GetModuleHandleA("kernelbase.dll");
  g_ntBase = (uintptr_t)ntdll;
  g_ntEnd = g_ntBase + ImageSize(ntdll);
  g_kbBase = (uintptr_t)kb;
  g_kbEnd = g_kbBase + ImageSize(kb);
  LogLine("# base ntdll %llx\n", (unsigned long long)g_ntBase);
  LogLine("# base kernelbase %llx\n", (unsigned long long)g_kbBase);

  // Module map: every loaded module's base and size, so a driver can name
  // any 'o:'-tagged key or absolute frame offline ("o:7ffc...26b" ->
  // "mswsock+0x1026b"), which is exactly what decides whether a fault
  // fired inside a system DLL's own machinery or on bun's behalf.
  {
    HMODULE mods[256];
    DWORD needed = 0;
    typedef BOOL(WINAPI * EnumFn)(HANDLE, HMODULE*, DWORD, LPDWORD);
    typedef DWORD(WINAPI * NameFn)(HANDLE, HMODULE, LPSTR, DWORD);
    HMODULE kb = GetModuleHandleA("kernelbase.dll");
    HMODULE k32 = GetModuleHandleA("kernel32.dll");
    auto enumFn = (EnumFn)GetProcAddress(kb ? kb : k32, "K32EnumProcessModules");
    if (!enumFn && k32) enumFn = (EnumFn)GetProcAddress(k32, "K32EnumProcessModules");
    auto nameFn = (NameFn)GetProcAddress(kb ? kb : k32, "K32GetModuleBaseNameA");
    if (!nameFn && k32) nameFn = (NameFn)GetProcAddress(k32, "K32GetModuleBaseNameA");
    if (enumFn && nameFn && enumFn(GetCurrentProcess(), mods, sizeof mods, &needed)) {
      DWORD count = needed / sizeof(HMODULE);
      if (count > 256) count = 256;
      for (DWORD i = 0; i < count; i++) {
        char nm[64] = "?";
        nameFn(GetCurrentProcess(), mods[i], nm, sizeof nm);
        LogLine("# mod %llx %llx %s\n", (unsigned long long)(uintptr_t)mods[i],
                (unsigned long long)ImageSize(mods[i]), nm);
      }
    }
  }

  // bun's own directory in NT-path form for the own-file test.
  {
    wchar_t img[MAX_PATH] = L"";
    if (GetModuleFileNameW(nullptr, img, MAX_PATH)) {
      wchar_t nt[MAX_PATH + 8];
      _snwprintf(nt, MAX_PATH + 8, L"\\??\\%s", img);
      wchar_t* slash = wcsrchr(nt, L'\\');
      if (slash) *slash = 0;
      _wcslwr(nt);
      wcsncpy(g_exeDirW, nt, MAX_PATH - 1);
    }
  }

  if (EnvA("WSF_SCHEDULE", tmp, sizeof tmp)) LoadSchedule(tmp);

  SetDepth(Depth() - 1);
  return true;
}

void RuntimeShutdown() {
  SetDepth(Depth() + 1);
  g_ready = false;
  if (g_log != INVALID_HANDLE_VALUE) {
    LogLine("# end seq=%lld\n", (long long)g_seq);
    CloseHandle(g_log);
    g_log = INVALID_HANDLE_VALUE;
  }
  free(g_rules);
  g_rules = nullptr;
  SetDepth(Depth() - 1);
}

// g_ready is flipped by dllmain after AttachHooks commits, so no hook fires
// before init completes or during teardown.
void SetReady(bool r) { g_ready = r; }

} // namespace wsf
