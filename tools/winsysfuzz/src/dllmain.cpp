// winsysfuzz interceptor DLL entry: attaches a Detours hook to every ntdll
// Nt* export in the generated table. Injected into the target (bun.exe) by
// wsfrun.exe, which is what lets one layer see syscalls from every module —
// libuv, WebKit, boringssl, mimalloc, and bun's own Rust alike, since they
// all funnel through the same ntdll stubs.
//
// Env knobs:
//   WSF_MODE=trace|inject|off   default trace ('inject' just means a schedule is honored)
//   WSF_LOG_DIR=<dir>          where wsf-<pid>.log goes (default cwd)
//   WSF_SCHEDULE=<file>        fault schedule (see runtime.cpp)
//   WSF_ONLY=NtA,NtB,...       hook only these
//   WSF_EXCLUDE=NtA,NtB,...    hook everything except these
//   WSF_FRAMES=<n>            stack-scrape depth for callsite (x32 qwords; 0 = _ReturnAddress only)

#include "common.h"
#include "generated/hooks.gen.h"

#include <detours.h>
#include <stdio.h>
#include <string.h>

namespace wsf {

namespace {

// --- recursive injection into bun children --------------------------------------
// bun spawns bun (test harness, subprocess tests, workers-as-processes). We
// hook CreateProcessW; when the child image is bun, create it suspended,
// inject this DLL, and resume - so children are traced and honor the same
// fault schedule (they inherit WSF_* through the environment). Any other
// program (cmd, findstr, git, ...) is created untouched.
HMODULE g_self = nullptr;   // this DLL
char g_selfPathA[MAX_PATH];  // its path, handed to the child
char g_exeBase[MAX_PATH];    // lowercase basename of the process we're in
bool g_injectChildren = true;

decltype(&::CreateProcessW) Real_CreateProcessW = ::CreateProcessW;

// Lowercase basename of the image a CreateProcess call will execute.
// lpApplicationName wins when present; otherwise the first token of the
// command line (quotes respected).
bool ChildImageBase(LPCWSTR app, LPCWSTR cmd, char* out, size_t cap) {
  wchar_t buf[MAX_PATH];
  buf[0] = 0;
  if (app && *app) {
    lstrcpynW(buf, app, MAX_PATH);
  } else if (cmd && *cmd) {
    size_t o = 0;
    LPCWSTR p = cmd;
    while (*p == L' ') p++;
    if (*p == L'"') {
      p++;
      while (*p && *p != L'"' && o < MAX_PATH - 1) buf[o++] = *p++;
    } else {
      while (*p && *p != L' ' && o < MAX_PATH - 1) buf[o++] = *p++;
    }
    buf[o] = 0;
  } else {
    return false;
  }
  // basename
  wchar_t* base = buf;
  for (wchar_t* q = buf; *q; q++) if (*q == L'\\' || *q == L'/') base = q + 1;
  size_t i = 0;
  for (; base[i] && i < cap - 1; i++) {
    wchar_t c = base[i];
    out[i] = (char)((c >= L'A' && c <= L'Z') ? (c - L'A' + L'a') : c);
  }
  out[i] = 0;
  return i > 0;
}

// Inject into a child only when its image is bun: our own image name (the
// harness's bunExe() spawns the same binary) or any bun*.exe.
bool IsBunImage(const char* base) {
  if (strcmp(base, g_exeBase) == 0) return true;
  size_t n = strlen(base);
  bool exe = n > 4 && strcmp(base + n - 4, ".exe") == 0;
  return strncmp(base, "bun", 3) == 0 && (exe || n == 3);
}

BOOL WINAPI Hook_CreateProcessW(LPCWSTR app, LPWSTR cmd, LPSECURITY_ATTRIBUTES pa,
                                LPSECURITY_ATTRIBUTES ta, BOOL inherit, DWORD flags,
                                LPVOID env, LPCWSTR cwd, LPSTARTUPINFOW si,
                                LPPROCESS_INFORMATION pi) {
  char base[MAX_PATH];
  bool inject = g_injectChildren && ChildImageBase(app, cmd, base, sizeof base) && IsBunImage(base);
  DWORD f = inject ? (flags | CREATE_SUSPENDED) : flags;
  BOOL ok = Real_CreateProcessW(app, cmd, pa, ta, inherit, f, env, cwd, si, pi);
  if (!ok || !inject) return ok;
  // Injection housekeeping is invisible: its syscalls (writing the child's
  // import table, resuming its thread) must not enter bun's trace or fault.
  DepthPush();
  LPCSTR dlls[] = {g_selfPathA};
  BOOL injected = DetourUpdateProcessWithDll(pi->hProcess, dlls, 1);
  // The caller didn't ask for suspension; we added it, so we resume it.
  if (!(flags & CREATE_SUSPENDED)) ResumeThread(pi->hThread);
  DepthPop();
  LogNote("# child bun pid=%lu image=%s injected=%d\n", pi->dwProcessId, base, (int)injected);
  return ok;
}

bool ListHas(const char* csv, const char* name) {
  if (!csv || !*csv) return false;
  size_t n = strlen(name);
  for (const char* p = csv; *p;) {
    const char* e = strchr(p, ',');
    size_t len = e ? (size_t)(e - p) : strlen(p);
    if (len == n && memcmp(p, name, n) == 0) return true;
    if (!e) break;
    p = e + 1;
  }
  return false;
}

int g_attached = 0;

} // namespace

bool AttachHooks() {
  char mode[16] = "";
  GetEnvironmentVariableA("WSF_MODE", mode, sizeof mode);
  if (mode[0] && strcmp(mode, "off") == 0) return true;

  static char only[4096], exclude[4096];
  only[0] = exclude[0] = 0;
  GetEnvironmentVariableA("WSF_ONLY", only, sizeof only);
  GetEnvironmentVariableA("WSF_EXCLUDE", exclude, sizeof exclude);

  HMODULE ntdll = GetModuleHandleA("ntdll.dll");
  if (!ntdll) return false;

  // Recursive-injection prerequisites: our own DLL path (handed to bun
  // children) and the current image's basename (children of the same image
  // are always injected). WSF_INJECT_CHILDREN=0 disables.
  GetModuleFileNameA(g_self, g_selfPathA, sizeof g_selfPathA);
  char exePath[MAX_PATH];
  GetModuleFileNameA(nullptr, exePath, sizeof exePath);
  const char* base = strrchr(exePath, '\\');
  base = base ? base + 1 : exePath;
  size_t bi = 0;
  for (; base[bi] && bi < sizeof g_exeBase - 1; bi++) {
    char c = base[bi];
    g_exeBase[bi] = (char)((c >= 'A' && c <= 'Z') ? (c - 'A' + 'a') : c);
  }
  g_exeBase[bi] = 0;
  char ic[8] = "1";
  GetEnvironmentVariableA("WSF_INJECT_CHILDREN", ic, sizeof ic);
  g_injectChildren = ic[0] != '0';

  DetourTransactionBegin();
  DetourUpdateThread(GetCurrentThread());
  for (uint32_t i = 0; i < SYS__COUNT; i++) {
    HookEntry& h = kHooks[i];
    if (only[0] && !ListHas(only, h.name)) continue;
    if (ListHas(exclude, h.name)) continue;
    void* fp = (void*)GetProcAddress(ntdll, h.name);
    if (!fp) continue; // not exported on this Windows build
    *h.real = fp;
    if (DetourAttach(h.real, h.detour) == NO_ERROR) g_attached++;
    else *h.real = nullptr;
  }
  // Process creation hook for recursive injection into bun children.
  DetourAttach(&(PVOID&)Real_CreateProcessW, (PVOID)Hook_CreateProcessW);
  LONG rc = DetourTransactionCommit();
  LogNote("# attached %d hooks (commit=%ld) inject-children=%d\n", g_attached, rc,
          (int)g_injectChildren);
  return rc == NO_ERROR;
}

void DetachHooks() {
  DetourTransactionBegin();
  DetourUpdateThread(GetCurrentThread());
  for (uint32_t i = 0; i < SYS__COUNT; i++) {
    HookEntry& h = kHooks[i];
    if (*h.real) DetourDetach(h.real, h.detour);
  }
  DetourDetach(&(PVOID&)Real_CreateProcessW, (PVOID)Hook_CreateProcessW);
  DetourTransactionCommit();
}

} // namespace wsf

// Detours' CreateProcessWithDll requires the injected DLL to export ordinal 1.
extern "C" __declspec(dllexport) void __cdecl WsfExport(void) {}

BOOL WINAPI DllMain(HINSTANCE hinst, DWORD reason, LPVOID) {
  if (DetourIsHelperProcess()) return TRUE;
  switch (reason) {
    case DLL_PROCESS_ATTACH:
      wsf::g_self = hinst;
      DetourRestoreAfterWith();
      if (wsf::RuntimeInit() && wsf::AttachHooks()) wsf::SetReady(true);
      break;
    case DLL_PROCESS_DETACH:
      wsf::SetReady(false);
      wsf::DetachHooks();
      wsf::RuntimeShutdown();
      break;
  }
  return TRUE;
}
