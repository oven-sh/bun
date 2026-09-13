static void matmul(int n, const double *a, const double *b, double *c) {
             for (int i = 0; i < n; i++)
                 for (int j = 0; j < n; j++) {
                     double s = 0;
                     for (int k = 0; k < n; k++) s += a[i * n + k] * b[k * n + j];
                     c[i * n + j] = s;
                 }
         }
         double run(void) {
             double a[2][2] = { { 1, 2 }, { 3, 4 } }, b[2][2] = { { 0.5, 0 }, { 0, 0.25 } }, c[2][2];
             matmul(2, &a[0][0], &b[0][0], &c[0][0]);
             return c[0][0] * 1000 + c[0][1] * 100 + c[1][0] * 10 + c[1][1];
         }

int printf(const char *, ...);
int main(void) {
  printf("%.17g\n", (double)run());
  return 0;
}
