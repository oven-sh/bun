#include <complex.h>
        #include <math.h>
        double magnitude(double re, double im) { double complex z = re + im * I; return cabs(z); }
        double euler(void) { double complex z = cexp(I * M_PI); return creal(z) * 1000 + fabs(cimag(z)) * 1e6 < 1 ? creal(z) : 99; }
        double conjugate(double re, double im) { double complex z = conj(re + im * I); return creal(z) * 100 + cimag(z); }
        float single(float re, float im) { float complex z = conjf(re + im * I); return cabsf(z) + cimagf(z) * 100 + crealf(z) * 10000; }
        double root(void) { double complex r = csqrt(-4.0 + 0.0 * I); return creal(r) * 10 + cimag(r); }
        int is_complex(void) { return sizeof(_Complex_I) == sizeof(float complex) && cimagf(_Complex_I) == 1.0f; }

int printf(const char *, ...);
int main(void) {
  printf("%.17g\n", (double)magnitude(0x1.8000000000000p+1, 0x1.0000000000000p+2));
  printf("%.17g\n", (double)euler());
  printf("%.17g\n", (double)conjugate(0x1.0000000000000p+1, 0x1.c000000000000p+2));
  printf("%.9g\n", (double)single(0x1.8000000000000p+1f, 0x1.0000000000000p+2f));
  printf("%.17g\n", (double)root());
  printf("%d\n", (int)is_complex());
  return 0;
}
