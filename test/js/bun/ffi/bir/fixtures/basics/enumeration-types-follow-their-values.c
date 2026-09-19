enum small { A, B = 200 };
         enum negative { N = -1, P = 1 };
         enum big { BIG = 0x100000000 };
         enum big_negative { LOW = -0x100000000 };
         enum top { TOP = 0xffffffffffffffffULL };
         int sizes(void) { return sizeof(enum small) * 1000 + sizeof(enum negative) * 100 + sizeof(enum big) * 10 + sizeof(enum top); }
         int wraps(void) { enum small s = A; enum negative n = P; return (s - 1 > 0) * 10 + (n - 2 > 0); }
         long long keeps(void) { enum big b = BIG; enum big_negative l = LOW; return b + l + sizeof(l); }
         struct packed_codes { enum small code : 8; unsigned flag : 1; };
         int code_is_unsigned(void) { struct packed_codes p; p.code = B; return p.code == B; }
         int constants_are_int(void) { return sizeof(A) * 10 + sizeof(BIG); }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)sizes());
  printf("%d\n", (int)wraps());
  printf("%lld\n", (long long)keeps());
  printf("%d\n", (int)code_is_unsigned());
  printf("%d\n", (int)constants_are_int());
  return 0;
}
