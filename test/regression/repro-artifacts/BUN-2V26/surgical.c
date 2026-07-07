// Surgical repro: set a breakpoint at JSC::VM::updateStackLimits, and when
// it fires, soak job commit so only N MB remain, then continue. If the
// hypothesis holds, the inlined preCommitStackMemory loop then raises
// STATUS_STACK_OVERFLOW, which we catch and report.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>

static DWORD64 RVA_UPDATE_STACK_LIMITS = 0x1627440; // bun-profile.exe (baseline) 10814346f

int wmain(int argc, wchar_t** argv) {
    if (argc < 4) {
        fwprintf(stderr, L"usage: surgical <job-limit-mb> <leave-mb> <exe> [args...]\n");
        return 2;
    }
    SIZE_T limitMB = (SIZE_T)wcstoull(argv[1], NULL, 10);
    SIZE_T leaveMB = (SIZE_T)wcstoull(argv[2], NULL, 10);
    wchar_t cmdline[32768] = L"";
    for (int i = 3; i < argc; i++) {
        wcscat_s(cmdline, 32768, L"\"");
        wcscat_s(cmdline, 32768, argv[i]);
        wcscat_s(cmdline, 32768, L"\" ");
    }

    HANDLE job = CreateJobObjectW(NULL, NULL);
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION jeli = {0};
    jeli.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_JOB_MEMORY;
    jeli.JobMemoryLimit = limitMB * 1024 * 1024;
    SetInformationJobObject(job, JobObjectExtendedLimitInformation, &jeli, sizeof(jeli));
    AssignProcessToJobObject(job, GetCurrentProcess());

    STARTUPINFOW si = { sizeof(si) };
    PROCESS_INFORMATION pi;
    if (!CreateProcessW(NULL, cmdline, NULL, NULL, TRUE,
                        DEBUG_ONLY_THIS_PROCESS, NULL, NULL, &si, &pi)) {
        fprintf(stderr, "[surg] CreateProcess failed: %lu\n", GetLastError());
        return 2;
    }

    void* imageBase = NULL;
    void* bpAddr = NULL;
    BYTE origByte = 0;
    int bpHit = 0;
    int soaked = 0;
    void** chunks = NULL;

    DEBUG_EVENT de;
    DWORD childExit = (DWORD)-1;
    for (;;) {
        if (!WaitForDebugEvent(&de, 60000)) { fprintf(stderr, "[surg] debug timeout\n"); break; }
        DWORD cont = DBG_CONTINUE;
        if (de.dwDebugEventCode == CREATE_PROCESS_DEBUG_EVENT) {
            imageBase = de.u.CreateProcessInfo.lpBaseOfImage;
            bpAddr = (char*)imageBase + RVA_UPDATE_STACK_LIMITS;
            // write INT3
            if (!ReadProcessMemory(pi.hProcess, bpAddr, &origByte, 1, NULL)) {
                fprintf(stderr, "[surg] ReadProcessMemory(bp) failed: %lu\n", GetLastError());
            }
            BYTE cc = 0xCC;
            if (!WriteProcessMemory(pi.hProcess, bpAddr, &cc, 1, NULL)) {
                fprintf(stderr, "[surg] WriteProcessMemory(bp) failed: %lu\n", GetLastError());
            }
            FlushInstructionCache(pi.hProcess, bpAddr, 1);
            fprintf(stderr, "[surg] image base 0x%p, bp set at 0x%p (orig=0x%02X)\n", imageBase, bpAddr, origByte);
            if (de.u.CreateProcessInfo.hFile) CloseHandle(de.u.CreateProcessInfo.hFile);
        } else if (de.dwDebugEventCode == EXCEPTION_DEBUG_EVENT) {
            EXCEPTION_RECORD* er = &de.u.Exception.ExceptionRecord;
            if (er->ExceptionCode == EXCEPTION_BREAKPOINT) {
                if (er->ExceptionAddress == bpAddr) {
                    bpHit++;
                    // restore original byte, back up RIP
                    WriteProcessMemory(pi.hProcess, bpAddr, &origByte, 1, NULL);
                    FlushInstructionCache(pi.hProcess, bpAddr, 1);
                    HANDLE hT = OpenThread(THREAD_ALL_ACCESS, FALSE, de.dwThreadId);
                    CONTEXT ctx; ctx.ContextFlags = CONTEXT_CONTROL;
                    GetThreadContext(hT, &ctx);
                    ctx.Rip = (DWORD64)bpAddr;
                    SetThreadContext(hT, &ctx);
                    CloseHandle(hT);
                    if (!soaked) {
                        // NOW soak commit in parent, leaving leaveMB.
                        chunks = (void**)VirtualAlloc(NULL, sizeof(void*) * 4000000, MEM_COMMIT|MEM_RESERVE, PAGE_READWRITE);
                        int n = 0;
                        for (; n < 4000000; n++) {
                            chunks[n] = VirtualAlloc(NULL, 256*1024, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
                            if (!chunks[n]) break;
                        }
                        SIZE_T freeChunks = leaveMB * 4;
                        int freed = 0;
                        for (SIZE_T i = 0; i < freeChunks && n > 0; i++, freed++) {
                            VirtualFree(chunks[--n], 0, MEM_RELEASE);
                        }
                        soaked = 1;
                        fprintf(stderr, "[surg] bp hit #%d @updateStackLimits, soaked leaving %llu MB\n",
                                bpHit, (unsigned long long)leaveMB);
                    }
                    cont = DBG_CONTINUE;
                } else {
                    // initial breakpoint
                    cont = DBG_CONTINUE;
                }
            } else if (er->ExceptionCode == EXCEPTION_STACK_OVERFLOW) {
                HANDLE hT = OpenThread(THREAD_ALL_ACCESS, FALSE, de.dwThreadId);
                CONTEXT ctx; ctx.ContextFlags = CONTEXT_CONTROL;
                GetThreadContext(hT, &ctx);
                fprintf(stderr, "[surg] *** STATUS_STACK_OVERFLOW first-chance=%lu\n", de.u.Exception.dwFirstChance);
                fprintf(stderr, "[surg]     RIP=0x%016llX image-rel=0x%llX\n",
                        (unsigned long long)ctx.Rip,
                        (unsigned long long)((char*)ctx.Rip - (char*)imageBase));
                fprintf(stderr, "[surg]     RSP=0x%016llX fault=0x%016llX\n",
                        (unsigned long long)ctx.Rsp,
                        (unsigned long long)er->ExceptionInformation[1]);
                CloseHandle(hT);
                cont = DBG_EXCEPTION_NOT_HANDLED; // let bun's VEH handle it
            } else {
                cont = DBG_EXCEPTION_NOT_HANDLED;
            }
        } else if (de.dwDebugEventCode == EXIT_PROCESS_DEBUG_EVENT) {
            childExit = de.u.ExitProcess.dwExitCode;
            fprintf(stderr, "[surg] child exit=%lu (0x%lX), bpHit=%d\n", childExit, childExit, bpHit);
            ContinueDebugEvent(de.dwProcessId, de.dwThreadId, DBG_CONTINUE);
            break;
        } else if (de.dwDebugEventCode == LOAD_DLL_DEBUG_EVENT) {
            if (de.u.LoadDll.hFile) CloseHandle(de.u.LoadDll.hFile);
        }
        ContinueDebugEvent(de.dwProcessId, de.dwThreadId, cont);
    }
    CloseHandle(pi.hThread); CloseHandle(pi.hProcess); CloseHandle(job);
    return (int)childExit;
}
