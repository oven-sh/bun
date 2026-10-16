// steps <output prefix> <thread id>
//
// Every instruction that one thread of a running process executes, exactly, from the moment this tool attaches until it is told to stop.
// SIGUSR2 writes a zero into the trace (the border of a window). SIGTERM ends the trace: the thread is let go and runs on.
// Output: <prefix>.ips (one 64-bit instruction pointer a step; a zero a border), <prefix>.maps, <prefix>.perfmap,
// <prefix>.pages (every page a step ran in, as 64-bit address and 4096 bytes), and <prefix>.entries: a line for every step that comes
// into the stubs of compiled code from outside them: the number of the step, where it came from, where it went, and what rax, rsi, rdx and rcx hold.
// <prefix>.ready appears when stepping has begun. Linux x86-64.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ptrace.h>
#include <sys/user.h>
#include <sys/wait.h>
#include <unistd.h>

static pid_t thread;
static volatile sig_atomic_t wantsBorder, wantsEnd;
static int memory = -1;

enum { pageTableSize = 1 << 18 };
static uint64_t pageTable[pageTableSize];

static void notePage(uint64_t page)
{
    for (size_t i = (page >> 12) * 0x9e3779b97f4a7c15ull >> 46;; i = (i + 1) & (pageTableSize - 1)) {
        if (pageTable[i] == page)
            return;
        if (!pageTable[i]) {
            pageTable[i] = page;
            return;
        }
    }
}

enum { maxRanges = 64 };
static uint64_t ranges[maxRanges][2];
static unsigned numberOfRanges;

static int isInStubs(uint64_t ip)
{
    for (unsigned i = 0; i < numberOfRanges; ++i) {
        if (ip >= ranges[i][0] && ip < ranges[i][1])
            return 1;
    }
    return 0;
}

static void onBorder(int signal) { (void)signal; wantsBorder = 1; }
static void onEnd(int signal) { (void)signal; wantsEnd = 1; }

static int peek(uint64_t address, void* into, size_t size) { return pread(memory, into, size, address) == (ssize_t)size; }

static void describe(FILE* out, uint64_t value)
{
    if (value >= 0xfffe000000000000ull) {
        fprintf(out, "\ti%d", (int32_t)value);
        return;
    }
    if (value & 0xfffe000000000000ull) {
        fprintf(out, "\tdouble");
        return;
    }
    if (value & 2 || value < 0x10000) {
        fprintf(out, "\tv%#llx", (unsigned long long)value);
        return;
    }
    uint64_t cell[2];
    if ((value & 7) || !peek(value, cell, sizeof cell)) {
        fprintf(out, "\t?");
        return;
    }
    unsigned type = cell[0] >> 40 & 0xff;
    if (type != 2 && type != 4) {
        fprintf(out, "\tc%u:%x:%x", type, (unsigned)cell[0], (unsigned)(cell[0] >> 32 & 0xff));
        return;
    }
    if (type == 2 && (cell[1] & 1)) {
        fprintf(out, "\trope");
        return;
    }
    struct { uint32_t references, length; uint64_t data; uint32_t flags; } impl;
    if (!peek(cell[1], &impl, 20)) {
        fprintf(out, "\t?");
        return;
    }
    unsigned char characters[48];
    unsigned length = impl.length < 24 ? impl.length : 24;
    int is8Bit = impl.flags & 4;
    if (!peek(impl.data, characters, is8Bit ? length : length * 2)) {
        fprintf(out, "\t?");
        return;
    }
    fprintf(out, "\t%s%s%u:", type == 2 ? "s" : "y", impl.flags & 16 ? "a" : "", impl.length);
    for (unsigned i = 0; i < length; ++i) {
        unsigned char c = characters[is8Bit ? i : i * 2];
        fputc(c >= 33 && c < 127 ? c : '_', out);
    }
}

