/* The rest of what the assembler knows: bit tests and scans, the string instructions, fences and the instructions
   that read the machine, the BMI and ADX extensions (where the processor has them) and the SSE2 subset, each run
   and compared with the same thing in C. */
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

static void cpuid(uint32_t leaf, uint32_t subleaf, uint32_t out[4]) {
  __asm__ volatile("cpuid" : "=a"(out[0]), "=b"(out[1]), "=c"(out[2]), "=d"(out[3]) : "a"(leaf), "c"(subleaf));
}

/* A 16-byte value for the vector instructions, by its two halves. It goes through memory: the instructions load
   it into the registers they name, which the statement says it overwrites. */
typedef uint64_t vector __attribute__((vector_size(16)));
#define VECTOR_OP(insn, a, b) \
  ({ \
    vector _a = (a), _b = (b), _r; \
    __asm__("movdqu %1, %%xmm0\n movdqu %2, %%xmm1\n " insn " %%xmm1, %%xmm0\n movdqu %%xmm0, %0" : "=m"(_r) : "m"(_a), "m"(_b) : "xmm0", "xmm1"); \
    _r; \
  })

static uint32_t crc32_bitwise(uint32_t crc, const uint8_t *bytes, int count) {
  for (int i = 0; i < count; i++) {
    crc ^= bytes[i];
    for (int bit = 0; bit < 8; bit++) crc = (crc >> 1) ^ (0x82f63b78u & (0u - (crc & 1)));
  }
  return crc;
}

