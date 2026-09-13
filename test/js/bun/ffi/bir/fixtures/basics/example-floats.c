// float/double arithmetic and conversions.

double lerp(double a, double b, double t) {
    return a + (b - a) * t;
}

float average3(float a, float b, float c) {
    return (a + b + c) / 3.0f;
}

double my_sqrt(double x) {
    if (x <= 0) return 0;
    double guess = x > 1 ? x / 2 : 1;
    for (int i = 0; i < 40; i++) guess = (guess + x / guess) / 2;
    return guess;
}

int round_to_int(double d) {
    return (int)(d < 0 ? d - 0.5 : d + 0.5);
}

double int_ratio(int a, int b) {
    return (double)a / b;
}

unsigned to_unsigned(double d) { return (unsigned)d; }
double from_unsigned(unsigned u) { return u; }
double from_u64(unsigned long long u) { return u; }
float narrow(double d) { return (float)d; }

void matmul2(const double *a, const double *b, double *out) {
    for (int i = 0; i < 2; i++)
        for (int j = 0; j < 2; j++) {
            double s = 0;
            for (int k = 0; k < 2; k++) s += a[i * 2 + k] * b[k * 2 + j];
            out[i * 2 + j] = s;
        }
}

double mat_trace_of_square(double a, double b, double c, double d) {
    double m[4] = { a, b, c, d }, sq[4];
    matmul2(m, m, sq);
    return sq[0] + sq[3];
}

int printf(const char *, ...);
int main(void) {
  printf("%.17g\n", (double)lerp(0x1.0000000000000p+1, 0x1.4000000000000p+3, 0x1.0000000000000p-2));
  printf("%.9g\n", (double)average3(0x1.0000000000000p+0f, 0x1.0000000000000p+1f, 0x1.8000000000000p+2f));
  printf("%.17g\n", (double)my_sqrt(0x1.0000000000000p+1));
  printf("%d\n", (int)round_to_int(-0x1.4000000000000p+1));
  printf("%d\n", (int)round_to_int(0x1.3333333333333p+1));
  printf("%.17g\n", (double)int_ratio(1, 4));
  printf("%d\n", (int)to_unsigned(0x1.65a0bc0000000p+31));
  printf("%.17g\n", (double)from_unsigned(-294967296));
  printf("%.17g\n", (double)from_u64(-1LL));
  printf("%.9g\n", (double)narrow(0x1.999999999999ap-4));
  printf("%.17g\n", (double)mat_trace_of_square(0x1.0000000000000p+0, 0x1.0000000000000p+1, 0x1.8000000000000p+1, 0x1.0000000000000p+2));
  return 0;
}
