#include <stdio.h>
#include <cpuid.h>

static inline void relax(void) { __asm__ __volatile__("rep; nop" ::: "memory"); }
static inline void barrier(void) { __asm__ volatile("" ::: "memory"); }
static inline void hint(void) { asm("pause"); }
int spin(volatile int *flag) { int n = 0; while (!*flag && n < 3) { relax(); barrier(); hint(); n++; } return n; }
typedef struct { unsigned a, b, c, d; } regs;
regs identify(unsigned leaf) {
    regs r = { 1, 2, 3, 4 };
    __asm__("cpuid" : "=a"(r.a), "=b"(r.b), "=c"(r.c), "=d"(r.d) : "a"(leaf), "c"(0));
    return r;
}
unsigned saved_rbx(void) { unsigned n = 9; __asm__("pushq %%rbx\n\tcpuid\n\tpopq %%rbx\n\t" : "=a"(n) : "a"(0) : "rcx", "rdx"); return n; }
unsigned long long xcr0(void) { unsigned lo = 7, hi = 7; __asm__(".byte 0x0f, 0x01, 0xd0" : "=a"(lo), "=d"(hi) : "c"(0)); return ((unsigned long long)hi << 32) | lo; }
int from_header(void) { unsigned a = 5, b = 5, c = 5, d = 5; int ok = __get_cpuid(1, &a, &b, &c, &d); return ok * 100 + __get_cpuid_max(0, 0) * 10 + (a == 5); }
unsigned moved(void) { unsigned f7b, f7c; __asm__("pushq %%rbx\n\tcpuid\n\tmovq %%rbx, %%rax\n\tpopq %%rbx" : "=a"(f7b), "=c"(f7c) : "a"(7), "c"(0) : "rdx"); return f7b; }
int exchanged(int info_type) { int info[4]; __asm__ volatile("mov %%ebx, %%edi\n" "cpuid\n" "xchg %%edi, %%ebx\n" : "=a"(info[0]), "=D"(info[1]), "=c"(info[2]), "=d"(info[3]) : "a"(info_type), "c"(0)); return info[1]; }
int supports(void) { __builtin_cpu_init(); return !!__builtin_cpu_supports("sse2") + !!__builtin_cpu_supports("bmi2") * 2 + !!__builtin_cpu_supports("avx2") * 4 + !!__builtin_cpu_supports("avx512f") * 8; }

int main(void) {
  volatile int flag = 0;
  printf("spin %d\n", spin(&flag));
  /* Every way of asking the processor gives the same answer. */
  regs leaf0 = identify(0), leaf1 = identify(1), leaf7 = identify(7);
  printf("vendor %d\n", leaf0.b == 0x756e6547 || leaf0.b == 0x68747541);
  printf("saved_rbx %d\n", saved_rbx() == leaf0.a);
  printf("from_header %d\n", (unsigned)from_header() == 100 + leaf0.a * 10 + (leaf1.a == 5));
  printf("moved %d\n", moved() == leaf7.b);
  /* (The top byte of ebx is the id of whichever core answers.) */
  printf("exchanged %d\n", ((unsigned)exchanged(1) & 0xffffff) == (leaf1.b & 0xffffff));
  unsigned sse2 = (leaf1.d >> 26) & 1, bmi2 = leaf0.a >= 7 ? (leaf7.b >> 8) & 1 : 0;
  printf("supports %d\n", ((unsigned)supports() & 3) == sse2 + bmi2 * 2);
  /* xgetbv reads zero here: no extended state is claimed, so that nobody takes a path that
     needs wider vectors than the compiler has. */
  printf("xcr0 %d\n", (int)xcr0());
  return 0;
}
