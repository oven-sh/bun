enum { PUSH, ADD, MUL, DUP, JNZ, DEC, SWAP, HALT };
         long long run(const signed char *code) {
             static void *const dispatch[] = { &&op_push, &&op_add, &&op_mul, &&op_dup, &&op_jnz, &&op_dec, &&op_swap, &&op_halt };
             long long stack[16];
             int sp = 0;
             const signed char *pc = code;
         #define NEXT goto *dispatch[*pc++]
             NEXT;
         op_push: stack[sp++] = *pc++; NEXT;
         op_add: sp--; stack[sp - 1] += stack[sp]; NEXT;
         op_mul: sp--; stack[sp - 1] *= stack[sp]; NEXT;
         op_dup: stack[sp] = stack[sp - 1]; sp++; NEXT;
         op_jnz: { int offset = *pc++; if (stack[--sp]) pc += offset; } NEXT;
         op_dec: stack[sp - 1]--; NEXT;
         op_swap: { long long t = stack[sp - 1]; stack[sp - 1] = stack[sp - 2]; stack[sp - 2] = t; } NEXT;
         op_halt: return stack[sp - 1];
         }
         /* Offsets from a base label: the table holds plain integers. */
         int relative(int which) {
             static const int offsets[] = { &&first - &&first, &&second - &&first, &&third - &&first };
             void *target = &&first + offsets[which];
             goto *target;
         first: return 10;
         second: return 20;
         third: return 30;
         }
         int local_table(int i) {
             void *table[2] = { &&zero, &&one };
             void *chosen = table[i & 1];
             if (chosen == &&zero && i == 2) chosen = &&one;
             goto *chosen;
         zero: return 100;
         one: return 200;
         }

int printf(const char *, ...);
static void bun_test_fill(unsigned char *to, const unsigned char *from, int n) {
  for (int i = 0; i < n; i++) to[i] = from[i];
}
static void bun_test_dump(const char *name, const unsigned char *p, int n) {
  printf("%s:", name);
  for (int i = 0; i < n; i++) printf(" %02x", p[i]);
  printf("\n");
}
static unsigned char buffer1[32] __attribute__((aligned(16)));
static unsigned char buffer2[32] __attribute__((aligned(16)));
int main(void) {
  bun_test_fill(buffer1, (const unsigned char[]){0, 1, 0, 2, 2, 0, 3, 2, 0, 4, 2, 0, 5, 2, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, 32);
  printf("%lld\n", (long long)run((void *)buffer1));
  bun_test_fill(buffer2, (const unsigned char[]){0, 0, 0, 4, 6, 0, 3, 1, 6, 5, 3, 4, 247, 6, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, 32);
  printf("%lld\n", (long long)run((void *)buffer2));
  printf("%d\n", (int)relative(0));
  printf("%d\n", (int)relative(1));
  printf("%d\n", (int)relative(2));
  printf("%d\n", (int)local_table(0));
  printf("%d\n", (int)local_table(1));
  printf("%d\n", (int)local_table(2));
  return 0;
}
