// For ./stubs_by_request.py. Linux x64 only.
//
//   count_sites <pid> <sites file>
//
// A line of the file is "<address> <target or 0>", both hexadecimal. Each address gets a breakpoint. Counts how often the instruction there runs and, with a target,
// how often it goes on at the target. Only the first thread of the process is traced: it runs the JavaScript. Ends at SIGINT and prints, for each address that ran,
// "<address> <runs> <times it went to the target> <its place in the order of first runs> <the registers in front of the first run that went to the target>".
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/ptrace.h>
#include <sys/user.h>
#include <sys/wait.h>
#include <unistd.h>

struct Site { uint64_t address, target, runs, taken, first; uint8_t original; struct user_regs_struct registers; };
static volatile sig_atomic_t mustStop;
static void onSignal(int signal) { (void)signal; mustStop = 1; }
static int compare(const void* a, const void* b)
{
    uint64_t x = ((const struct Site*)a)->address, y = ((const struct Site*)b)->address;
    return x < y ? -1 : x > y;
}

int main(int argc, char** argv)
{
    if (argc != 3) return 2;
    pid_t pid = atoi(argv[1]);
    FILE* file = fopen(argv[2], "r");
    size_t count = 0, room = 1024;
    struct Site* sites = calloc(room, sizeof(struct Site));
    unsigned long address, target;
    while (fscanf(file, "%lx %lx", &address, &target) == 2) {
        if (count == room) { sites = realloc(sites, (room *= 2) * sizeof(struct Site)); }
        sites[count] = (struct Site) { .address = address, .target = target };
        ++count;
    }
    qsort(sites, count, sizeof(struct Site), compare);

    int status;
    if (ptrace(PTRACE_ATTACH, pid, 0, 0)) { perror("attach"); return 1; }
    waitpid(pid, &status, __WALL);
    char path[64];
    snprintf(path, sizeof path, "/proc/%d/mem", pid);
    int memory = open(path, O_RDWR);
    const uint8_t trap = 0xcc;
    for (size_t i = 0; i < count; ++i) {
        if (pread(memory, &sites[i].original, 1, sites[i].address) != 1 || pwrite(memory, &trap, 1, sites[i].address) != 1) { perror("patch"); return 1; }
    }
    struct sigaction action = { .sa_handler = onSignal };
    sigaction(SIGINT, &action, 0);
    sigaction(SIGTERM, &action, 0);
    puts("READY");
    fflush(stdout);

    uint64_t order = 0;
    ptrace(PTRACE_CONT, pid, 0, 0);
    while (!mustStop) {
        if (waitpid(pid, &status, __WALL) < 0) { if (errno == EINTR) continue; break; }
        if (!WIFSTOPPED(status)) break;
        int signal = WSTOPSIG(status);
        if (signal == SIGTRAP) {
            struct user_regs_struct registers;
            ptrace(PTRACE_GETREGS, pid, 0, &registers);
            struct Site key = { .address = registers.rip - 1 };
            struct Site* site = bsearch(&key, sites, count, sizeof(struct Site), compare);
            if (site) {
                ++site->runs;
                if (!site->first) site->first = ++order;
                pwrite(memory, &site->original, 1, site->address);
                registers.rip = site->address;
                ptrace(PTRACE_SETREGS, pid, 0, &registers);
                struct user_regs_struct before = registers;
                int pending = 0;
                do {
                    ptrace(PTRACE_SINGLESTEP, pid, 0, pending);
                    waitpid(pid, &status, __WALL);
                    if (!WIFSTOPPED(status)) goto done;
                    pending = WSTOPSIG(status);
                } while (pending != SIGTRAP);
                ptrace(PTRACE_GETREGS, pid, 0, &registers);
                if (site->target && registers.rip == site->target && !site->taken++)
                    site->registers = before;
                pwrite(memory, &trap, 1, site->address);
                ptrace(PTRACE_CONT, pid, 0, 0);
                continue;
            }
        }
        ptrace(PTRACE_CONT, pid, 0, signal == SIGSTOP ? 0 : signal);
    }
done:
    for (size_t i = 0; i < count; ++i) {
        if (!sites[i].runs) continue;
        struct user_regs_struct* r = &sites[i].registers;
        printf("%lx %lu %lu %lu rax=%llx rbx=%llx rcx=%llx rdx=%llx rsi=%llx rdi=%llx r8=%llx r9=%llx r10=%llx r11=%llx r12=%llx r14=%llx r15=%llx\n", sites[i].address, sites[i].runs, sites[i].taken, sites[i].first,
            r->rax, r->rbx, r->rcx, r->rdx, r->rsi, r->rdi, r->r8, r->r9, r->r10, r->r11, r->r12, r->r14, r->r15);
    }
    return 0;
}
