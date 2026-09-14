// What Microsoft C decides while compiling, checked while compiling: the predefined macros, the sized integers and
// their literal suffixes, __declspec(align), the pragmas Visual Studio's headers are full of, and the layout rules
// that differ from everyone else's. If this compiles, it holds.
int printf(const char *, ...);

#if !defined(_MSC_VER) || defined(__GNUC__) || defined(__STDC__) || __STDC_VERSION__ != 201710L
#error not Microsoft C
#endif
#if _MSC_VER != 1944 || _MSC_FULL_VER != 194435207 || !_MSC_EXTENSIONS || _INTEGRAL_MAX_BITS != 64 || _MSVC_TRADITIONAL != 0
#error not the Visual Studio this claims to be
#endif
#if !defined(_WIN32) || !defined(_WIN64) || !defined(_MT) || !defined(_DLL) || !__STDC_HOSTED__
#error not the Windows that is targeted
#endif
#if defined(_M_X64) == defined(_M_ARM64) || (defined(_M_X64) && (_M_X64 != 100 || _M_AMD64 != 100))
#error which machine
#endif
_Static_assert(sizeof(long) == 4 && sizeof(long double) == 8 && sizeof(L'x') == 2 && sizeof(void *) == 8, "LLP64");

// ---- sized integers, conventions, decorations ----
typedef unsigned __int64 u64;
typedef __int64 unsigned also;
typedef signed __int8 s8;
typedef __int16 i16;
typedef unsigned __int32 u32;
typedef __int64 i64;
_Static_assert(sizeof(u64) == 8 && sizeof(also) == 8 && sizeof(s8) == 1 && sizeof(i16) == 2 && sizeof(u32) == 4, "");
_Static_assert((u64)-1 > 0 && (i64)-1 < 0 && (s8)-1 < 0 && (u32)-1 > 0, "");
_Static_assert(sizeof(1i64) == 8 && sizeof(1ui64) == 8 && sizeof(7i32) == 4 && 0xffui8 == 255 && sizeof(1i16) == 4, "");
_Static_assert(18446744073709551615ui64 == (u64)-1 && -9223372036854775807i64 - 1 < 0, "");
int __cdecl plain(int);
int __stdcall standard(int);
int __fastcall fast(int a) { return a; }
typedef int(__stdcall *callback)(void *, int);
typedef int(__cdecl callee)(int);
int(__stdcall *table[3])(int);
int _cdecl _cdecl_too(void);
static int use(callback f, int(__fastcall *g)(int), callee *h) { return f(0, 1) + g(2) + h(3) + _cdecl_too(); }
void *__ptr64 wide;
int *__ptr32 narrow;
char *__sptr sign;
char *__uptr zero;
typedef __w64 unsigned long ulong_ptr;
static int load(__unaligned int *p, const __unaligned short *q) { return *p + *q; }
__forceinline int forced(int x) { return x + 1; }
static __inline int old(int x) { return forced(x); }
static _inline int older(int x) { return old(x); }
static int calls(void) { return older(1) + (int)__alignof(double) + (int)_alignof(short); }

// ---- __declspec ----
__declspec(noreturn) void stop(void);
struct __declspec(align(32)) also_aligned { int x; };
typedef __declspec(align(64)) struct line { char bytes[3]; } line;
__declspec(align(16)) static char buffer[3];
_Static_assert(_Alignof(line) == 64 && sizeof(line) == 64 && _Alignof(struct also_aligned) == 32 && sizeof(struct also_aligned) == 32, "");
__declspec(restrict) __declspec(noalias) void *allocate(unsigned __int64);
__declspec(deprecated("use another")) __declspec(deprecated) int old_way(void);
__declspec(allocator) __declspec(nothrow) __declspec(safebuffers) __declspec(spectre(nomitigation)) void *more(void);
struct __declspec(novtable) __declspec(empty_bases) __declspec(uuid("00000000-0000-0000-c000-000000000046")) object { int x; };
__declspec(code_seg("text2")) __declspec(guard(nocf)) static int placed(void) { return 2; }
_declspec(dllimport) int single_underscore(void);

// ---- pragmas and the __pragma operator ----
#pragma once
#pragma warning(push)
#pragma warning(disable: 4001 4668)
#pragma warning(suppress: 4100)
#pragma intrinsic(_BitScanForward, memcpy)
#pragma function(memset)
#pragma comment(linker, "/merge:.rdata=.text")
#pragma region things
#pragma optimize("", off)
#pragma float_control(precise, on, push)
#pragma fenv_access(off)
#pragma data_seg(".shared")
#pragma section(".mine", read, write)
#pragma detect_mismatch("runtime", "static")
#pragma deprecated(old_name)
#pragma runtime_checks("", off)
#pragma strict_gs_check(push, off)
#pragma message("being compiled")
#pragma managed(push, off)
#pragma something nobody has heard of
#pragma endregion
#define PACKING 2
#define BEGIN __pragma(pack(push, PACKING)) __pragma(warning(disable: 4103))
#define END __pragma(pack(pop))
BEGIN struct two { char c; int i; }; END
struct natural { char c; int i; };
#pragma pack(push, outer, 1)
struct one { char c; int i; };
#pragma pack(pop, outer)
#pragma pack(push, PACKING)
struct again { char c; long long q; };
#pragma pack(pop)
_Static_assert(sizeof(struct two) == 6 && sizeof(struct natural) == 8 && sizeof(struct one) == 5 && sizeof(struct again) == 10, "");
#pragma warning(pop)

// ---- layout ----
typedef struct tagRECT { long left, top, right, bottom; } RECT;
typedef struct tagMONITORINFO { unsigned long cbSize; RECT rcMonitor, rcWork; unsigned long dwFlags; } MONITORINFO;
// A member that is a named type and nothing else: its members are this structure's.
typedef struct tagMONITORINFOEXA { MONITORINFO; char szDevice[32]; } MONITORINFOEXA;
_Static_assert(sizeof(MONITORINFOEXA) == 72 && __builtin_offsetof(MONITORINFOEXA, szDevice) == 40, "");
struct forward;
struct holds { struct forward *p; struct forward; int x; };
_Static_assert(sizeof(struct holds) == 16, "a tag declared, not a member");
// No object has size zero.
struct empty { };
union only_flexible { int a[]; long long b[]; };
struct response { unsigned level, count; union { int a[]; long long b[]; } entries; };
struct __declspec(align(16)) aligned_empty { };
_Static_assert(sizeof(struct empty) == 4 && sizeof(union only_flexible) == 4 && _Alignof(union only_flexible) == 8, "");
_Static_assert(sizeof(struct response) == 16 && sizeof(struct aligned_empty) == 16, "");
// Every enumeration is an int.
enum wide_values { BIG = 0x7fffffff, MORE };
enum small_values { A, B };
_Static_assert(sizeof(enum wide_values) == 4 && sizeof(enum small_values) == 4 && (enum small_values)-1 < 0, "");

// ---- what may be written as long as it is not used ----
static __inline int guarded(int *p) {
  int v = 0;
  __try { v = *p; if (v) __leave; v = 1; } __except (v == 1 ? 1 : 0) { v = -1; }
  __try { v++; } __finally { v += 2; }
  return v;
}
unsigned char _InterlockedCompareExchange128(__int64 volatile *, __int64, __int64, __int64 *);
static __inline int cas(__int64 volatile *p, __int64 *c) { return _InterlockedCompareExchange128(p, 1, 2, c); }

int main(void) {
  int word = 5;
  short half = 2;
  printf("%d %d %d %d\n", fast(1), load(&word, &half), calls(), placed() + (int)sizeof buffer);
  return 0;
}
