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
__declspec(thread) int t_depth = 0;

// --- state ------------------------------------------------------------------
volatile bool g_ready = false;
HANDLE g_log = INVALID_HANDLE_VALUE;
SRWLOCK g_logLock = SRWLOCK_INIT;
volatile LONG64 g_seq = 0;

uintptr_t g_bunBase = 0;
uintptr_t g_bunEnd = 0;

int g_frames = 6; // frames captured per call (WSF_FRAMES)

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

// --- CallCtx ---------------------------------------------------------------

CallCtx::CallCtx(uint32_t sysId, uintptr_t retAddr, const ULONG_PTR* args, int argc)
    : sys_(sysId), args_(args), argc_(argc) {
  live_ = g_ready && t_depth == 0;
  t_depth++;
  nframes_ = 0;
  if (!live_) return;
  frames_[0] = retAddr;
  nframes_ = 1;
  // Walk up past kernelbase/ntdll wrappers to find the bun.exe frame that
  // originated this call — stable attribution across wrapper layers.
  void* stack[kMaxFrames];
  USHORT n = RtlCaptureStackBackTrace(1, (DWORD)g_frames, stack, nullptr);
  for (USHORT k = 0; k < n && nframes_ < kMaxFrames; k++) {
    uintptr_t ip = (uintptr_t)stack[k];
    frames_[nframes_++] = ip;
    if (bunFrame_ == 0 && ip >= g_bunBase && ip < g_bunEnd) bunFrame_ = ip;
  }
  if (bunFrame_ == 0 && retAddr >= g_bunBase && retAddr < g_bunEnd) bunFrame_ = retAddr;
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
      LONG64 seq = InterlockedIncrement64(&g_seq);
      LogLine("X %lld %lu %u %llx %llx %llx !P\n", seq, GetCurrentThreadId(), sys_,
              (unsigned long long)injected_, (unsigned long long)rva,
              (unsigned long long)(nframes_ ? frames_[0] : 0));
      return true;
    }
    return false; // post-fault: real call runs, Exit() substitutes
  }
  return false;
}

CallCtx::~CallCtx() { t_depth--; }

ULONG_PTR CallCtx::Exit(ULONG_PTR real) {
  ULONG_PTR ret = real;
  if (live_) {
    if (fault_ == Fault::Post) ret = injected_;
    uintptr_t rva = bunFrame_ ? bunFrame_ - g_bunBase : 0;
    LONG64 seq = InterlockedIncrement64(&g_seq);
    LogLine("X %lld %lu %u %llx %llx %llx%s\n", seq, GetCurrentThreadId(), sys_,
            (unsigned long long)ret, (unsigned long long)rva,
            (unsigned long long)(nframes_ ? frames_[0] : 0), fault_ == Fault::Post ? " !Q" : "");
  }
  return ret;
}

// --- runtime init ----------------------------------------------------------

bool RuntimeInit() {
  t_depth++; // everything during init passes through, unlogged

  // bun.exe image range for callsite attribution.
  HMODULE exe = GetModuleHandleW(nullptr);
  g_bunBase = (uintptr_t)exe;
  auto* dos = (IMAGE_DOS_HEADER*)exe;
  auto* nt = (IMAGE_NT_HEADERS*)((uintptr_t)exe + dos->e_lfanew);
  g_bunEnd = g_bunBase + nt->OptionalHeader.SizeOfImage;

  char dir[MAX_PATH] = ".";
  EnvA("WSF_LOG_DIR", dir, sizeof dir);
  char path[MAX_PATH];
  snprintf(path, sizeof path, "%s\\wsf-%lu.log", dir, GetCurrentProcessId());
  g_log = CreateFileA(path, FILE_APPEND_DATA, FILE_SHARE_READ, nullptr, CREATE_ALWAYS,
                      FILE_ATTRIBUTE_NORMAL, nullptr);

  char tmp[MAX_PATH];
  if (EnvA("WSF_FRAMES", tmp, sizeof tmp)) g_frames = atoi(tmp);
  if (g_frames < 1) g_frames = 1;
  if (g_frames > kMaxFrames - 1) g_frames = kMaxFrames - 1;

  char exePath[MAX_PATH];
  GetModuleFileNameA(nullptr, exePath, sizeof exePath);
  LogLine("# wsf 1 pid=%lu exe=%s\n", GetCurrentProcessId(), exePath);
  LogLine("# base bun %llx %llx\n", (unsigned long long)g_bunBase,
          (unsigned long long)(g_bunEnd - g_bunBase));
  HMODULE ntdll = GetModuleHandleA("ntdll.dll");
  HMODULE kb = GetModuleHandleA("kernelbase.dll");
  LogLine("# base ntdll %llx\n", (unsigned long long)(uintptr_t)ntdll);
  LogLine("# base kernelbase %llx\n", (unsigned long long)(uintptr_t)kb);

  if (EnvA("WSF_SCHEDULE", tmp, sizeof tmp)) LoadSchedule(tmp);

  t_depth--;
  return true;
}

void RuntimeShutdown() {
  t_depth++;
  g_ready = false;
  if (g_log != INVALID_HANDLE_VALUE) {
    LogLine("# end seq=%lld\n", (long long)g_seq);
    CloseHandle(g_log);
    g_log = INVALID_HANDLE_VALUE;
  }
  free(g_rules);
  g_rules = nullptr;
  t_depth--;
}

// g_ready is flipped by dllmain after AttachHooks commits, so no hook fires
// before init completes or during teardown.
void SetReady(bool r) { g_ready = r; }

} // namespace wsf
