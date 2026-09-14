/* What C guarantees after longjmp (7.13.2.1p3): volatile locals, and locals not changed since setjmp, have
   their values. */
#include <setjmp.h>
#include <stdio.h>

static jmp_buf env;
static int depth;

static void dive(int n) {
    depth = n;
    if (n == 0) longjmp(env, 42);
    dive(n - 1);
}

static int counts(void) {
    volatile int tries = 0;
    int unchanged = 7;
    volatile double total = 1.5;
    struct { int a; char text[8]; } record = { 3, "abc" };
    int code = setjmp(env);
    tries++;
    if (code == 0) dive(5);
    if (tries < 3) { total += code; dive(tries); }
    return tries * 1000 + unchanged * 100 + (int)total + record.a + record.text[1] + code + depth;
}

#ifdef _WIN32 // no signal mask to save or restore there
#define sigjmp_buf jmp_buf
#define sigsetjmp(env, save) setjmp(env)
#define siglongjmp longjmp
#endif
static sigjmp_buf senv;
static int with_mask(void) {
    int v = sigsetjmp(senv, 1);
    if (v < 3) siglongjmp(senv, v + 1);
    return v;
}

int main(void) {
    printf("%d\n", counts());
    printf("%d\n", with_mask());
    /* longjmp(env, 0) makes setjmp return 1. */
    volatile int again = 0;
    int zero = setjmp(env);
    if (!again) { again = 1; longjmp(env, 0); }
    printf("%d\n", zero);
    return 0;
}
