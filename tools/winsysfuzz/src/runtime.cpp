// winsysfuzz runtime: trace log, fault schedule, per-call context.
//
// Trace format (one line per record, written to WSF_LOG_DIR\wsf-<pid>.log):
//   # header lines: pid, image bases, mode
//   X <seq> <tid> <sysid> <status_hex> <bun_rva> <frame0>          normal exit
//   X <seq> <tid> <sysid> <status_hex> <bun_rva> <frame0> !P       pre-fault (real call skipped)
//   X <seq> <tid> <sysid> <status_hex> <bun_rva> <frame0> !Q       post-fault (status substituted)
// bun_rva is the first stack frame inside bun.exe, module-relative (0 if
// none) — the ASLR-stable attribution key the schedule matches against.
//
// Schedule format (WSF_SCHEDULE file), one rule per line:
//   <SyscallName> <bun_rva_hex|*> <hit_index|*> <pre|post> <status_hex>
//   e.g.  NtCreateFile 1a2b3c 3 pre C0000034
// A rule fires when its (syscall, callsite) match count reaches hit_index
// ('*' = every match). This is the enumerable fault coordinate the fuzzer
// sweeps — deterministic given the same JS program.

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

struct Rule {
  uint32_t sys;
  uintptr_t rva; // 0 => wildcard callsite
  bool anyCallsite;
  LONG hitIndex; // 0 => every match
  Fault mode;
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
  AcquireSRWLockExclusive(&g_logLock);
  DWORD w;
  WriteFile(g_log, s, (DWORD)n, &w, nullptr);
  ReleaseSRWLockExclusive(&g_logLock);
}

void LogLine(const char* fmt, ...);

} // namespace

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
    char sysName[80], rvaTok[32], hitTok[16], modeTok[8], statusTok[24];
    if (sscanf_s(line, "%79s %31s %15s %7s %23s", sysName, (unsigned)sizeof sysName, rvaTok,
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
    r.rva = r.anyCallsite ? 0 : (uintptr_t)strtoull(rvaTok, nullptr, 16);
    r.hitIndex = hitTok[0] == '*' ? 0 : (LONG)strtol(hitTok, nullptr, 10);
    r.mode = (modeTok[0] == 'p' || modeTok[0] == 'P') && (modeTok[1] == 'r' || modeTok[1] == 'R')
                 ? Fault::Pre
                 : Fault::Post;
    r.status = (ULONG_PTR)strtoull(statusTok, nullptr, 16);
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
  uintptr_t rva = (retAddr >= g_bunBase && retAddr < g_bunEnd) ? retAddr - g_bunBase : 0;
  LONG64 seq = InterlockedIncrement64(&g_seq);
  LogLine("E %lld %lu %u %llx %llx\n", seq, GetCurrentThreadId(), sysId,
          (unsigned long long)rva, (unsigned long long)retAddr);
  SetDepth(0);
}

// --- CallCtx ---------------------------------------------------------------

CallCtx::CallCtx(uint32_t sysId, uintptr_t retAddr, const ULONG_PTR* args, int argc)
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
  uintptr_t rva = bunFrame_ ? bunFrame_ - g_bunBase : 0;
  for (int i = start; i < g_ruleEnd[sys_]; i++) {
    Rule& r = g_rules[i];
    if (!r.anyCallsite && r.rva != rva) continue;
    LONG hit = InterlockedIncrement(&r.hits);
    if (r.hitIndex != 0 && hit != r.hitIndex) continue;
    fault_ = r.mode;
    injected_ = r.status;
    if (fault_ == Fault::Pre) {
      // Real call is skipped: log the exit record here.
      char rvas[64];
      FormatRvas(rvas, sizeof rvas);
      LONG64 seq = InterlockedIncrement64(&g_seq);
      LogLine("X %lld %lu %u %llx %s %llx !P\n", seq, GetCurrentThreadId(), sys_,
              (unsigned long long)injected_, rvas,
              (unsigned long long)(nframes_ ? frames_[0] : 0));
      return true;
    }
    return false; // post-fault: real call runs, Exit() substitutes
  }
  return false;
}

CallCtx::~CallCtx() { SetDepth(Depth() - 1); }

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
  if (live_) {
    if (fault_ == Fault::Post) ret = injected_;
    char rvas[64];
    FormatRvas(rvas, sizeof rvas);
    LONG64 seq = InterlockedIncrement64(&g_seq);
    LogLine("X %lld %lu %u %llx %s %llx%s\n", seq, GetCurrentThreadId(), sys_,
            (unsigned long long)ret, rvas,
            (unsigned long long)(nframes_ ? frames_[0] : 0), fault_ == Fault::Post ? " !Q" : "");
  }
  return ret;
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

  char exePath[MAX_PATH];
  GetModuleFileNameA(nullptr, exePath, sizeof exePath);
  LogLine("# wsf 1 pid=%lu exe=%s\n", GetCurrentProcessId(), exePath);
  LogLine("# base bun %llx %llx\n", (unsigned long long)g_bunBase,
          (unsigned long long)(g_bunEnd - g_bunBase));
  LogLine("# text bun %llx %llx\n", (unsigned long long)(g_txtBase - g_bunBase),
          (unsigned long long)(g_txtEnd - g_txtBase));
  HMODULE ntdll = GetModuleHandleA("ntdll.dll");
  HMODULE kb = GetModuleHandleA("kernelbase.dll");
  LogLine("# base ntdll %llx\n", (unsigned long long)(uintptr_t)ntdll);
  LogLine("# base kernelbase %llx\n", (unsigned long long)(uintptr_t)kb);

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
