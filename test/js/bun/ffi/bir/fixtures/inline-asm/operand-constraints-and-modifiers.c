/* How the operands of an asm statement are placed and printed: each constraint letter, the modifiers between `%`
   and the operand, names, matching digits, early clobbers, and the registers a statement says it overwrites. */
#include <stdint.h>
#include <stdio.h>

static int checks, wrong;
#define CHECK(condition) \
  do { \
    checks++; \
    if (!(condition)) { \
      wrong++; \
      printf("WRONG (line %d): %s\n", __LINE__, #condition); \
    } \
  } while (0)

/* Which register an operand got, read back by copying that register's number-revealing twin: the operand is
   named by the constraint, so moving it to the output says nothing; instead each test computes something that is
   only right if the operand really is where the constraint says. */
static uint64_t in_a(uint64_t v) { uint64_t out; __asm__("movq %%rax, %0" : "=r"(out) : "a"(v)); return out; }
static uint64_t in_b(uint64_t v) { uint64_t out; __asm__("movq %%rbx, %0" : "=r"(out) : "b"(v)); return out; }
static uint64_t in_c(uint64_t v) { uint64_t out; __asm__("movq %%rcx, %0" : "=r"(out) : "c"(v)); return out; }
static uint64_t in_d(uint64_t v) { uint64_t out; __asm__("movq %%rdx, %0" : "=r"(out) : "d"(v)); return out; }
static uint64_t in_S(uint64_t v) { uint64_t out; __asm__("movq %%rsi, %0" : "=r"(out) : "S"(v)); return out; }
static uint64_t in_D(uint64_t v) { uint64_t out; __asm__("movq %%rdi, %0" : "=r"(out) : "D"(v)); return out; }
static uint64_t out_a(void) { uint64_t out; __asm__("movq $11, %%rax" : "=a"(out)); return out; }
static uint64_t out_b(void) { uint64_t out; __asm__("movq $12, %%rbx" : "=b"(out)); return out; }
static uint64_t out_c(void) { uint64_t out; __asm__("movq $13, %%rcx" : "=c"(out)); return out; }
static uint64_t out_d(void) { uint64_t out; __asm__("movq $14, %%rdx" : "=d"(out)); return out; }
static uint64_t out_S(void) { uint64_t out; __asm__("movq $15, %%rsi" : "=S"(out)); return out; }
static uint64_t out_D(void) { uint64_t out; __asm__("movq $16, %%rdi" : "=D"(out)); return out; }

int main(void) {
  CHECK(in_a(1) == 1 && in_b(2) == 2 && in_c(3) == 3 && in_d(4) == 4 && in_S(5) == 5 && in_D(6) == 6);
  CHECK(out_a() == 11 && out_b() == 12 && out_c() == 13 && out_d() == 14 && out_S() == 15 && out_D() == 16);

  /* Every one of them at once, in and out. */
  {
    uint64_t a = 1, b = 2, c = 3, d = 4, S = 5, D = 6;
    __asm__("xchgq %%rax, %%rdi\n xchgq %%rbx, %%rsi\n xchgq %%rcx, %%rdx" : "+a"(a), "+b"(b), "+c"(c), "+d"(d), "+S"(S), "+D"(D));
    CHECK(a == 6 && b == 5 && c == 4 && d == 3 && S == 2 && D == 1);
  }

  /* The size of the operand picks the name of the register; a modifier picks another. */
  {
    uint64_t value = 0x1122334455667788ull, out = 0;
    __asm__("movb %b1, %b0" : "+r"(out) : "r"(value)); CHECK(out == 0x88);
    __asm__("movw %w1, %w0" : "+r"(out) : "r"(value)); CHECK(out == 0x7788);
    __asm__("movl %k1, %k0" : "=r"(out) : "r"(value)); CHECK(out == 0x55667788);
    uint32_t narrow = 7;
    __asm__("movq %q1, %0" : "=r"(out) : "r"(narrow)); CHECK((uint32_t)out == 7);
    __asm__("movzbl %h1, %k0" : "=Q"(out) : "Q"(value)); CHECK(out == 0x77);
    uint8_t byte = 0xfe;
    uint16_t word = 0xfffe;
    __asm__("incb %0" : "+r"(byte)); CHECK(byte == 0xff);
    __asm__("incw %0" : "+r"(word)); CHECK(word == 0xffff);
    __asm__("addb $1, %0\n adcb $0, %b1" : "+q"(byte), "+Q"(narrow) : : "cc"); CHECK(byte == 0 && narrow == 8);
    /* Without a suffix the register's size decides the instruction's. */
    __asm__("add %1, %0" : "+r"(word) : "r"((uint16_t)3)); CHECK(word == 2);
    __asm__("add %1, %0" : "+r"(out) : "r"(1ull << 40)); CHECK(out == 0x77 + (1ull << 40));
  }

  /* Immediates: `i` and `n` print with a `$`, `%c` without it, `%n` negated. */
  {
    enum { SEVEN = 7 };
    uint64_t out;
    __asm__("movq %1, %0" : "=r"(out) : "i"(SEVEN)); CHECK(out == 7);
    __asm__("movq %1, %0" : "=r"(out) : "n"(-2)); CHECK(out == ~1ull);
    __asm__("movq $%c1, %0" : "=r"(out) : "i"(40 + 2)); CHECK(out == 42);
    __asm__("movq $%n1, %0" : "=r"(out) : "i"(5)); CHECK(out == (uint64_t)-5);
    __asm__("leaq %c2(%1), %0" : "=r"(out) : "r"(100ull), "i"(28)); CHECK(out == 128);
    __asm__("movl %1, %k0" : "=r"(out) : "ri"(0x12345)); CHECK(out == 0x12345);
    uint64_t big = 0x1234567890ull;
    __asm__("movq %1, %0" : "=r"(out) : "ir"(big)); CHECK(out == big);
    __asm__("shlq %1, %0" : "+r"(out) : "I"(4)); CHECK(out == big << 4);
    __asm__("addq %1, %0" : "+r"(out) : "e"(0x7fffffff)); CHECK(out == (big << 4) + 0x7fffffff);
  }

  /* Memory operands: read, written, both; `rm` and `g` take either. */
  {
    uint64_t cell = 5, out;
    __asm__("movq %1, %0" : "=r"(out) : "m"(cell)); CHECK(out == 5);
    __asm__("movq %1, %0" : "=m"(cell) : "r"(9ull)); CHECK(cell == 9);
    __asm__("addq %1, %0" : "+m"(cell) : "r"(1ull) : "cc"); CHECK(cell == 10);
    __asm__("addq %1, %0" : "+r"(out) : "rm"(cell) : "cc"); CHECK(out == 15);
    __asm__("addq %1, %0" : "+r"(out) : "g"(cell) : "cc"); CHECK(out == 25);
    __asm__("addq %1, %0" : "+rm"(out) : "r"(cell) : "cc"); CHECK(out == 35);
    struct { uint32_t first, second; } pair = {1, 2};
    __asm__("addl %1, %0" : "+m"(pair.second) : "r"(40u) : "cc"); CHECK(pair.first == 1 && pair.second == 42);
    uint64_t array[4] = {1, 2, 3, 4};
    __asm__("movq %1, %0" : "=r"(out) : "m"(array[2])); CHECK(out == 3);
    __asm__("movq %1, %0" : "=r"(out) : "o"(array[3])); CHECK(out == 4);
    uint64_t *pointer = array;
    __asm__("movq %1, %0" : "=r"(out) : "m"(*pointer)); CHECK(out == 1);
    __asm__("movq %1, %0" : "=r"(out) : "m"(pointer[1])); CHECK(out == 2);
  }

  /* Names, matching digits and early clobbers. */
  {
    uint64_t result, left = 30, right = 12;
    __asm__("movq %[a], %[out]\n addq %[b], %[out]" : [out] "=&r"(result) : [a] "r"(left), [b] "r"(right) : "cc");
    CHECK(result == 42);
    __asm__("addq %[b], %[out]" : [out] "=r"(result) : "0"(left), [b] "r"(right) : "cc"); CHECK(result == 42);
    uint32_t swapped;
    __asm__("bswap %0" : "=r"(swapped) : "0"(0x11223344u)); CHECK(swapped == 0x44332211);
    /* An early-clobbered output is never in a register an input is in, so the inputs are intact after it is written. */
    uint64_t first, second;
    __asm__("movq $0, %0\n movq $0, %1\n addq %2, %0\n addq %3, %1" : "=&r"(first), "=&r"(second) : "r"(left), "r"(right) : "cc");
    CHECK(first == 30 && second == 12);
    /* A named operand with a modifier. */
    __asm__("movl %k[v], %k[out]" : [out] "=r"(result) : [v] "r"(0xaabbccdd11223344ull)); CHECK(result == 0x11223344);
    /* The matching constraint of an in-out operand written the long way. */
    uint64_t counter = 41;
    __asm__("incq %0" : "=r"(counter) : "0"(counter) : "cc"); CHECK(counter == 42);
  }

  /* The registers a statement says it overwrites are not given to its operands, and what was in them around
     the statement survives. */
  {
    uint64_t keep_a = 1, keep_b = 2, keep_c = 3, out;
    __asm__("movq $0, %%rax\n movq $0, %%rcx\n movq $0, %%rdx\n movq $0, %%rsi\n movq $0, %%rdi\n movq $0, %%r8\n movq $0, %%r9\n movq $0, %%r10\n movq $0, %%r11\n movq %1, %0"
            : "=r"(out)
            : "r"(77ull)
            : "rax", "rcx", "rdx", "rsi", "rdi", "r8", "r9", "r10", "r11");
    CHECK(out == 77 && keep_a == 1 && keep_b == 2 && keep_c == 3);
    __asm__("xorl %%eax, %%eax\n xorl %%ebx, %%ebx" : : : "%rax", "rbx", "cc");
    __asm__ volatile("" : : : "memory");
    CHECK(keep_a + keep_b + keep_c == 6);
  }

  /* `%%` is a percent sign, `%=` a number of this statement's own, `{a|b}` the first of two dialects. */
  {
    uint64_t out = 0, n = 5;
    __asm__("{movq %1, %0|mov %0, %1}" : "=r"(out) : "r"(9ull)); CHECK(out == 9);
    /* Without any colon there are no operands, and a `%` is only ever part of a register's name. */
    __asm__ volatile("prefetcht0 (%rsp)");
    __asm__("1%=:\n{addq|add} $2, %0\n decq %1\n jnz 1%=b" : "+r"(out), "+r"(n) : : "cc"); CHECK(out == 19 && n == 0);
    n = 3;
    __asm__("1%=:\n addq $1, %0\n decq %1\n jnz 1%=b" : "+r"(out), "+r"(n) : : "cc"); CHECK(out == 22);
  }

  /* More operands than there are letters for. */
  {
    uint64_t o0, o1, o2, o3, o4, o5, thirteen = 13;
    __asm__("movq %6, %0\n movq %7, %1\n movq %8, %2\n movq %9, %3\n movq %10, %4\n movq %11, %5"
            : "=&r"(o0), "=&r"(o1), "=&r"(o2), "=&r"(o3), "=&r"(o4), "=&r"(o5)
            : "r"(10ull), "r"(11ull), "r"(12ull), "m"(thirteen), "i"(14), "i"(15));
    CHECK(o0 == 10 && o1 == 11 && o2 == 12 && o3 == 13 && o4 == 14 && o5 == 15);
  }

  /* Floating values go in the vector registers. */
  {
    double real = 1.5, doubled;
    float single = 2.5f;
    uint64_t bits;
    uint32_t bits32;
    __asm__("movq %1, %0" : "=r"(bits) : "x"(real)); CHECK(bits == 0x3ff8000000000000ull);
    __asm__("movd %1, %0" : "=r"(bits32) : "x"(single)); CHECK(bits32 == 0x40200000u);
    __asm__("movq %1, %0" : "=x"(doubled) : "r"(0x4008000000000000ull)); CHECK(doubled == 3.0);
    __asm__("movaps %1, %0" : "=x"(doubled) : "x"(real)); CHECK(doubled == 1.5);
  }

  printf("%s, %d wrong\n", checks == 49 ? "every check made" : "checks are missing", wrong);
  return wrong != 0;
}
