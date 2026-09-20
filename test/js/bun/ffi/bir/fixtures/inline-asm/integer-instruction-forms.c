/* Every integer instruction the assembler knows, in every operand shape and size it takes, run and compared with
   the same thing written in C: an instruction encoded wrongly computes something else, or does not run at all. */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static int checks, wrong;
#define CHECK(condition) \
  do { \
    checks++; \
    if (!(condition)) { \
      wrong++; \
      printf("WRONG (line %d): %s\n", __LINE__, #condition); \
    } \
  } while (0)

/* destination op= source, for each shape of the two: register, memory, immediate. */
#define REG_REG(insn, T, a, b) ({ T _a = (a), _b = (b); __asm__(insn " %1, %0" : "+r"(_a) : "r"(_b) : "cc"); _a; })
#define REG_IMM(insn, T, a, imm) ({ T _a = (a); __asm__(insn " %1, %0" : "+r"(_a) : "i"(imm) : "cc"); _a; })
#define REG_MEM(insn, T, a, b) ({ T _a = (a); T _b = (b); __asm__(insn " %1, %0" : "+r"(_a) : "m"(_b) : "cc"); _a; })
#define MEM_REG(insn, T, a, b) ({ T _a = (a); T _b = (b); __asm__(insn " %1, %0" : "+m"(_a) : "r"(_b) : "cc"); _a; })
#define MEM_IMM(insn, T, a, imm) ({ T _a = (a); __asm__(insn " %1, %0" : "+m"(_a) : "i"(imm) : "cc"); _a; })
#define REG(insn, T, a) ({ T _a = (a); __asm__(insn " %0" : "+r"(_a) : : "cc"); _a; })
#define MEM(insn, T, a) ({ T _a = (a); __asm__(insn " %0" : "+m"(_a) : : "cc"); _a; })

/* One operation in all five shapes and all four sizes. `small` fits a sign-extended byte, `large` does not. */
#define ALL_SHAPES(name, op, T, suffix, x, y, small, large) \
  do { \
    const T a = (T)(x), b = (T)(y); \
    CHECK(REG_REG(name suffix, T, a, b) == (T)(a op b)); \
    CHECK(REG_REG(name, T, a, b) == (T)(a op b)); \
    CHECK(REG_MEM(name suffix, T, a, b) == (T)(a op b)); \
    CHECK(MEM_REG(name suffix, T, a, b) == (T)(a op b)); \
    CHECK(REG_IMM(name suffix, T, a, small) == (T)(a op (T)(small))); \
    CHECK(MEM_IMM(name suffix, T, a, small) == (T)(a op (T)(small))); \
    CHECK(REG_IMM(name suffix, T, a, large) == (T)(a op (T)(large))); \
    CHECK(MEM_IMM(name suffix, T, a, large) == (T)(a op (T)(large))); \
  } while (0)
#define ALL_SIZES(name, op) \
  do { \
    ALL_SHAPES(name, op, uint8_t, "b", 0xc5, 0x3e, 5, 0x71); \
    ALL_SHAPES(name, op, uint16_t, "w", 0xc5a7, 0x3e19, -3, 0x1234); \
    ALL_SHAPES(name, op, uint32_t, "l", 0xc5a7f00du, 0x3e19beefu, -3, 0x12345678); \
    ALL_SHAPES(name, op, uint64_t, "q", 0xc5a7f00d12345678ull, 0x3e19beef9abcdef0ull, -3, 0x12345678); \
  } while (0)

/* add-with-carry and subtract-with-borrow: `bt` puts bit 0 of `carry` in the carry flag first. */
static uint64_t adc64(uint64_t a, uint64_t b, uint32_t carry) {
  __asm__("btl $0, %2\n adcq %1, %0" : "+r"(a) : "r"(b), "r"(carry) : "cc");
  return a;
}
static uint32_t sbb32(uint32_t a, uint32_t b, uint32_t carry) {
  __asm__("btl $0, %2\n sbbl %1, %0" : "+r"(a) : "rm"(b), "r"(carry) : "cc");
  return a;
}
static uint64_t adc_imm(uint64_t a, uint32_t carry) {
  __asm__("btl $0, %1\n adcq $0, %0" : "+r"(a) : "r"(carry) : "cc");
  return a;
}

/* cmp and test only set flags: read them back with setcc. */
#define FLAG(insn, cc, T, a, b) ({ T _a = (a), _b = (b); uint8_t _f; __asm__(insn " %2, %1\n set" cc " %0" : "=q"(_f) : "r"(_a), "r"(_b) : "cc"); _f; })
#define FLAG_IMM(insn, cc, T, a, imm) ({ T _a = (a); uint8_t _f; __asm__(insn " %2, %1\n set" cc " %0" : "=q"(_f) : "rm"(_a), "i"(imm) : "cc"); _f; })

/* Every condition, as setcc and as cmovcc, after `cmp b, a` (flags of a - b). */
#define CONDITION(cc, truth) \
  do { \
    for (int i = 0; i < 5; i++) \
      for (int j = 0; j < 5; j++) { \
        const int32_t a = samples[i], b = samples[j]; \
        const uint32_t ua = (uint32_t)a, ub = (uint32_t)b; \
        const int32_t difference = (int32_t)(ua - ub); \
        const int overflow = (a < 0) != (b < 0) && (difference < 0) != (a < 0); \
        const int parity = !__builtin_parity((uint8_t)difference); \
        (void)ua; (void)ub; (void)overflow; (void)parity; \
        uint8_t flag; \
        __asm__("cmpl %2, %1\n set" cc " %0" : "=q"(flag) : "r"(a), "r"(b) : "cc"); \
        CHECK(flag == (truth)); \
        uint64_t chosen = 111; \
        __asm__("cmpl %2, %1\n cmov" cc " %3, %0" : "+r"(chosen) : "r"(a), "r"(b), "r"((uint64_t)222) : "cc"); \
        CHECK(chosen == ((truth) ? 222u : 111u)); \
        uint32_t narrow = 111; \
        __asm__("cmpl %2, %1\n cmov" cc "l %3, %0" : "+r"(narrow) : "r"(a), "r"(b), "m"(two_hundred) : "cc"); \
        CHECK(narrow == ((truth) ? 222u : 111u)); \
      } \
  } while (0)

static const int32_t samples[5] = {0, 1, -1, INT32_MIN, INT32_MAX};
static uint32_t two_hundred = 222;

int main(void) {
  ALL_SIZES("add", +);
  ALL_SIZES("sub", -);
  ALL_SIZES("and", &);
  ALL_SIZES("or", |);
  ALL_SIZES("xor", ^);

  CHECK(adc64(~0ull, 0, 1) == 0 && adc64(5, 6, 0) == 11 && adc64(5, 6, 1) == 12);
  CHECK(sbb32(5, 6, 0) == 0xffffffffu && sbb32(5, 6, 1) == 0xfffffffeu && sbb32(9, 2, 1) == 6);
  CHECK(adc_imm(41, 1) == 42 && adc_imm(41, 0) == 41);

  CHECK(FLAG("cmpb", "b", uint8_t, 3, 200) == 1 && FLAG("cmpb", "l", uint8_t, 3, 200) == 0);
  CHECK(FLAG("cmpw", "e", uint16_t, 0x1234, 0x1234) == 1 && FLAG("cmpl", "a", uint32_t, 7, 9) == 0);
  CHECK(FLAG("cmpq", "g", int64_t, 1ll << 40, -1) == 1 && FLAG("cmp", "be", uint64_t, 5, 5) == 1);
  CHECK(FLAG_IMM("cmpl", "e", uint32_t, 0x12345678, 0x12345678) == 1 && FLAG_IMM("cmpq", "l", int64_t, -2, -1) == 1);
  CHECK(FLAG_IMM("cmpb", "e", uint8_t, 0x80, 0x80) == 1 && FLAG_IMM("cmpw", "ne", uint16_t, 1, 2) == 1);
  CHECK(FLAG("testb", "z", uint8_t, 0xf0, 0x0f) == 1 && FLAG("testl", "nz", uint32_t, 0x100, 0x300) == 1);
  CHECK(FLAG("testq", "s", uint64_t, 1ull << 63, 1ull << 63) == 1 && FLAG("testw", "z", uint16_t, 1, 1) == 0);
  CHECK(FLAG_IMM("testl", "nz", uint32_t, 0x80000000u, 0x80000000) == 1 && FLAG_IMM("testb", "z", uint8_t, 6, 1) == 1);

  CONDITION("e", ua == ub);      CONDITION("z", ua == ub);      CONDITION("ne", ua != ub);    CONDITION("nz", ua != ub);
  CONDITION("b", ua < ub);       CONDITION("c", ua < ub);       CONDITION("nae", ua < ub);
  CONDITION("ae", ua >= ub);     CONDITION("nc", ua >= ub);     CONDITION("nb", ua >= ub);
  CONDITION("be", ua <= ub);     CONDITION("na", ua <= ub);     CONDITION("a", ua > ub);      CONDITION("nbe", ua > ub);
  CONDITION("l", a < b);         CONDITION("nge", a < b);       CONDITION("ge", a >= b);      CONDITION("nl", a >= b);
  CONDITION("le", a <= b);       CONDITION("ng", a <= b);       CONDITION("g", a > b);        CONDITION("nle", a > b);
  CONDITION("s", difference < 0); CONDITION("ns", difference >= 0);
  CONDITION("o", overflow);      CONDITION("no", !overflow);
  CONDITION("p", parity);        CONDITION("pe", parity);       CONDITION("np", !parity);     CONDITION("po", !parity);

  /* One operand. */
  CHECK(REG("negb", uint8_t, 5) == 251 && REG("negw", uint16_t, 5) == 65531 && REG("negl", uint32_t, 5) == -5u && REG("negq", uint64_t, 5) == -5ull);
  CHECK(MEM("negb", uint8_t, 5) == 251 && MEM("negl", uint32_t, 5) == -5u && MEM("negq", uint64_t, 5) == -5ull);
  CHECK(REG("notb", uint8_t, 5) == 250 && REG("notw", uint16_t, 5) == 65530 && REG("notl", uint32_t, 5) == ~5u && REG("notq", uint64_t, 5) == ~5ull);
  CHECK(MEM("notw", uint16_t, 5) == 65530 && MEM("notq", uint64_t, 5) == ~5ull);
  CHECK(REG("incb", uint8_t, 255) == 0 && REG("incw", uint16_t, 9) == 10 && REG("incl", uint32_t, ~0u) == 0 && REG("incq", uint64_t, ~0u) == 1ull << 32);
  CHECK(MEM("incb", uint8_t, 7) == 8 && MEM("incl", uint32_t, 7) == 8 && MEM("incq", uint64_t, ~0ull) == 0);
  CHECK(REG("decb", uint8_t, 0) == 255 && REG("decw", uint16_t, 0) == 65535 && REG("decl", uint32_t, 0) == ~0u && REG("decq", uint64_t, 0) == ~0ull);
  CHECK(MEM("decw", uint16_t, 10) == 9 && MEM("decq", uint64_t, 1ull << 32) == 0xffffffffull);
  CHECK(REG("neg", uint64_t, 1) == ~0ull && REG("inc", uint32_t, 1) == 2 && REG("dec", uint16_t, 1) == 0 && REG("not", uint8_t, 1) == 254);

  /* Multiplication: one operand (into dx:ax), two, and three. */
  {
    uint64_t low, high;
    __asm__("mulq %3" : "=a"(low), "=d"(high) : "a"(0xfedcba9876543210ull), "r"(0x123456789abcdef1ull) : "cc");
    CHECK(high == 0x121fa00ad77d7423ull && low == 0x224a4396cc6d0110ull);
    uint64_t factor = 0x123456789abcdef1ull;
    __asm__("mulq %3" : "=a"(low), "=d"(high) : "a"(0xfedcba9876543210ull), "m"(factor) : "cc");
    CHECK(high == 0x121fa00ad77d7423ull && low == 0x224a4396cc6d0110ull);
    uint32_t low32, high32;
    __asm__("mull %3" : "=a"(low32), "=d"(high32) : "a"(0xfedcba98u), "r"(0x76543210u) : "cc");
    CHECK((((uint64_t)high32 << 32) | low32) == 0xfedcba98ull * 0x76543210ull);
    int64_t slow, shigh;
    __asm__("imulq %3" : "=a"(slow), "=d"(shigh) : "a"(-3ll), "r"(1ll << 62) : "cc");
    CHECK(shigh == -1 && (uint64_t)slow == 0x4000000000000000ull);
    uint16_t product;
    __asm__("mulb %2" : "=a"(product) : "a"((uint8_t)200), "r"((uint8_t)3) : "cc");
    CHECK(product == 600);
  }
  CHECK(REG_REG("imulq", int64_t, -7, 6) == -42 && REG_REG("imull", int32_t, 100000, 3) == 300000 && REG_REG("imulw", int16_t, 300, 3) == 900);
  CHECK(REG_MEM("imulq", int64_t, -7, 6) == -42 && REG_MEM("imul", int32_t, 9, 9) == 81);
  {
    int32_t by_small, by_large;
    int64_t wide;
    __asm__("imull $100, %1, %0" : "=r"(by_small) : "r"(-5) : "cc");
    __asm__("imull $100000, %1, %0" : "=r"(by_large) : "rm"(-5) : "cc");
    __asm__("imulq $-3, %1, %0" : "=r"(wide) : "r"(1ll << 40) : "cc");
    CHECK(by_small == -500 && by_large == -500000 && wide == -3 * (1ll << 40));
    int64_t twice = 21;
    __asm__("imulq $2, %0" : "+r"(twice) : : "cc");
    CHECK(twice == 42);
  }

  /* Division: dx:ax by the operand. */
  {
    uint64_t quotient, remainder;
    __asm__("divq %4" : "=a"(quotient), "=d"(remainder) : "a"(7ull), "d"(1ull), "r"(10ull) : "cc");
    CHECK(quotient == 0x199999999999999aull && remainder == 3);
    uint32_t q32, r32, divisor = 1000;
    __asm__("divl %4" : "=a"(q32), "=d"(r32) : "a"(123456789u), "d"(0u), "m"(divisor) : "cc");
    CHECK(q32 == 123456 && r32 == 789);
    int64_t sq, sr;
    __asm__("cqto\n idivq %3" : "=a"(sq), "=&d"(sr) : "a"(-100ll), "r"(7ll) : "cc");
    CHECK(sq == -14 && sr == -2);
    int32_t sq32, sr32;
    __asm__("cltd\n idivl %3" : "=a"(sq32), "=&d"(sr32) : "a"(-100), "r"(7) : "cc");
    CHECK(sq32 == -14 && sr32 == -2);
    int64_t widened;
    __asm__("cltq" : "=a"(widened) : "a"(-5) : );
    CHECK(widened == -5);
    int32_t from16;
    __asm__("cwtl" : "=a"(from16) : "a"((int16_t)-300));
    CHECK(from16 == -300);
  }

  /* Shifts and rotates: by an immediate, by %cl, by one. */
#define SHIFT(insn, T, value, count) ({ T _v = (value); __asm__(insn " %1, %0" : "+r"(_v) : "i"(count) : "cc"); _v; })
#define SHIFT_CL(insn, T, value, count) ({ T _v = (value); __asm__(insn " %%cl, %0" : "+r"(_v) : "c"((uint8_t)(count)) : "cc"); _v; })
#define SHIFT_MEM(insn, T, value, count) ({ T _v = (value); __asm__(insn " %1, %0" : "+m"(_v) : "i"(count) : "cc"); _v; })
  CHECK(SHIFT("shlq", uint64_t, 5, 3) == 40 && SHIFT("shll", uint32_t, 0x80000001u, 1) == 2 && SHIFT("shlw", uint16_t, 0x8001, 4) == 0x10 && SHIFT("shlb", uint8_t, 0x81, 1) == 2);
  CHECK(SHIFT("shrq", uint64_t, 1ull << 63, 63) == 1 && SHIFT("shrl", uint32_t, 0x80000000u, 4) == 0x08000000u && SHIFT("shrb", uint8_t, 0x80, 7) == 1);
  CHECK(SHIFT("sarq", int64_t, -64, 3) == -8 && SHIFT("sarl", int32_t, -64, 3) == -8 && SHIFT("sarw", int16_t, -64, 3) == -8 && SHIFT("sarb", int8_t, -64, 3) == -8);
  CHECK(SHIFT("salq", uint64_t, 3, 2) == 12);
  CHECK(SHIFT_CL("shlq", uint64_t, 1, 40) == 1ull << 40 && SHIFT_CL("shrl", uint32_t, 0xf0000000u, 28) == 15 && SHIFT_CL("sarl", int32_t, -256, 4) == -16);
  CHECK(SHIFT_MEM("shlq", uint64_t, 5, 3) == 40 && SHIFT_MEM("shrw", uint16_t, 0x8000, 15) == 1 && SHIFT_MEM("sarb", int8_t, -128, 7) == -1);
  CHECK(REG("shrq", uint64_t, 6) == 3 && REG("shll", uint32_t, 6) == 12 && REG("sarw", int16_t, -6) == -3);
  CHECK(SHIFT("rorq", uint64_t, 1, 13) == 1ull << 51 && SHIFT("rolw", uint16_t, 0x1234, 8) == 0x3412 && SHIFT("roll", uint32_t, 0x80000001u, 1) == 3 && SHIFT("rorb", uint8_t, 1, 1) == 0x80);
  CHECK(SHIFT_CL("rolq", uint64_t, 1ull << 63, 1) == 1 && SHIFT_CL("rorl", uint32_t, 1, 1) == 0x80000000u);
  {
    uint64_t high = 0xf000000000000000ull, low = 0x000000000000000full;
    uint64_t left = low, right = high;
    __asm__("shldq $4, %1, %0" : "+r"(left) : "r"(high) : "cc");
    __asm__("shrdq %%cl, %1, %0" : "+r"(right) : "r"(low), "c"((uint8_t)4) : "cc");
    CHECK(left == 0xff && right == 0xff00000000000000ull);
    uint32_t left32 = 1;
    __asm__("shldl $8, %1, %0" : "+r"(left32) : "r"(0xab000000u) : "cc");
    CHECK(left32 == 0x1ab);
    /* Rotates through the carry flag. */
    uint8_t through = 0x80;
    __asm__("btl $0, %1\n rclb $1, %0" : "+r"(through) : "r"(1u) : "cc");
    CHECK(through == 1);
    through = 1;
    __asm__("btl $0, %1\n rcrb $1, %0" : "+r"(through) : "r"(0u) : "cc");
    CHECK(through == 0);
  }

  /* Moves: every width, with zero and sign extension, with every addressing mode. */
  {
    struct { uint8_t bytes[64]; } block;
    for (int i = 0; i < 64; i++) block.bytes[i] = (uint8_t)(0x80 + i);
    uint8_t *base = block.bytes;
    uint64_t index = 3, got;
    uint32_t got32;
    __asm__("movq (%1), %0" : "=r"(got) : "r"(base) : "memory"); CHECK(got == 0x8786858483828180ull);
    __asm__("movq 8(%1), %0" : "=r"(got) : "r"(base) : "memory"); CHECK(got == 0x8f8e8d8c8b8a8988ull);
    __asm__("movq -8(%1), %0" : "=r"(got) : "r"(base + 16) : "memory"); CHECK(got == 0x8f8e8d8c8b8a8988ull);
    __asm__("movq 0x100(%1), %0" : "=r"(got) : "r"(base - 0x100 + 8) : "memory"); CHECK(got == 0x8f8e8d8c8b8a8988ull);
    __asm__("movl (%1,%2), %0" : "=r"(got32) : "r"(base), "r"(index) : "memory"); CHECK(got32 == 0x86858483u);
    __asm__("movl (%1,%2,4), %0" : "=r"(got32) : "r"(base), "r"(index) : "memory"); CHECK(got32 == 0x8f8e8d8cu);
    __asm__("movl 4(%1,%2,8), %0" : "=r"(got32) : "r"(base), "r"(index) : "memory"); CHECK(got32 == 0x9f9e9d9cu);
    __asm__("movl (,%1,8), %0" : "=r"(got32) : "r"((uint64_t)(uintptr_t)base / 8) : "memory");
    CHECK(got32 == *(uint32_t *)((uintptr_t)base / 8 * 8));
    __asm__("movzbl 1(%1), %0" : "=r"(got32) : "r"(base) : "memory"); CHECK(got32 == 0x81);
    __asm__("movzbq 1(%1), %0" : "=r"(got) : "r"(base) : "memory"); CHECK(got == 0x81);
    __asm__("movzwl 2(%1), %0" : "=r"(got32) : "r"(base) : "memory"); CHECK(got32 == 0x8382);
    __asm__("movzwq 2(%1), %0" : "=r"(got) : "r"(base) : "memory"); CHECK(got == 0x8382);
    __asm__("movsbl 1(%1), %0" : "=r"(got32) : "r"(base) : "memory"); CHECK(got32 == 0xffffff81u);
    __asm__("movsbq 1(%1), %0" : "=r"(got) : "r"(base) : "memory"); CHECK(got == 0xffffffffffffff81ull);
    __asm__("movswl 2(%1), %0" : "=r"(got32) : "r"(base) : "memory"); CHECK(got32 == 0xffff8382u);
    __asm__("movswq 2(%1), %0" : "=r"(got) : "r"(base) : "memory"); CHECK(got == 0xffffffffffff8382ull);
    __asm__("movslq 4(%1), %0" : "=r"(got) : "r"(base) : "memory"); CHECK(got == 0xffffffff87868584ull);
    uint16_t got16;
    __asm__("movzbw %1, %0" : "=r"(got16) : "r"((uint8_t)0x90)); CHECK(got16 == 0x90);
    __asm__("movsbw %1, %0" : "=r"(got16) : "r"((uint8_t)0x90)); CHECK(got16 == 0xff90);
    __asm__("movzwl %1, %0" : "=r"(got32) : "r"((uint16_t)0x9000)); CHECK(got32 == 0x9000);
    __asm__("movsbq %1, %0" : "=r"(got) : "r"((int8_t)-2)); CHECK(got == ~1ull);
    __asm__("movslq %1, %0" : "=r"(got) : "r"(-2)); CHECK(got == ~1ull);
    /* `movsxd` to 32 bits is a plain move (no REX.W), and `test` takes its operands in either order. */
#ifndef __clang__ /* (whose assembler has the name in Intel's syntax only) */
    uint32_t narrow = 0;
    __asm__("movsxd %1, %0" : "=r"(narrow) : "m"(*(int32_t *)(base + 4))); CHECK(narrow == 0x87868584u);
    __asm__("movsxd %1, %0" : "=r"(got) : "m"(*(int32_t *)(base + 4))); CHECK(got == 0xffffffff87868584ull);
#else
    checks += 2;
#endif
    uint8_t zero_flag = 9;
    uint32_t in_memory = 0x0f0, in_register = 0xf00;
    __asm__("testl %1, %2\n setz %0" : "=q"(zero_flag) : "m"(in_memory), "r"(in_register) : "cc"); CHECK(zero_flag == 1);
    in_register = 0x010;
    __asm__("testl %1, %2\n setz %0" : "=q"(zero_flag) : "m"(in_memory), "r"(in_register) : "cc"); CHECK(zero_flag == 0);
    __asm__("testl %2, %1\n setz %0" : "=q"(zero_flag) : "m"(in_memory), "r"(in_register) : "cc"); CHECK(zero_flag == 0);

    __asm__("movl $5, %0" : "=r"(got32)); CHECK(got32 == 5);
    __asm__("movq $-1, %0" : "=r"(got)); CHECK(got == ~0ull);
    __asm__("movabsq $0x1122334455667788, %0" : "=r"(got)); CHECK(got == 0x1122334455667788ull);
    __asm__("movq %1, %0" : "=r"(got) : "r"(0x99ull)); CHECK(got == 0x99);
    __asm__("mov %1, %0" : "=r"(got32) : "r"(0x77u)); CHECK(got32 == 0x77);
    __asm__("movb $7, (%0)" : : "r"(base) : "memory"); CHECK(base[0] == 7);
    __asm__("movw $0x1234, 2(%0)" : : "r"(base) : "memory"); CHECK(base[2] == 0x34 && base[3] == 0x12);
    __asm__("movl $0x12345678, 4(%0)" : : "r"(base) : "memory"); CHECK(base[4] == 0x78 && base[7] == 0x12);
    __asm__("movq $-2, 8(%0)" : : "r"(base) : "memory"); CHECK(base[8] == 0xfe && base[15] == 0xff);
    __asm__("movl %1, 16(%0)" : : "r"(base), "r"(0xa1b2c3d4u) : "memory"); CHECK(base[16] == 0xd4 && base[19] == 0xa1);
    __asm__("movb %b1, 20(%0)" : : "r"(base), "q"(0x5au) : "memory"); CHECK(base[20] == 0x5a);
    /* The second byte of a, b, c and d has a name of its own. */
    uint8_t second;
    __asm__("movb %%ah, %0" : "=Q"(second) : "a"(0x1234u)); CHECK(second == 0x12);
    uint32_t swapped = 0x1234;
    __asm__("xchgb %%ah, %%al" : "+a"(swapped)); CHECK(swapped == 0x3412);

    /* lea computes what a load would address. */
    __asm__("leaq 8(%1,%2,4), %0" : "=r"(got) : "r"(1000ull), "r"(5ull)); CHECK(got == 1028);
    __asm__("leal (%1,%1,2), %0" : "=r"(got32) : "r"(7u)); CHECK(got32 == 21);
    __asm__("leaq -1(%1), %0" : "=r"(got) : "r"(0ull)); CHECK(got == ~0ull);
    __asm__("leaq (,%1,8), %0" : "=r"(got) : "r"(3ull)); CHECK(got == 24);

    /* The registers past the first eight, and the ones that need special treatment as a base. */
    register uint64_t r12 __asm__("r12") = (uint64_t)(uintptr_t)base;
    register uint64_t r13 __asm__("r13") = (uint64_t)(uintptr_t)base;
    __asm__("movzbl 1(%1), %0" : "=r"(got32) : "r"(r12) : "memory"); CHECK(got32 == 0x81);
    __asm__("movzbl (%1), %0" : "=r"(got32) : "r"(r13) : "memory"); CHECK(got32 == 7);
    register uint64_t r9 __asm__("r9") = 40, r10 __asm__("r10") = 2, r11 __asm__("r11");
    __asm__("leaq (%1,%2), %0" : "=r"(r11) : "r"(r9), "r"(r10)); CHECK(r11 == 42);
    register uint8_t r15 __asm__("r15") = 0;
    __asm__("movb $9, %0" : "=r"(r15)); CHECK(r15 == 9);
  }

  /* Exchange and the locked read-modify-writes. */
  {
    uint64_t cell = 5, reg = 9;
    __asm__("xchgq %0, %1" : "+r"(reg), "+m"(cell)); CHECK(cell == 9 && reg == 5);
    uint32_t a = 1, b = 2;
    __asm__("xchgl %0, %1" : "+r"(a), "+r"(b)); CHECK(a == 2 && b == 1);
    int counter = 40, by = 2;
    __asm__ volatile("lock xaddl %0, %1" : "+r"(by), "+m"(counter) : : "memory", "cc"); CHECK(by == 40 && counter == 42);
    uint64_t wide = 10, more = 5;
    __asm__ volatile("lock; xaddq %0, %1" : "+r"(more), "+m"(wide) : : "memory", "cc"); CHECK(more == 10 && wide == 15);
    uint64_t expected = 15, seen;
    __asm__ volatile("lock cmpxchgq %2, %1" : "=a"(seen), "+m"(wide) : "r"(99ull), "0"(expected) : "memory", "cc");
    CHECK(seen == 15 && wide == 99);
    __asm__ volatile("lock cmpxchgq %2, %1" : "=a"(seen), "+m"(wide) : "r"(7ull), "0"(expected) : "memory", "cc");
    CHECK(seen == 99 && wide == 99);
    uint32_t small = 3, seen32;
    __asm__ volatile("lock; cmpxchgl %2, %1" : "=a"(seen32), "+m"(small) : "r"(4u), "0"(3u) : "memory", "cc"); CHECK(seen32 == 3 && small == 4);
    uint8_t tiny = 3, seen8;
    __asm__ volatile("lock cmpxchgb %2, %1" : "=a"(seen8), "+m"(tiny) : "q"((uint8_t)4), "0"((uint8_t)3) : "memory", "cc"); CHECK(seen8 == 3 && tiny == 4);
    __asm__ volatile("lock incl %0" : "+m"(counter) : : "memory", "cc"); CHECK(counter == 43);
    __asm__ volatile("lock decq %0" : "+m"(wide) : : "memory", "cc"); CHECK(wide == 98);
    __asm__ volatile("lock addl $5, %0" : "+m"(counter) : : "memory", "cc"); CHECK(counter == 48);
    __asm__ volatile("lock orq %1, %0" : "+m"(wide) : "r"(1ull) : "memory", "cc"); CHECK(wide == 99);
    __asm__ volatile("lock negl %0" : "+m"(counter) : : "memory", "cc"); CHECK(counter == -48);
    /* Sixteen bytes at once. */
    _Alignas(16) uint64_t pair[2] = {1, 2};
    uint64_t low = 1, high = 2;
    uint8_t swapped;
    __asm__ volatile("lock cmpxchg16b %1\n sete %0" : "=q"(swapped), "+m"(pair), "+a"(low), "+d"(high) : "b"(10ull), "c"(20ull) : "memory", "cc");
    CHECK(swapped == 1 && pair[0] == 10 && pair[1] == 20);
    low = 1; high = 2;
    __asm__ volatile("lock cmpxchg16b %1\n sete %0" : "=q"(swapped), "+m"(pair), "+a"(low), "+d"(high) : "b"(0ull), "c"(0ull) : "memory", "cc");
    CHECK(swapped == 0 && low == 10 && high == 20);
  }

  printf("%s, %d wrong\n", checks == 2521 ? "every check made" : "checks are missing", wrong);
  return wrong != 0;
}
