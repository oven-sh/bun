// Stack high-water-mark profiler for release binaries (no PDB, no injection).
//
// Two measurements:
//   committed = StackBase - TEB.StackLimit. This is the deepest page ever
//               committed. For bun this is useless once JSC inits, because
//               preCommitStackMemory force-commits the whole reserve.
//   dirty     = StackBase - (lowest page containing any non-zero byte).
//               Freshly committed stack pages are demand-zero, and
//               preCommitStackMemory's `*p = *p` preserves zero, so a page
//               only goes non-zero when a real frame/local lands on it.
//               This is the actual peak usage, page-granular.
//
// We attach as a debugger, capture each thread's TEB at create, sample on
// thread/process exit, and report both numbers. Main thread flagged.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>

typedef struct {
    DWORD tid; void* teb; int isMain;
    void* base; void* limit;
    SIZE_T peakCommit; SIZE_T peakDirty;
} ThreadRec;
static ThreadRec threads[4096];
static int nThreads = 0;

static ThreadRec* find(DWORD tid) {
    for (int i = 0; i < nThreads; i++) if (threads[i].tid == tid) return &threads[i];
    return NULL;
}

static int pageNonZero(const BYTE* p, SIZE_T n) {
    // Scan in 8-byte words; bail on first non-zero.
    const UINT64* w = (const UINT64*)p;
    for (SIZE_T i = 0; i < n / 8; i++) if (w[i]) return 1;
    return 0;
}

// NT_TIB layout (first fields of TEB): ExceptionList, StackBase, StackLimit, ...
static void snapshot(HANDLE hProc, ThreadRec* t) {
    void* tib[3] = {0};
    SIZE_T rd = 0;
    if (!ReadProcessMemory(hProc, t->teb, tib, sizeof(tib), &rd) || rd != sizeof(tib)) return;
    t->base = tib[1];
    t->limit = tib[2];
    SIZE_T committed = (SIZE_T)((char*)t->base - (char*)t->limit);
    if (committed > t->peakCommit) t->peakCommit = committed;

    // Dirty-scan: read committed stack range [limit, base), find lowest non-zero page.
    // Skip for threads we don't care about (tiny commit) to keep it fast.
    if (committed == 0 || committed > (SIZE_T)256*1024*1024) return;
    static BYTE buf[64*1024];
    char* p = (char*)t->limit;
    char* end = (char*)t->base;
    char* lowestDirty = end;
    while (p < end) {
        SIZE_T chunk = (SIZE_T)(end - p); if (chunk > sizeof(buf)) chunk = sizeof(buf);
        if (!ReadProcessMemory(hProc, p, buf, chunk, &rd) || rd == 0) { p += 4096; continue; }
        // scan each 4K page in the chunk from low to high, stop at first non-zero
        for (SIZE_T off = 0; off < rd; off += 4096) {
            SIZE_T n = rd - off; if (n > 4096) n = 4096;
            if (pageNonZero(buf + off, n)) { lowestDirty = p + off; goto done; }
        }
        p += rd;
    }
done:
    {
        SIZE_T dirty = (SIZE_T)((char*)t->base - lowestDirty);
        if (dirty > t->peakDirty) t->peakDirty = dirty;
    }
}

