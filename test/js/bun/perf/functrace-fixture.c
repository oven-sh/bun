// Fixture for the tracer tests in linker-order.test.ts — functrace.c on linux
// and macOS, functrace-windows.c on Windows.
//
// Calls TOUCHED functions, runs the program named by argv[1] as a child (on
// linux and macOS it inherits the injected library), then calls one more. Under
// the tracer each call is a recorded first entry, so a child that
// create-and-truncates the trace file shows up as a collapsed count.
//
// noinline + a data dependency through the return value so the optimizer
// cannot fold the calls away.
//
//   cc -O2 -o functrace-fixture functrace-fixture.c
//   clang-cl /O2 -fuse-ld=lld functrace-fixture.c
#include <stdio.h>
#if defined(_WIN32)
#include <process.h>
#define NOINLINE __declspec(noinline)
#else
#include <sys/wait.h>
#include <unistd.h>
#define NOINLINE __attribute__((noinline))
#endif

#define TOUCHED 32

#define F(n) \
    NOINLINE static unsigned long long f##n(unsigned long long x) { return x + n; }
F(0) F(1) F(2) F(3) F(4) F(5) F(6) F(7)
F(8) F(9) F(10) F(11) F(12) F(13) F(14) F(15)
F(16) F(17) F(18) F(19) F(20) F(21) F(22) F(23)
F(24) F(25) F(26) F(27) F(28) F(29) F(30) F(31)
NOINLINE static unsigned long long after(unsigned long long x) { return x + 1; }

static unsigned long long (*const fns[TOUCHED])(unsigned long long) = {
    f0, f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12, f13, f14, f15,
    f16, f17, f18, f19, f20, f21, f22, f23, f24, f25, f26, f27, f28, f29, f30, f31,
};

/** Runs `program` to completion and returns its exit status. */
static int run_child(const char *program)
{
#if defined(_WIN32)
    return (int)_spawnl(_P_WAIT, program, program, (const char *)NULL);
#else
    pid_t child = fork();
    if (child < 0) return -1;
    if (child == 0) {
        execl(program, program, (char *)NULL);
        _exit(127);
    }
    int status = 0;
    return waitpid(child, &status, 0) == child ? status : -1;
#endif
}

int main(int argc, char **argv)
{
    if (argc < 2) return 2;

    unsigned long long sum = 0;
    for (int i = 0; i < TOUCHED; i++) sum = fns[i](sum);

    if (run_child(argv[1]) != 0) return 4;

    sum = after(sum);
    printf("%llu\n", sum);
    return 0;
}
