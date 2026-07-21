// wsfrun.exe — runs a target (bun.exe) with winsysfuzz.dll injected.
//
//   wsfrun.exe [--dll <path>] -- <program> [args...]
//
// The DLL is injected at process creation via Detours (import-table
// injection into the suspended child), so hooks are armed before the target's
// entrypoint runs and every syscall from process start is observed. The child
// inherits our environment, which is how WSF_* knobs (mode, log dir,
// schedule) reach the injected runtime. wsfrun waits for the child and exits
// with its code; an NTSTATUS exit (>= 0x80000000) is called out as a crash.

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <detours.h>
#include <stdio.h>
#include <string>
#include <vector>

static std::wstring QuoteArg(const wchar_t* a) {
  std::wstring s(a);
  if (!s.empty() && s.find_first_of(L" \t\"") == std::wstring::npos) return s;
  std::wstring out = L"\"";
  for (size_t i = 0; i < s.size(); i++) {
    if (s[i] == L'"') out += L'\\';
    out += s[i];
  }
  out += L'"';
  return out;
}

int wmain(int argc, wchar_t** argv) {
  std::wstring dll;
  int i = 1;
  for (; i < argc; i++) {
    if (wcscmp(argv[i], L"--dll") == 0 && i + 1 < argc) {
      dll = argv[++i];
    } else if (wcscmp(argv[i], L"--") == 0) {
      i++;
      break;
    } else {
      break;
    }
  }
  if (i >= argc) {
    fprintf(stderr, "usage: wsfrun.exe [--dll <path>] -- <program> [args...]\n");
    return 2;
  }
  if (dll.empty()) {
    // Default: winsysfuzz.dll beside this executable.
    wchar_t self[MAX_PATH];
    GetModuleFileNameW(nullptr, self, MAX_PATH);
    std::wstring dir(self);
    dir.resize(dir.find_last_of(L"\\/") + 1);
    dll = dir + L"winsysfuzz.dll";
  }
  if (GetFileAttributesW(dll.c_str()) == INVALID_FILE_ATTRIBUTES) {
    fwprintf(stderr, L"wsfrun: dll not found: %ls\n", dll.c_str());
    return 2;
  }

  std::wstring cmd;
  for (int k = i; k < argc; k++) {
    if (k > i) cmd += L' ';
    cmd += QuoteArg(argv[k]);
  }

  // Detours takes the DLL path as ANSI.
  char dllA[MAX_PATH];
  WideCharToMultiByte(CP_ACP, 0, dll.c_str(), -1, dllA, MAX_PATH, nullptr, nullptr);

  STARTUPINFOW si = {sizeof si};
  PROCESS_INFORMATION pi = {};
  std::vector<wchar_t> cmdBuf(cmd.begin(), cmd.end());
  cmdBuf.push_back(L'\0');

  if (!DetourCreateProcessWithDllExW(nullptr, cmdBuf.data(), nullptr, nullptr, TRUE,
                                     CREATE_DEFAULT_ERROR_MODE, nullptr, nullptr, &si, &pi, dllA,
                                     nullptr)) {
    fprintf(stderr, "wsfrun: create process failed: %lu\n", GetLastError());
    return 3;
  }

  WaitForSingleObject(pi.hProcess, INFINITE);
  DWORD code = 0;
  GetExitCodeProcess(pi.hProcess, &code);
  CloseHandle(pi.hProcess);
  CloseHandle(pi.hThread);

  if (code >= 0x80000000u)
    fprintf(stderr, "wsfrun: child exited with NTSTATUS 0x%08lX (crash/abort)\n", code);
  return (int)code;
}