int wmain(int argc, wchar_t** argv) {
    if (argc < 2) { fwprintf(stderr, L"usage: stackprof <exe> [args...]\n"); return 2; }
    wchar_t cmdline[32768] = L"";
    for (int i = 1; i < argc; i++) {
        wcscat_s(cmdline, 32768, L"\"");
        wcscat_s(cmdline, 32768, argv[i]);
        wcscat_s(cmdline, 32768, L"\" ");
    }
    STARTUPINFOW si = { sizeof(si) };
    PROCESS_INFORMATION pi;
    if (!CreateProcessW(NULL, cmdline, NULL, NULL, TRUE,
                        DEBUG_ONLY_THIS_PROCESS, NULL, NULL, &si, &pi)) {
        fprintf(stderr, "CreateProcess failed: %lu\n", GetLastError());
        return 2;
    }
    DWORD mainTid = pi.dwThreadId;
    DEBUG_EVENT de;
    int alive = 1;
    DWORD exitCode = (DWORD)-1;
    while (alive) {
        if (!WaitForDebugEvent(&de, 500)) {
            // periodic sample while idle
            for (int i = 0; i < nThreads; i++) snapshot(pi.hProcess, &threads[i]);
            continue;
        }
        DWORD cont = DBG_CONTINUE;
        switch (de.dwDebugEventCode) {
        case CREATE_PROCESS_DEBUG_EVENT: {
            ThreadRec* t = &threads[nThreads++];
            t->tid = de.dwThreadId; t->teb = de.u.CreateProcessInfo.lpThreadLocalBase;
            t->isMain = (de.dwThreadId == mainTid); t->peakCommit = 0; t->peakDirty = 0;
            if (de.u.CreateProcessInfo.hFile) CloseHandle(de.u.CreateProcessInfo.hFile);
            break;
        }
        case CREATE_THREAD_DEBUG_EVENT: {
            if (nThreads < 4096) {
                ThreadRec* t = &threads[nThreads++];
                t->tid = de.dwThreadId; t->teb = de.u.CreateThread.lpThreadLocalBase;
                t->isMain = 0; t->peakCommit = 0; t->peakDirty = 0;
            }
            break;
        }
        case EXIT_THREAD_DEBUG_EVENT: {
            ThreadRec* t = find(de.dwThreadId);
            if (t) snapshot(pi.hProcess, t);
            break;
        }
        case EXIT_PROCESS_DEBUG_EVENT: {
            for (int i = 0; i < nThreads; i++) snapshot(pi.hProcess, &threads[i]);
            exitCode = de.u.ExitProcess.dwExitCode;
            alive = 0;
            break;
        }
        case EXCEPTION_DEBUG_EVENT:
            if (de.u.Exception.ExceptionRecord.ExceptionCode == EXCEPTION_BREAKPOINT)
                cont = DBG_CONTINUE;
            else
                cont = DBG_EXCEPTION_NOT_HANDLED;
            break;
        case LOAD_DLL_DEBUG_EVENT:
            if (de.u.LoadDll.hFile) CloseHandle(de.u.LoadDll.hFile);
            break;
        }
        ContinueDebugEvent(de.dwProcessId, de.dwThreadId, cont);
    }
    // Report
    SIZE_T mainCommit = 0, mainDirty = 0, maxDirty = 0; int maxIdx = -1;
    for (int i = 0; i < nThreads; i++) {
        if (threads[i].peakDirty > maxDirty) { maxDirty = threads[i].peakDirty; maxIdx = i; }
        if (threads[i].isMain) { mainCommit = threads[i].peakCommit; mainDirty = threads[i].peakDirty; }
    }
    fprintf(stderr, "[stackprof] exit=%lu threads=%d\n", exitCode, nThreads);
    for (int i = 0; i < nThreads; i++) {
        if (threads[i].peakDirty >= 64*1024 || threads[i].isMain || i == maxIdx) {
            fprintf(stderr, "[stackprof]   tid=%5lu %s dirty=%6llu KB  commit=%6llu KB\n",
                    threads[i].tid,
                    threads[i].isMain ? "MAIN " : (i == maxIdx ? "MAX  " : "     "),
                    (unsigned long long)(threads[i].peakDirty / 1024),
                    (unsigned long long)(threads[i].peakCommit / 1024));
        }
    }
    fprintf(stderr, "MAIN_COMMIT_KB=%llu\n", (unsigned long long)(mainCommit / 1024));
    fprintf(stderr, "MAIN_DIRTY_KB=%llu\n", (unsigned long long)(mainDirty / 1024));
    fprintf(stderr, "MAX_DIRTY_KB=%llu\n", (unsigned long long)(maxDirty / 1024));
    CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
    return (int)exitCode;
}
