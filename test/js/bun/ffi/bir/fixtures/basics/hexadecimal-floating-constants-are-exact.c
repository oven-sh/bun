double tiny(void) { return 0x1.0p-1021; } double least_normal(void) { return 0x1.0p-1022; }
         double least(void) { return 0x1p-1074; } double below(void) { return 0x1p-1075; } double just_above(void) { return 0x1.0000000000001p-1075; }
         double subnormal(void) { return 0x0.0000000000001p-1022; } double big(void) { return 0x1.fffffffffffffp+1023; }
         double over(void) { return 0x1p+1024; } double tie_even(void) { return 0x1.00000000000008p0; } double tie_odd(void) { return 0x1.00000000000018p0; }
         double sticky(void) { return 0x1.000000000000080000000000000001p0; } double plain(void) { return 0x1.8p1; }
         float single(void) { return 0x1.fffffep+127f; }

int printf(const char *, ...);
int main(void) {
  printf("%.17g\n", (double)tiny());
  printf("%.17g\n", (double)least_normal());
  printf("%.17g\n", (double)least());
  printf("%.17g\n", (double)below());
  printf("%.17g\n", (double)just_above());
  printf("%.17g\n", (double)subnormal());
  printf("%.17g\n", (double)big());
  printf("%.17g\n", (double)over());
  printf("%.17g\n", (double)tie_even());
  printf("%.17g\n", (double)tie_odd());
  printf("%.17g\n", (double)sticky());
  printf("%.17g\n", (double)plain());
  printf("%.9g\n", (double)single());
  return 0;
}
