typedef double _Complex dc;
         typedef float _Complex fc;
         static dc make(double re, double im) { return __builtin_complex(re, im); }
         double re_of(dc z) { return __real__ z; }
         double im_of(dc z) { return __imag__ z; }
         static dc global_z = 1.5 + 2.0i;
         static fc global_f = 3.0f - 1.0if;
         dc pair[2] = { 1.0, 2.0i };
         double arithmetic(double a, double b, double c, double d, int which) {
             dc x = make(a, b), y = make(c, d), r;
             switch (which) {
                 case 0: r = x + y; break;
                 case 1: r = x - y; break;
                 case 2: r = x * y; break;
                 case 3: r = x / y; break;
                 case 4: r = -x; break;
                 case 5: r = ~x; break;
                 case 6: r = x + 1; break;
                 case 7: r = 2 * x; break;
                 case 8: r = x; r += y; r *= 2.0; r -= 1.0i; break;
                 default: r = x / 2;
             }
             return __real__ r * 1000 + __imag__ r;
         }
         int compare(double a, double b, double c, double d) {
             dc x = make(a, b), y = make(c, d);
             return (x == y) + (x != y) * 10 + (x ? 100 : 0) + (!y) * 1000 + (x && y) * 10000 + (x == a) * 100000;
         }
         double parts(void) {
             dc z = 0;
             __real__ z = 4.0;
             __imag__ z = -2.5;
             double *im = &__imag__ z;
             *im += 1.0;
             fc narrow = (fc)z;
             dc wide = narrow;
             int truncated = (int)z;
             _Bool any = z;
             return __real__ wide * 100 + __imag__ wide + truncated * 10000 + any * 100000 + __real__ 7 + __imag__ 9.0;
         }
         double globals(void) { return __real__ global_z + __imag__ global_z * 10 + __real__ global_f * 100 + __imag__ global_f * 1000 + __imag__ pair[1] * 10000 + __real__ pair[0] * 100000; }
         float single(float a, float b) { fc z = a + b * 1.0if; z = z * z; return __real__ z + __imag__ z; }
         static fc swap_parts(fc z) { return __builtin_complex(__imag__ z, __real__ z); }
         static dc sum3(dc a, fc b, dc c) { return a + b + c; }
         struct holder { int tag; dc z; fc f; };
         static struct holder hold(dc z) { struct holder h = { 1, z, (fc)z }; return h; }
         double through_calls(void) {
             fc f = swap_parts(1.0f + 2.0if);
             dc s = sum3(1.0 + 1.0i, f, 10.0i);
             struct holder h = hold(s);
             dc (*fp)(dc, fc, dc) = sum3;
             dc t = fp(h.z, h.f, 0);
             return __real__ t * 100 + __imag__ t;
         }
         double chosen(int c) { dc a = 1.0 + 1.0i; double b = 5.0; dc r = c ? a : b; return __real__ r + __imag__ r * 10; }

int printf(const char *, ...);
int main(void) {
  printf("%.17g\n", (double)arithmetic(0x1.8000000000000p+1, 0x1.0000000000000p+2, 0x1.0000000000000p+0, -0x1.0000000000000p+1, 0));
  printf("%.17g\n", (double)arithmetic(0x1.8000000000000p+1, 0x1.0000000000000p+2, 0x1.0000000000000p+0, -0x1.0000000000000p+1, 1));
  printf("%.17g\n", (double)arithmetic(0x1.8000000000000p+1, 0x1.0000000000000p+2, 0x1.0000000000000p+0, -0x1.0000000000000p+1, 2));
  printf("%.17g\n", (double)arithmetic(0x1.8000000000000p+1, 0x1.0000000000000p+2, 0x1.0000000000000p+0, -0x1.0000000000000p+1, 3));
  printf("%.17g\n", (double)arithmetic(0x1.8000000000000p+1, 0x1.0000000000000p+2, 0x1.0000000000000p+0, -0x1.0000000000000p+1, 4));
  printf("%.17g\n", (double)arithmetic(0x1.8000000000000p+1, 0x1.0000000000000p+2, 0x1.0000000000000p+0, -0x1.0000000000000p+1, 5));
  printf("%.17g\n", (double)arithmetic(0x1.8000000000000p+1, 0x1.0000000000000p+2, 0x1.0000000000000p+0, -0x1.0000000000000p+1, 6));
  printf("%.17g\n", (double)arithmetic(0x1.8000000000000p+1, 0x1.0000000000000p+2, 0x1.0000000000000p+0, -0x1.0000000000000p+1, 7));
  printf("%.17g\n", (double)arithmetic(0x1.8000000000000p+1, 0x1.0000000000000p+2, 0x1.0000000000000p+0, -0x1.0000000000000p+1, 8));
  printf("%.17g\n", (double)arithmetic(0x1.8000000000000p+1, 0x1.0000000000000p+2, 0x1.0000000000000p+0, -0x1.0000000000000p+1, 9));
  printf("%d\n", (int)compare(0x1.0000000000000p+0, 0x1.0000000000000p+1, 0x1.0000000000000p+0, 0x1.0000000000000p+1));
  printf("%d\n", (int)compare(0x0.0p+0, 0x1.0000000000000p+1, 0x0.0p+0, 0x0.0p+0));
  printf("%d\n", (int)compare(0x1.4000000000000p+2, 0x0.0p+0, 0x1.0000000000000p+0, 0x0.0p+0));
  printf("%.17g\n", (double)parts());
  printf("%.17g\n", (double)globals());
  printf("%.9g\n", (double)single(0x1.0000000000000p+1f, 0x1.8000000000000p+1f));
  printf("%.17g\n", (double)through_calls());
  printf("%.17g\n", (double)chosen(1));
  printf("%.17g\n", (double)chosen(0));
  return 0;
}
