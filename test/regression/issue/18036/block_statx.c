/*
 * Block the statx syscall using seccomp BPF, then exec the given command.
 * This simulates running on a Linux kernel < 4.11 (e.g. Synology NAS kernel 4.4)
 * where statx is not implemented and returns ENOSYS.
 *
 * Usage: ./block_statx <command> [args...]
 */
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

#if !defined(__NR_statx)
#  if defined(SYS_statx)
#    define __NR_statx SYS_statx
#  elif defined(__x86_64__)
#    define __NR_statx 332
#  elif defined(__aarch64__)
#    define __NR_statx 291
#  else
#    error "__NR_statx is undefined for this architecture"
#  endif
#endif

int main(int argc, char *argv[]) {
    if (argc < 2) {
        fprintf(stderr, "Usage: %s <command> [args...]\n", argv[0]);
        return 1;
    }

    struct sock_filter filter[] = {
        /* Load the syscall number */
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
        /* If it's statx, return ENOSYS */
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_statx, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (ENOSYS & SECCOMP_RET_DATA)),
        /* Otherwise, allow */
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    };

    struct sock_fprog prog = {
        .len = sizeof(filter) / sizeof(filter[0]),
        .filter = filter,
    };

    /* Allow ourselves to install seccomp filters */
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
        perror("prctl(PR_SET_NO_NEW_PRIVS)");
        return 1;
    }

    /* Install the seccomp filter */
    if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog) != 0) {
        perror("prctl(PR_SET_SECCOMP)");
        return 1;
    }

    /* Execute the requested command */
    execvp(argv[1], argv + 1);
    perror("execvp");
    return 1;
}
