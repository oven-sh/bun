// `#pragma comment(lib, "name")` names a library the program's imports come from besides the ones every program
// has: the loader must find the function there. (shlwapi.dll is in every Windows and in no program by default.)
#include <stdio.h>
#pragma comment(lib, "shlwapi.lib")

__declspec(dllimport) char *__stdcall PathFindExtensionA(const char *path);
__declspec(dllimport) int __stdcall PathIsRelativeA(const char *path);

int main(void) {
  printf("%s %d %d\n", PathFindExtensionA("archive.tar.gz"), PathIsRelativeA("relative\\path") != 0, PathIsRelativeA("C:\\absolute") != 0);
  return 0;
}