int main(int argc, char** argv)
{
    if (argc != 3) {
        fprintf(stderr, "usage: steps <output prefix> <thread id>\n");
        return 2;
    }
    const char* prefix = argv[1];
    thread = atoi(argv[2]);
    struct sigaction action;
    memset(&action, 0, sizeof action);
    action.sa_handler = onBorder;
    sigaction(SIGUSR2, &action, 0);
    action.sa_handler = onEnd;
    sigaction(SIGTERM, &action, 0);

    char name[4096];
    snprintf(name, sizeof name, "/tmp/perf-%d.map", thread);
    FILE* map = fopen(name, "r");
    if (map) {
        char line[4096];
        while (fgets(line, sizeof line, map)) {
            unsigned long long start, size;
            int at = 0;
            if (sscanf(line, "%llx %llx %n", &start, &size, &at) < 2)
                continue;
            if (strncmp(line + at, "stub ", 5) && strncmp(line + at, "(stubs of compiled code)", 24))
                continue;
            if (numberOfRanges && ranges[numberOfRanges - 1][1] == start)
                ranges[numberOfRanges - 1][1] = start + size;
            else if (numberOfRanges < maxRanges) {
                ranges[numberOfRanges][0] = start;
                ranges[numberOfRanges++][1] = start + size;
            }
        }
        fclose(map);
    }
    for (unsigned i = 0; i < numberOfRanges; ++i)
        fprintf(stderr, "steps: stubs lie at %#llx .. %#llx\n", (unsigned long long)ranges[i][0], (unsigned long long)ranges[i][1]);

    snprintf(name, sizeof name, "/proc/%d/mem", thread);
    memory = open(name, O_RDONLY);
    snprintf(name, sizeof name, "%s.ips", prefix);
    FILE* out = fopen(name, "wb");
    snprintf(name, sizeof name, "%s.entries", prefix);
    FILE* entries = fopen(name, "w");
    if (memory < 0 || !out || !entries) {
        perror("steps: files");
        return 1;
    }
    if (ptrace(PTRACE_SEIZE, thread, 0, 0) || ptrace(PTRACE_INTERRUPT, thread, 0, 0)) {
        perror("steps: PTRACE_SEIZE");
        return 1;
    }
    int status;
    while (waitpid(thread, &status, __WALL) != thread) {
        if (errno != EINTR) {
            perror("steps: waitpid");
            return 1;
        }
    }
    snprintf(name, sizeof name, "%s.ready", prefix);
    fclose(fopen(name, "w"));

    uint64_t steps = 0, last = 0, lastStackPointer = 0;
    long pending = 0;
    while (!wantsEnd) {
        if (ptrace(PTRACE_SINGLESTEP, thread, 0, pending)) {
            perror("steps: PTRACE_SINGLESTEP");
            break;
        }
        pending = 0;
        int gone = 0;
        while (waitpid(thread, &status, __WALL) != thread) {
            if (errno != EINTR) {
                gone = 1;
                break;
            }
            if (wantsEnd)
                ptrace(PTRACE_INTERRUPT, thread, 0, 0);
        }
        if (gone || WIFEXITED(status) || WIFSIGNALED(status)) {
            fprintf(stderr, "steps: the thread ended\n");
            break;
        }
        if (wantsBorder) {
            wantsBorder = 0;
            uint64_t zero = 0;
            fwrite(&zero, sizeof zero, 1, out);
            last = 0;
        }
        if (status >> 16 == PTRACE_EVENT_STOP)
            continue;
        if (WSTOPSIG(status) != SIGTRAP) {
            pending = WSTOPSIG(status);
            continue;
        }
        struct user_regs_struct registers;
        ptrace(PTRACE_GETREGS, thread, 0, &registers);
        uint64_t ip = registers.rip;
        fwrite(&ip, sizeof ip, 1, out);
        notePage(ip & ~4095ull);
        notePage((ip & ~4095ull) + 4096);
        if (isInStubs(ip) && (!isInStubs(last) || (registers.rsp + 8 == lastStackPointer && !(ip > last && ip <= last + 15)))) {
            fprintf(entries, "%llu\t%llx\t%llx", (unsigned long long)steps, (unsigned long long)last, (unsigned long long)ip);
            describe(entries, registers.rax);
            describe(entries, registers.rsi);
            describe(entries, registers.rdx);
            describe(entries, registers.rcx);
            fputc('\n', entries);
        }
        last = ip;
        lastStackPointer = registers.rsp;
        ++steps;
    }
    fclose(out);
    fclose(entries);

    char command[8192];
    snprintf(command, sizeof command, "cp /proc/%d/maps %s.maps; cp /tmp/perf-%d.map %s.perfmap", thread, prefix, thread, prefix);
    if (system(command)) { }
    snprintf(name, sizeof name, "%s.pages", prefix);
    FILE* pages = fopen(name, "wb");
    for (size_t i = 0; i < pageTableSize; ++i) {
        uint64_t page = pageTable[i];
        char bytes[4096];
        if (!page || !peek(page, bytes, sizeof bytes))
            continue;
        fwrite(&page, sizeof page, 1, pages);
        fwrite(bytes, 1, sizeof bytes, pages);
    }
    fclose(pages);
    ptrace(PTRACE_DETACH, thread, 0, 0);
    fprintf(stderr, "steps: %llu steps\n", (unsigned long long)steps);
    return 0;
}
