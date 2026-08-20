// Test helper: seccomp-trap <nr>[,<nr>...]|none <program> [args...]
//
// Installs a seccomp filter that answers the listed syscall numbers with
// SECCOMP_RET_TRAP (the process gets SIGSYS, which is what Android's per-app
// policy does for syscalls it does not allow), then execs the program. The
// filter is inherited by every process the program spawns.
//
// Exit codes: 77 when the filter cannot be installed, 2 on bad usage.
//
// The kernel ABI constants are spelled out so this builds with only libc
// headers (no linux-headers package needed).
#define _GNU_SOURCE
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <unistd.h>

#if defined(__x86_64__)
#define MY_AUDIT_ARCH 0xC000003EU
#elif defined(__aarch64__)
#define MY_AUDIT_ARCH 0xC00000B7U
#else
#define MY_AUDIT_ARCH 0U
#endif

#ifndef PR_SET_NO_NEW_PRIVS
#define PR_SET_NO_NEW_PRIVS 38
#endif
#ifndef PR_SET_SECCOMP
#define PR_SET_SECCOMP 22
#endif
#define SECCOMP_MODE_FILTER 2
#define SECCOMP_RET_TRAP 0x00030000U
#define SECCOMP_RET_ALLOW 0x7fff0000U

#define BPF_LD_W_ABS 0x20
#define BPF_JMP_JEQ_K 0x15
#define BPF_RET_K 0x06
#define SECCOMP_DATA_NR 0
#define SECCOMP_DATA_ARCH 4

#define MAX_TRAPPED 32

struct bpf_insn {
    uint16_t code;
    uint8_t jt;
    uint8_t jf;
    uint32_t k;
};

struct bpf_prog {
    unsigned short len;
    struct bpf_insn* filter;
};

static struct bpf_insn stmt(uint16_t code, uint32_t k)
{
    struct bpf_insn insn = { code, 0, 0, k };
    return insn;
}

static struct bpf_insn jeq(uint32_t k, uint8_t jt)
{
    struct bpf_insn insn = { BPF_JMP_JEQ_K, jt, 0, k };
    return insn;
}

int main(int argc, char** argv)
{
    if (argc < 3) return 2;
    if (MY_AUDIT_ARCH == 0) return 77;

    // Some runs below die from SIGSYS on purpose. Do not write core files.
    struct rlimit no_core = { 0, 0 };
    setrlimit(RLIMIT_CORE, &no_core);

    uint32_t trapped[MAX_TRAPPED];
    unsigned count = 0;
    if (strcmp(argv[1], "none") != 0) {
        for (char* tok = strtok(argv[1], ","); tok != NULL; tok = strtok(NULL, ",")) {
            if (count == MAX_TRAPPED) return 2;
            // A token that does not parse must not silently become syscall 0 (read).
            char* end = NULL;
            unsigned long nr = strtoul(tok, &end, 10);
            if (end == tok || *end != '\0' || nr > UINT32_MAX) {
                fprintf(stderr, "seccomp-trap: bad syscall number '%s'\n", tok);
                return 2;
            }
            trapped[count++] = (uint32_t)nr;
        }
    }

    // Layout: arch check (3), load nr (1), one compare per trapped syscall,
    // ALLOW, TRAP. Each compare jumps over the remaining compares and the
    // ALLOW straight to the TRAP.
    struct bpf_insn insns[3 + 1 + MAX_TRAPPED + 2];
    unsigned n = 0;
    insns[n++] = stmt(BPF_LD_W_ABS, SECCOMP_DATA_ARCH);
    insns[n++] = jeq(MY_AUDIT_ARCH, 1);
    insns[n++] = stmt(BPF_RET_K, SECCOMP_RET_ALLOW);
    insns[n++] = stmt(BPF_LD_W_ABS, SECCOMP_DATA_NR);
    for (unsigned i = 0; i < count; i++) {
        insns[n++] = jeq(trapped[i], (uint8_t)(count - i));
    }
    insns[n++] = stmt(BPF_RET_K, SECCOMP_RET_ALLOW);
    insns[n++] = stmt(BPF_RET_K, SECCOMP_RET_TRAP);

    struct bpf_prog prog = { (unsigned short)n, insns };
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
        perror("prctl(PR_SET_NO_NEW_PRIVS)");
        return 77;
    }
    if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog) != 0) {
        perror("prctl(PR_SET_SECCOMP)");
        return 77;
    }

    execvp(argv[2], &argv[2]);
    perror("execvp");
    return 127;
}
