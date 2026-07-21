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
//   WSF_FRAMES=<n>            caller frames captured per call

#include "common.h"
#include "generated/hooks.gen.h"

#include <detours.h>
#include <stdio.h>
#include <string.h>

namespace wsf {

namespace {

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
  LONG rc = DetourTransactionCommit();
  LogNote("# attached %d hooks (commit=%ld)\n", g_attached, rc);
  return rc == NO_ERROR;
}

void DetachHooks() {
  DetourTransactionBegin();
  DetourUpdateThread(GetCurrentThread());
  for (uint32_t i = 0; i < SYS__COUNT; i++) {
    HookEntry& h = kHooks[i];
    if (*h.real) DetourDetach(h.real, h.detour);
  }
  DetourTransactionCommit();
}

} // namespace wsf

// Detours' CreateProcessWithDll requires the injected DLL to export ordinal 1.
extern "C" __declspec(dllexport) void __cdecl WsfExport(void) {}

BOOL WINAPI DllMain(HINSTANCE, DWORD reason, LPVOID) {
  if (DetourIsHelperProcess()) return TRUE;
  switch (reason) {
    case DLL_PROCESS_ATTACH:
      DetourRestoreAfterWith();
      wsf::RuntimeInit();
      if (wsf::AttachHooks()) wsf::SetReady(true);
      break;
    case DLL_PROCESS_DETACH:
      wsf::SetReady(false);
      wsf::DetachHooks();
      wsf::RuntimeShutdown();
      break;
  }
  return TRUE;
}
