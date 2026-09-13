double f(void) { double _Complex z = 1.5 + 2.0i; double _Complex old = z++; ++z; z--; float _Complex w = 1.0f; --w;
           return __real__ z * 100 + __imag__ z * 10 + __real__ old + __real__ w + __imag__ w; }

int printf(const char *, ...);
int main(void) {
  printf("%.17g\n", (double)f());
  return 0;
}