int main(void) {
  /* Bit tests: the bit goes to the carry flag; bts, btr and btc also change it. */
  {
    uint8_t carry;
    uint64_t word = 0x50;
    __asm__("btq %2, %1\n setc %0" : "=q"(carry) : "r"(word), "r"(4ull) : "cc"); CHECK(carry == 1);
    __asm__("btq $5, %1\n setc %0" : "=q"(carry) : "r"(word) : "cc"); CHECK(carry == 0);
    __asm__("btsq $5, %1\n setc %0" : "=q"(carry), "+r"(word) : : "cc"); CHECK(carry == 0 && word == 0x70);
    __asm__("btrq %2, %1\n setc %0" : "=q"(carry), "+r"(word) : "r"(4ull) : "cc"); CHECK(carry == 1 && word == 0x60);
    __asm__("btcq $0, %1\n setc %0" : "=q"(carry), "+r"(word) : : "cc"); CHECK(carry == 0 && word == 0x61);
    uint32_t small = 0;
    __asm__("btsl $31, %0" : "+r"(small) : : "cc"); CHECK(small == 0x80000000u);
    __asm__("btrl %1, %0" : "+r"(small) : "r"(31u) : "cc"); CHECK(small == 0);
    /* On memory, the bit number reaches past the word. */
    uint32_t bits[4] = {0, 0, 0, 0};
    __asm__ volatile("btsl %1, %0" : "+m"(bits) : "r"(70u) : "cc", "memory"); CHECK(bits[2] == 1u << 6);
    __asm__ volatile("btq %2, %1\n setc %0" : "=q"(carry) : "m"(bits), "r"(70ull) : "cc"); CHECK(carry == 1);
    __asm__ volatile("lock btrl $6, %0" : "+m"(bits[2]) : : "cc", "memory"); CHECK(bits[2] == 0);
    uint16_t half = 1;
    __asm__("btcw $15, %0" : "+r"(half) : : "cc"); CHECK(half == 0x8001);
  }

  /* Bit scans and counts. */
  {
    uint64_t at;
    uint32_t at32;
    __asm__("bsfq %1, %0" : "=r"(at) : "r"(0x50ull) : "cc"); CHECK(at == 4);
    __asm__("bsrq %1, %0" : "=r"(at) : "rm"(0x50ull) : "cc"); CHECK(at == 6);
    __asm__("bsfl %1, %0" : "=r"(at32) : "r"(0x80000000u) : "cc"); CHECK(at32 == 31);
    __asm__("bsrl %1, %0" : "=r"(at32) : "r"(1u) : "cc"); CHECK(at32 == 0);
    uint16_t at16;
    __asm__("bsfw %1, %0" : "=r"(at16) : "r"((uint16_t)0x100) : "cc"); CHECK(at16 == 8);
    uint32_t leaf1[4], leaf7[4], extended[4];
    cpuid(1, 0, leaf1);
    cpuid(7, 0, leaf7);
    cpuid(0x80000001u, 0, extended);
    if (leaf1[2] & (1u << 23)) {
      __asm__("popcntq %1, %0" : "=r"(at) : "r"(0xffffffff00000001ull) : "cc"); CHECK(at == 33);
      __asm__("popcntl %1, %0" : "=r"(at32) : "rm"(0xf0f0f0f1u) : "cc"); CHECK(at32 == 17);
      __asm__("popcntw %1, %0" : "=r"(at16) : "r"((uint16_t)0xff01) : "cc"); CHECK(at16 == 9);
    }
    if (leaf7[1] & (1u << 3)) {
      __asm__("tzcntq %1, %0" : "=r"(at) : "r"(1ull << 40) : "cc"); CHECK(at == 40);
      __asm__("tzcntl %1, %0" : "=r"(at32) : "r"(0u) : "cc"); CHECK(at32 == 32);
    }
    if (extended[2] & (1u << 5)) {
      __asm__("lzcntq %1, %0" : "=r"(at) : "r"(1ull) : "cc"); CHECK(at == 63);
      __asm__("lzcntl %1, %0" : "=r"(at32) : "rm"(0x00010000u) : "cc"); CHECK(at32 == 15);
    }

    /* Byte order. */
    uint32_t order32 = 0x11223344;
    uint64_t order64 = 0x1122334455667788ull;
    __asm__("bswap %0" : "+r"(order32)); CHECK(order32 == 0x44332211);
    __asm__("bswapl %0" : "+r"(order32)); CHECK(order32 == 0x11223344);
    __asm__("bswapq %0" : "+r"(order64)); CHECK(order64 == 0x8877665544332211ull);
    register uint64_t r9 __asm__("r9") = 0x0102030405060708ull;
    __asm__("bswap %0" : "+r"(r9)); CHECK(r9 == 0x0807060504030201ull);

    /* BMI1, BMI2 and ADX: three-operand forms, flags untouched by some. */
    if ((leaf7[1] & (1u << 3)) && (leaf7[1] & (1u << 8))) {
      uint64_t out, a = 0xff00ff00ff00ff00ull, b = 0x0ff00ff00ff00ff0ull;
      __asm__("andn %2, %1, %0" : "=r"(out) : "r"(a), "r"(b) : "cc"); CHECK(out == (~a & b));
      __asm__("andnl %2, %1, %0" : "=r"(at32) : "r"(0xffff0000u), "rm"(0x12345678u) : "cc"); CHECK(at32 == 0x5678);
      __asm__("blsr %1, %0" : "=r"(out) : "r"(0x50ull) : "cc"); CHECK(out == 0x40);
      __asm__("blsi %1, %0" : "=r"(out) : "r"(0x50ull) : "cc"); CHECK(out == 0x10);
      __asm__("blsmsk %1, %0" : "=r"(out) : "rm"(0x50ull) : "cc"); CHECK(out == 0x1f);
      __asm__("bextr %2, %1, %0" : "=r"(out) : "r"(0x123456789abcdef0ull), "r"(0x0c10ull) : "cc"); CHECK(out == 0xabc);
      __asm__("shlx %2, %1, %0" : "=r"(out) : "r"(3ull), "r"(62ull)); CHECK(out == 0xc000000000000000ull);
      __asm__("shrx %2, %1, %0" : "=r"(out) : "rm"(1ull << 63), "r"(63ull)); CHECK(out == 1);
      __asm__("sarx %2, %1, %0" : "=r"(out) : "r"(1ull << 63), "r"(62ull)); CHECK(out == ~1ull);
      __asm__("shrxl %2, %1, %0" : "=r"(at32) : "r"(0x80000000u), "r"(31u)); CHECK(at32 == 1);
      __asm__("rorx $13, %1, %0" : "=r"(out) : "r"(1ull)); CHECK(out == 1ull << 51);
      __asm__("rorxl $1, %1, %0" : "=r"(at32) : "r"(1u)); CHECK(at32 == 0x80000000u);
      uint64_t low, high;
      __asm__("mulx %3, %0, %1" : "=r"(low), "=r"(high) : "d"(0xfedcba9876543210ull), "r"(0x123456789abcdef1ull));
      CHECK(high == 0x121fa00ad77d7423ull && low == 0x224a4396cc6d0110ull);
      __asm__("pdep %2, %1, %0" : "=r"(out) : "r"(0xffull), "r"(0x0f0f0f0full)); CHECK(out == 0x0f0f);
      __asm__("pext %2, %1, %0" : "=r"(out) : "r"(0x12345678ull), "r"(0x0f0f0f0full)); CHECK(out == 0x2468);
      __asm__("bzhi %2, %1, %0" : "=r"(out) : "r"(~0ull), "r"(12ull) : "cc"); CHECK(out == 0xfff);
      register uint64_t r10 __asm__("r10") = 0xf0, r11 __asm__("r11") = 0xff, r12 __asm__("r12");
      __asm__("andn %2, %1, %0" : "=r"(r12) : "r"(r10), "r"(r11) : "cc"); CHECK(r12 == 0x0f);
    }
    if (leaf7[1] & (1u << 19)) {
      /* Two carry chains at once: adcx uses the carry flag, adox the overflow flag. */
      uint64_t a = ~0ull, b = ~0ull;
      __asm__("xorl %%ecx, %%ecx\n adcxq %2, %0\n adoxq %2, %1\n adcxq %%rcx, %0\n adoxq %%rcx, %1" : "+r"(a), "+r"(b) : "r"(1ull) : "rcx", "cc");
      CHECK(a == 1 && b == 1);
    }
    if (leaf1[2] & (1u << 20)) {
      /* crc32 is the Castagnoli polynomial, a byte, a word, a doubleword or a quadword at a time. */
      static const uint8_t message[15] = "123456789abcdef";
      uint32_t crc = ~0u;
      uint64_t crc64 = ~0u;
      __asm__("crc32q %1, %0" : "+r"(crc64) : "rm"(*(const uint64_t *)message));
      crc = (uint32_t)crc64;
      __asm__("crc32l %1, %0" : "+r"(crc) : "rm"(*(const uint32_t *)(message + 8)));
      __asm__("crc32w %1, %0" : "+r"(crc) : "r"(*(const uint16_t *)(message + 12)));
      __asm__("crc32b %1, %0" : "+r"(crc) : "r"(message[14]));
      CHECK(crc == crc32_bitwise(~0u, message, 15));
      crc = ~0u;
      __asm__("crc32b (%1), %0" : "+r"(crc) : "r"(message));
      CHECK(crc == crc32_bitwise(~0u, message, 1));
    }
  }

  /* String instructions: rsi, rdi and rcx, a repeat prefix, the direction flag clear. */
  {
    uint8_t from[40], to[40];
    for (int i = 0; i < 40; i++) from[i] = (uint8_t)(i * 7);
    void *source = from, *destination = to;
    uint64_t count = 40;
    memset(to, 0, sizeof to);
    __asm__ volatile("rep movsb" : "+S"(source), "+D"(destination), "+c"(count) : : "memory");
    CHECK(memcmp(from, to, 40) == 0 && count == 0 && source == from + 40 && destination == to + 40);
    source = from; destination = to; count = 5; memset(to, 0, sizeof to);
    __asm__ volatile("rep movsq" : "+S"(source), "+D"(destination), "+c"(count) : : "memory");
    CHECK(memcmp(from, to, 40) == 0);
    source = from; destination = to; count = 10; memset(to, 0, sizeof to);
    __asm__ volatile("rep movsl" : "+S"(source), "+D"(destination), "+c"(count) : : "memory");
    CHECK(memcmp(from, to, 40) == 0);
    source = from; destination = to; count = 20; memset(to, 0, sizeof to);
    __asm__ volatile("rep movsw" : "+S"(source), "+D"(destination), "+c"(count) : : "memory");
    CHECK(memcmp(from, to, 40) == 0);
    destination = to; count = 5;
    __asm__ volatile("rep stosq" : "+D"(destination), "+c"(count) : "a"(0x0101010101010101ull) : "memory");
    CHECK(to[0] == 1 && to[39] == 1);
    destination = to; count = 3;
    __asm__ volatile("rep stosb" : "+D"(destination), "+c"(count) : "a"(9) : "memory");
    CHECK(to[0] == 9 && to[2] == 9 && to[3] == 1);
    destination = to + 4;
    __asm__ volatile("stosl" : "+D"(destination) : "a"(0xa1b2c3d4u) : "memory");
    CHECK(to[4] == 0xd4 && to[7] == 0xa1 && destination == to + 8);
    /* scas looks for al; cmps compares; lods loads. */
    destination = from; count = 40;
    __asm__ volatile("repne scasb" : "+D"(destination), "+c"(count) : "a"(21) : "cc", "memory");
    CHECK(destination == from + 4 && count == 36);
    memcpy(to, from, 40); to[17] ^= 1;
    source = from; destination = to; count = 40;
    __asm__ volatile("repe cmpsb" : "+S"(source), "+D"(destination), "+c"(count) : : "cc", "memory");
    CHECK(source == from + 18 && count == 22);
    source = from + 8;
    uint64_t loaded;
    __asm__ volatile("lodsq" : "=a"(loaded), "+S"(source) : : "memory");
    CHECK(loaded == *(uint64_t *)(from + 8) && source == from + 16);
    __asm__ volatile("cld");
  }

  /* What orders memory, waits, or asks the machine something. */
  {
    int cell = 1;
    __asm__ volatile("mfence" ::: "memory");
    __asm__ volatile("lfence" ::: "memory");
    __asm__ volatile("sfence" ::: "memory");
    __asm__ volatile("pause");
    __asm__ volatile("nop");
    __asm__ volatile("clflush %0" : "+m"(cell));
    __asm__ volatile("prefetcht0 %0" : : "m"(cell));
    __asm__ volatile("prefetcht1 %0\n prefetcht2 %0\n prefetchnta %0" : : "m"(cell));
    __asm__ volatile(".p2align 4");
    CHECK(cell == 1);
    uint32_t low, high, again_low, again_high, processor;
    __asm__ volatile("rdtsc" : "=a"(low), "=d"(high));
    __asm__ volatile("rdtscp" : "=a"(again_low), "=d"(again_high), "=c"(processor));
    CHECK((((uint64_t)again_high << 32) | again_low) >= (((uint64_t)high << 32) | low));
    uint32_t identity[4], leaf1[4];
    cpuid(0, 0, identity);
    cpuid(1, 0, leaf1);
    CHECK(identity[0] >= 1 && identity[1] != 0);
    if (leaf1[2] & (1u << 30)) {
      uint64_t random;
      uint8_t ok;
      __asm__ volatile("rdrand %0\n setc %1" : "=r"(random), "=q"(ok) : : "cc");
      CHECK(ok <= 1);
    }
  }

  /* SSE2: moves between the two register files and memory, and arithmetic on all 128 bits. */
  {
    vector a = {0x1111111111111111ull, 0x2222222222222222ull}, b = {0x0f0f0f0f0f0f0f0full, 0xf0f0f0f0f0f0f0f0ull}, r;
    r = VECTOR_OP("pxor", a, b); CHECK(r[0] == (a[0] ^ b[0]) && r[1] == (a[1] ^ b[1]));
    r = VECTOR_OP("pand", a, b); CHECK(r[0] == (a[0] & b[0]) && r[1] == (a[1] & b[1]));
    r = VECTOR_OP("por", a, b); CHECK(r[0] == (a[0] | b[0]) && r[1] == (a[1] | b[1]));
    r = VECTOR_OP("pandn", a, b); CHECK(r[0] == (~a[0] & b[0]) && r[1] == (~a[1] & b[1]));
    r = VECTOR_OP("paddq", a, b); CHECK(r[0] == a[0] + b[0] && r[1] == a[1] + b[1]);
    r = VECTOR_OP("psubq", a, b); CHECK(r[0] == a[0] - b[0] && r[1] == a[1] - b[1]);
    r = VECTOR_OP("paddb", a, b); CHECK(r[0] == 0x2020202020202020ull && r[1] == 0x1212121212121212ull);
    r = VECTOR_OP("paddw", a, b); CHECK(r[0] == 0x2020202020202020ull && r[1] == 0x1312131213121312ull);
    r = VECTOR_OP("paddd", a, b); CHECK(r[0] == 0x2020202020202020ull && r[1] == 0x1313131213131312ull);
    r = VECTOR_OP("psubb", a, b); CHECK(r[0] == 0x0202020202020202ull && r[1] == 0x3232323232323232ull);
    r = VECTOR_OP("pcmpeqb", a, a); CHECK(r[0] == ~0ull && r[1] == ~0ull);
    r = VECTOR_OP("pcmpeqd", a, b); CHECK(r[0] == 0 && r[1] == 0);
    r = VECTOR_OP("punpcklqdq", a, b); CHECK(r[0] == a[0] && r[1] == b[0]);
    r = VECTOR_OP("punpckhqdq", a, b); CHECK(r[0] == a[1] && r[1] == b[1]);
    r = VECTOR_OP("punpcklbw", a, b); CHECK(r[0] == 0x0f110f110f110f11ull && r[1] == 0x0f110f110f110f11ull);
    vector shuffled;
    __asm__("movdqu %1, %%xmm1\n pshufd $0x1b, %%xmm1, %%xmm0\n movdqu %%xmm0, %0" : "=m"(shuffled) : "m"(a) : "xmm0", "xmm1");
    CHECK(shuffled[0] == 0x2222222222222222ull && shuffled[1] == 0x1111111111111111ull);
    uint32_t mask;
    __asm__("movdqu %1, %%xmm2\n pmovmskb %%xmm2, %0" : "=r"(mask) : "m"(b) : "xmm2"); CHECK(mask == 0xff00);
    /* Between the general registers and the vector ones. */
    uint64_t scalar;
    __asm__("movq %1, %%xmm3\n movq %%xmm3, %0" : "=r"(scalar) : "r"(0x1122334455667788ull) : "xmm3"); CHECK(scalar == 0x1122334455667788ull);
    uint32_t scalar32;
    __asm__("movd %1, %%xmm3\n movd %%xmm3, %0" : "=r"(scalar32) : "r"(0xdeadbeefu) : "xmm3"); CHECK(scalar32 == 0xdeadbeefu);
    __asm__("movq %1, %%xmm4\n movdqu %%xmm4, %0" : "=m"(r) : "r"(0x1234ull) : "xmm4"); CHECK(r[0] == 0x1234 && r[1] == 0);
    double real = 1.5;
    __asm__("movq %1, %0" : "=r"(scalar) : "x"(real)); CHECK(scalar == 0x3ff8000000000000ull);
    __asm__("movq %1, %0" : "=x"(real) : "r"(0x4004000000000000ull)); CHECK(real == 2.5);
    /* Aligned and unaligned, either way. */
    _Alignas(16) uint64_t memory[6] = {1, 2, 3, 4, 5, 6};
    __asm__("movdqa %1, %%xmm5\n movdqa %%xmm5, %0" : "=m"(*(vector *)&memory[4]) : "m"(*(vector *)&memory[0]) : "xmm5"); CHECK(memory[4] == 1 && memory[5] == 2);
    __asm__("movups %1, %%xmm5\n movups %%xmm5, %0" : "=m"(*(vector *)&memory[3]) : "m"(*(vector *)&memory[1]) : "xmm5"); CHECK(memory[3] == 2 && memory[4] == 3);
    __asm__("movaps %1, %%xmm6\n movaps %%xmm6, %%xmm7\n movaps %%xmm7, %0" : "=m"(*(vector *)&memory[0]) : "m"(*(vector *)&memory[2]) : "xmm6", "xmm7"); CHECK(memory[0] == 3 && memory[1] == 2);
    /* The registers past the first eight. */
    __asm__("movdqu %1, %%xmm8\n movdqu %2, %%xmm9\n pxor %%xmm9, %%xmm8\n movdqu %%xmm8, %0" : "=m"(r) : "m"(a), "m"(b) : "xmm8", "xmm9");
    CHECK(r[0] == (a[0] ^ b[0]) && r[1] == (a[1] ^ b[1]));
    __asm__("movdqu (%0), %%xmm15\n movdqu %%xmm15, 16(%0)" : : "r"(memory) : "xmm15", "memory"); CHECK(memory[2] == 3 && memory[3] == 2);
    uint32_t leaf1[4];
    cpuid(1, 0, leaf1);
    if (leaf1[2] & (1u << 1)) {
      /* Carry-less multiplication of the high halves. */
      vector x = {0, 3}, y = {0, 5};
      __asm__("movdqu %1, %%xmm0\n movdqu %2, %%xmm1\n pclmulqdq $0x11, %%xmm1, %%xmm0\n movdqu %%xmm0, %0" : "=m"(r) : "m"(x), "m"(y) : "xmm0", "xmm1");
      CHECK(r[0] == 15 && r[1] == 0);
    }
    if (leaf1[2] & (1u << 9)) {
      vector bytes = {0x0706050403020100ull, 0x0f0e0d0c0b0a0908ull}, reverse = {0x08090a0b0c0d0e0full, 0x0001020304050607ull};
      r = VECTOR_OP("pshufb", bytes, reverse); CHECK(r[0] == 0x08090a0b0c0d0e0full && r[1] == 0x0001020304050607ull);
    }
  }

  printf("%s, %d wrong\n", checks > 50 ? "every check made" : "checks are missing", wrong);
  return wrong != 0;
}
