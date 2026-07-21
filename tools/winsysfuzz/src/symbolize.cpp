// wsfsym.exe — resolve module-relative addresses (RVAs) in an image to
// symbol+offset and source line, using DbgHelp against the image's PDB.
//
//   wsfsym.exe <image.exe> <rva-hex> [rva-hex ...]
//   wsfsym.exe <image.exe> -            (RVAs from stdin, one hex per line)
//
// Output: one line per RVA: <rva>\t<symbol+0xdisp>\t<file:line or ->
// This is how a wsf trace's bun_rva callsites get their names: "the fault at
// NtCreateFile came from uv__fs_open" is a symbolized RVA.

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <dbghelp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#pragma comment(lib, "dbghelp.lib")

static const DWORD64 kBase = 0x10000000; // arbitrary load base for the module

static void Resolve(HANDLE proc, DWORD64 rva) {
  DWORD64 addr = kBase + rva;
  char buf[sizeof(SYMBOL_INFO) + MAX_SYM_NAME];
  auto* sym = (SYMBOL_INFO*)buf;
  sym->SizeOfStruct = sizeof(SYMBOL_INFO);
  sym->MaxNameLen = MAX_SYM_NAME;
  DWORD64 disp = 0;
  char symText[MAX_SYM_NAME + 32] = "?";
  if (SymFromAddr(proc, addr, &disp, sym))
    snprintf(symText, sizeof symText, "%s+0x%llx", sym->Name, disp);
  else
    snprintf(symText, sizeof symText, "?(err%lu)", GetLastError());
  IMAGEHLP_LINE64 line = {sizeof(IMAGEHLP_LINE64)};
  DWORD lineDisp = 0;
  if (SymGetLineFromAddr64(proc, addr, &lineDisp, &line))
    printf("%llx\t%s\t%s:%lu\n", rva, symText, line.FileName, line.LineNumber);
  else
    printf("%llx\t%s\t-\n", rva, symText);
}

int main(int argc, char** argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: wsfsym.exe <image.exe> <rva-hex...> | -\n");
    return 2;
  }
  const char* image = argv[1];
  HANDLE proc = GetCurrentProcess();
  // Search the image's own directory for the PDB (cdb does this implicitly;
  // a bare DbgHelp client does not, and deferred loads then never resolve).
  char searchPath[MAX_PATH];
  strncpy_s(searchPath, image, sizeof searchPath - 1);
  char* slash = strrchr(searchPath, '\\');
  if (slash) *slash = '\0';
  SymSetOptions(SYMOPT_UNDNAME | SYMOPT_LOAD_LINES | SYMOPT_EXACT_SYMBOLS);
  if (!SymInitialize(proc, searchPath, FALSE)) {
    fprintf(stderr, "SymInitialize failed: %lu\n", GetLastError());
    return 3;
  }
  DWORD64 base = SymLoadModuleEx(proc, nullptr, image, nullptr, kBase, 0, nullptr, 0);
  if (!base) {
    fprintf(stderr, "SymLoadModuleEx failed for %s: %lu\n", image, GetLastError());
    return 4;
  }
  IMAGEHLP_MODULE64 mi = {sizeof(IMAGEHLP_MODULE64)};
  if (SymGetModuleInfo64(proc, base, &mi))
    fprintf(stderr, "# module base=%llx symtype=%d pdb=%s\n", base, mi.SymType, mi.LoadedPdbName);
  else
    fprintf(stderr, "# SymGetModuleInfo64 failed: %lu\n", GetLastError());
  if (strcmp(argv[2], "-") == 0) {
    char line[64];
    while (fgets(line, sizeof line, stdin)) {
      DWORD64 rva = strtoull(line, nullptr, 16);
      if (rva) Resolve(proc, rva);
    }
  } else {
    for (int i = 2; i < argc; i++) Resolve(proc, strtoull(argv[i], nullptr, 16));
  }
  SymCleanup(proc);
  return 0;
}
