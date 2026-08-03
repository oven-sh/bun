// IAT hooks for AssignProcessToJobObject and ResumeThread so tests can
// exercise uv_spawn's post-CreateProcessW failure cleanup (done_created).
//
// libuv is statically linked into bun.exe, so its kernel32 calls resolve via
// the exe's import address table; patching that table redirects the calls
// made from src/win/process.c.

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <string.h>

static BOOL (WINAPI *orig_AssignProcessToJobObject)(HANDLE, HANDLE) = NULL;
static DWORD (WINAPI *orig_ResumeThread)(HANDLE) = NULL;

static int fail_job = 0;
static int fail_resume = 0;
static LONG job_fail_count = 0;
static LONG resume_fail_count = 0;

static BOOL WINAPI hook_AssignProcessToJobObject(HANDLE job, HANDLE process) {
  if (fail_job) {
    InterlockedIncrement(&job_fail_count);
    SetLastError(ERROR_INVALID_HANDLE);
    return FALSE;
  }
  return orig_AssignProcessToJobObject(job, process);
}

static DWORD WINAPI hook_ResumeThread(HANDLE thread) {
  if (fail_resume) {
    InterlockedIncrement(&resume_fail_count);
    SetLastError(ERROR_INVALID_HANDLE);
    return (DWORD)-1;
  }
  return orig_ResumeThread(thread);
}

// Patch every IAT slot in the exe whose import-by-name entry matches `name`.
// Matching by name (via OriginalFirstThunk) avoids guessing whether the
// loader resolved the slot to kernel32 or kernelbase.
static void* patch_iat_by_name(const char* name, void* replacement) {
  HMODULE mod = GetModuleHandleW(NULL);
  BYTE* base = (BYTE*)mod;
  IMAGE_DOS_HEADER* dos = (IMAGE_DOS_HEADER*)base;
  IMAGE_NT_HEADERS* nt = (IMAGE_NT_HEADERS*)(base + dos->e_lfanew);
  IMAGE_DATA_DIRECTORY* dir =
      &nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT];
  if (dir->VirtualAddress == 0) return NULL;
  IMAGE_IMPORT_DESCRIPTOR* imp =
      (IMAGE_IMPORT_DESCRIPTOR*)(base + dir->VirtualAddress);

  void* prev = NULL;
  for (; imp->Name != 0; imp++) {
    if (imp->OriginalFirstThunk == 0) continue;
    IMAGE_THUNK_DATA* oft = (IMAGE_THUNK_DATA*)(base + imp->OriginalFirstThunk);
    IMAGE_THUNK_DATA* ft  = (IMAGE_THUNK_DATA*)(base + imp->FirstThunk);
    for (; oft->u1.AddressOfData != 0; oft++, ft++) {
      if (IMAGE_SNAP_BY_ORDINAL(oft->u1.Ordinal)) continue;
      IMAGE_IMPORT_BY_NAME* ibn =
          (IMAGE_IMPORT_BY_NAME*)(base + oft->u1.AddressOfData);
      if (strcmp((const char*)ibn->Name, name) != 0) continue;
      DWORD old;
      VirtualProtect(&ft->u1.Function, sizeof(void*), PAGE_READWRITE, &old);
      if (!prev) prev = (void*)ft->u1.Function;
      ft->u1.Function = (ULONG_PTR)replacement;
      VirtualProtect(&ft->u1.Function, sizeof(void*), old, &old);
    }
  }
  return prev;
}

__declspec(dllexport) int install_hooks(void) {
  void* pa = patch_iat_by_name("AssignProcessToJobObject",
                               (void*)hook_AssignProcessToJobObject);
  void* pr = patch_iat_by_name("ResumeThread", (void*)hook_ResumeThread);
  if (pa) orig_AssignProcessToJobObject = (BOOL (WINAPI*)(HANDLE,HANDLE))pa;
  if (pr) orig_ResumeThread = (DWORD (WINAPI*)(HANDLE))pr;
  return (pa ? 1 : 0) | (pr ? 2 : 0);
}

__declspec(dllexport) void set_fail_job(int v) { fail_job = v; }
__declspec(dllexport) void set_fail_resume(int v) { fail_resume = v; }
__declspec(dllexport) int get_job_fail_count(void) { return (int)job_fail_count; }
__declspec(dllexport) int get_resume_fail_count(void) { return (int)resume_fail_count; }

__declspec(dllexport) unsigned int handle_count(void) {
  DWORD n = 0;
  GetProcessHandleCount(GetCurrentProcess(), &n);
  return n;
}
