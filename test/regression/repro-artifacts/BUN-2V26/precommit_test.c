// Confirm mechanism: inside a process, allocate commit until N MB remain,
// then walk the stack downward page-by-page (like JSC::preCommitStackMemory).
// If touching a guard page fails to commit (because job/system commit is
// exhausted), Windows raises STATUS_STACK_OVERFLOW.
//
// Link with /STACK:0x1200000,0x200000 to match bun.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>

static LONG WINAPI veh(PEXCEPTION_POINTERS ep) {
    DWORD code = ep->ExceptionRecord->ExceptionCode;
    if (code == EXCEPTION_STACK_OVERFLOW) {
        // Can't safely printf from here with overflowed stack; write to stderr directly.
        const char* msg = "STACK_OVERFLOW_HIT\n";
        DWORD w;
        WriteFile(GetStdHandle(STD_ERROR_HANDLE), msg, (DWORD)strlen(msg), &w, NULL);
        char buf[64];
        int n = sprintf_s(buf, sizeof(buf), "RIP=0x%p FAULT=0x%p\n",
                          (void*)ep->ContextRecord->Rip,
                          (void*)ep->ExceptionRecord->ExceptionInformation[1]);
        WriteFile(GetStdHandle(STD_ERROR_HANDLE), buf, (DWORD)n, &w, NULL);
        ExitProcess(42);
    }
    return EXCEPTION_CONTINUE_SEARCH;
}

int wmain(int argc, wchar_t** argv) {
    AddVectoredExceptionHandler(1, veh);
    SIZE_T leaveMB = (argc >= 2) ? (SIZE_T)wcstoull(argv[1], NULL, 10) : 9999999;

    ULONG_PTR lo = 0, hi = 0;
    GetCurrentThreadStackLimits(&lo, &hi);
    printf("stack: hi=0x%p lo=0x%p size=%llu KB\n", (void*)hi, (void*)lo,
           (unsigned long long)((hi - lo) / 1024));

    // Soak commit: allocate 1MB chunks until VirtualAlloc fails, then free `leaveMB` chunks.
    void* chunks[100000];
    int n = 0;
    for (; n < 100000; n++) {
        chunks[n] = VirtualAlloc(NULL, 1024*1024, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
        if (!chunks[n]) break;
    }
    printf("soaked %d MB of commit; freeing back %llu MB\n", n, (unsigned long long)leaveMB);
    for (SIZE_T i = 0; i < leaveMB && n > 0; i++) {
        VirtualFree(chunks[--n], 0, MEM_RELEASE);
    }
    fflush(stdout);

    // Now do preCommitStackMemory-style walk: from current SP down to lo+128K.
    volatile char* stackLimit = (volatile char*)(lo + 128 * 1024);
    volatile char* p = (volatile char*)&stackLimit;
    printf("walking from 0x%p down to 0x%p (%llu KB)\n",
           (void*)p, (void*)stackLimit, (unsigned long long)((char*)p - (char*)stackLimit) / 1024);
    fflush(stdout);
    int pages = 0;
    for (; p > stackLimit; p -= 4096) {
        char ch = *p;
        *p = ch;
        pages++;
    }
    printf("walk complete: touched %d pages, no overflow\n", pages);
    return 0;
}
