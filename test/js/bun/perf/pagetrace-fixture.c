// Fixture for the scripts/orderfile/pagetrace.c regression test.
//
// Reads one byte from each of TOUCHED pages of its own .rodata, execs the
// dynamically linked program named by argv[1] (which inherits LD_PRELOAD), then
// reads one more. Under the tracer each of those reads is a recorded page fault,
// so a child that create-and-truncates the trace file shows up as a collapsed
// count.
//
// The stride is the largest page size linux runs (64 KB on some aarch64 kernels)
// so the number of distinct pages touched is TOUCHED everywhere.
//
//   cc -O2 -o pagetrace-fixture pagetrace-fixture.c
#include <stdio.h>
#include <sys/wait.h>
#include <unistd.h>

#define STRIDE 65536
#define TOUCHED 32

// .rodata, not .bss: the tracer protects the binary's text and read-only
// mappings. volatile so the reads survive -O2.
static const volatile char blob[(TOUCHED + 1) * STRIDE] = { 1 };

int main(int argc, char **argv)
{
    if (argc < 2) return 2;

    unsigned long long sum = 0;
    for (int i = 0; i < TOUCHED; i++) sum += (unsigned long long)blob[(size_t)i * STRIDE];

    pid_t child = fork();
    if (child < 0) return 3;
    if (child == 0) {
        execl(argv[1], argv[1], (char *)NULL);
        _exit(127);
    }
    int status = 0;
    if (waitpid(child, &status, 0) != child || status != 0) return 4;

    sum += (unsigned long long)blob[(size_t)TOUCHED * STRIDE];
    printf("%llu\n", sum);
    return 0;
}
