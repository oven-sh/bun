// The Win32 API as <windows.h> declares it, with Microsoft's own headers (Visual Studio's, the Universal C
// Runtime's and the Windows SDK's): kernel32 calls, structures with anonymous unions, 64-bit counters,
// interlocked intrinsics, wide strings, and a file written and read back.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <string.h>

static volatile LONG counter;
static DWORD WINAPI worker(LPVOID parameter) {
  for (int i = 0; i < 1000; i++) InterlockedIncrement(&counter);
  InterlockedExchangeAdd((volatile LONG *)parameter, 5);
  return 7;
}

int main(void) {
  ULONGLONG ticks = GetTickCount64();
  LARGE_INTEGER frequency, before, after;
  printf("counter %d %d\n", QueryPerformanceFrequency(&frequency) != 0 && frequency.QuadPart > 0, QueryPerformanceCounter(&before) != 0);
  printf("process %d thread %d\n", GetCurrentProcessId() != 0, GetCurrentThreadId() != 0);

  char directory[MAX_PATH], path[MAX_PATH];
  DWORD length = GetTempPathA(sizeof directory, directory);
  printf("temp path %d\n", length > 0 && length < sizeof directory);
  snprintf(path, sizeof path, "%sbun-c-%lu-%llu.txt", directory, (unsigned long)GetCurrentProcessId(), (unsigned long long)ticks);
  HANDLE file = CreateFileA(path, GENERIC_READ | GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_TEMPORARY, NULL);
  printf("created %d\n", file != INVALID_HANDLE_VALUE);
  const char text[] = "written through WriteFile\r\n";
  DWORD written = 0, read = 0;
  // (One call to a statement wherever a later argument depends on an earlier one: the order is the compiler's.)
  BOOL ok = WriteFile(file, text, (DWORD)strlen(text), &written, NULL);
  printf("wrote %d %lu\n", ok != 0, (unsigned long)written);
  LARGE_INTEGER size;
  ok = GetFileSizeEx(file, &size);
  printf("size %d %lld\n", ok != 0, (long long)size.QuadPart);
  printf("rewound %lu\n", (unsigned long)SetFilePointer(file, 8, NULL, FILE_BEGIN));
  char back[64] = {0};
  ok = ReadFile(file, back, sizeof back - 1, &read, NULL);
  printf("read %d %lu %.7s\n", ok != 0, (unsigned long)read, back);
  ok = CloseHandle(file);
  printf("closed %d deleted %d\n", ok != 0, DeleteFileA(path) != 0);
  DWORD attributes = GetFileAttributesA(path), error = GetLastError();
  printf("gone %d %lu\n", attributes == INVALID_FILE_ATTRIBUTES, (unsigned long)error);

  LONG shared = 1;
  HANDLE thread = CreateThread(NULL, 0, worker, &shared, 0, NULL);
  DWORD status = 0;
  DWORD waited = WaitForSingleObject(thread, 10000);
  ok = GetExitCodeThread(thread, &status);
  printf("thread %d %lu %d %lu %ld %ld\n", thread != NULL, (unsigned long)waited, ok != 0, (unsigned long)status, (long)counter, (long)shared);
  CloseHandle(thread);

  SYSTEM_INFO info;
  GetSystemInfo(&info);
  printf("page size %d processors %d\n", info.dwPageSize >= 4096, info.dwNumberOfProcessors >= 1);
  wchar_t wide[32];
  int units = MultiByteToWideChar(CP_UTF8, 0, "h\xc3\xa9llo", -1, wide, 32);
  printf("wide %d %x %d\n", units, (unsigned)wide[1], lstrlenW(wide));
  SYSTEMTIME now;
  GetSystemTime(&now);
  FILETIME stamp;
  ULARGE_INTEGER as_integer;
  ok = SystemTimeToFileTime(&now, &stamp);
  as_integer.LowPart = stamp.dwLowDateTime, as_integer.HighPart = stamp.dwHighDateTime;
  printf("time %d %d %d\n", now.wYear >= 2025, ok != 0, as_integer.QuadPart > 0x01d0000000000000ull);
  void *memory = VirtualAlloc(NULL, 1 << 16, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
  memset(memory, 0x5a, 1 << 16);
  MEMORY_BASIC_INFORMATION region;
  SIZE_T queried = VirtualQuery(memory, &region, sizeof region);
  printf("virtual %d %d %d\n", memory != NULL, queried == sizeof region && region.Protect == PAGE_READWRITE, VirtualFree(memory, 0, MEM_RELEASE) != 0);
  QueryPerformanceCounter(&after);
  printf("elapsed %d %d\n", after.QuadPart >= before.QuadPart, GetTickCount64() >= ticks);
  printf("teb %d\n", NtCurrentTeb() != NULL && GetCurrentThreadId() == HandleToULong(((void **)NtCurrentTeb())[9]));
  return 0;
}
