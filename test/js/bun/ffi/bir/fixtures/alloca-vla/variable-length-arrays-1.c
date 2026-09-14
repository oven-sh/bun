typedef __SIZE_TYPE__ size_t;
         int sum(int n) {
             int a[n];
             for (int i = 0; i < n; i++) a[i] = i * 3;
             int s = 0;
             for (int i = 0; i < n; i++) s += a[i];
             return s * 100 + (int)sizeof(a) + (int)(sizeof a / sizeof a[0]);
         }
         int matrix(int r, int c) {
             int m[r][c];
             for (int i = 0; i < r; i++) for (int j = 0; j < c; j++) m[i][j] = i * 10 + j;
             int (*row)[c] = m;
             row++;
             int (*last)[c] = &m[r - 1];
             return m[r - 1][c - 1] + (*row)[1] * 100 + (int)sizeof(m) * 1000 + (int)sizeof(m[0]) * 100000
                 + (int)(last - m) * 10000000 + (int)(row-- - m) * 100000000;
         }
         int three(int a, int b, int c) {
             char cube[a][b][c];
             int n = 0;
             for (int i = 0; i < a; i++) for (int j = 0; j < b; j++) for (int k = 0; k < c; k++) cube[i][j][k] = (char)n++;
             return cube[a - 1][b - 1][c - 1] + (int)sizeof(cube) * 100 + (int)sizeof(cube[0]) * 100000 + (int)sizeof(cube[0][0]) * 10000000;
         }
         static void fill(int n, int m[n][n], int v) { for (int i = 0; i < n; i++) for (int j = 0; j < n; j++) m[i][j] = v + i * n + j; }
         static int trace(int n, int m[static n][n]);
         static long total(size_t rows, size_t cols, long grid[*][*]);
         int square(int n) {
             int m[n][n];
             fill(n, m, 1);
             long grid[2][n];
             for (int j = 0; j < n; j++) { grid[0][j] = j; grid[1][j] = 100 * j; }
             return trace(n, m) + (int)total(2, n, grid) * 1000;
         }
         static int trace(int n, int m[n][n]) { int t = 0; for (int i = 0; i < n; i++) t += m[i][i]; return t + (int)sizeof(m[0]) * 0; }
         static long total(size_t rows, size_t cols, long grid[rows][cols]) {
             long t = 0;
             for (size_t i = 0; i < rows; i++) for (size_t j = 0; j < cols; j++) t += grid[i][j];
             return t + (long)(sizeof(*grid) / sizeof(long)) * 0;
         }
         int typedefs(int n) {
             typedef int row_t[n];
             n = 100;
             row_t a, b;
             row_t *p = &a;
             for (int i = 0; i < (int)(sizeof(row_t) / sizeof(int)); i++) { a[i] = i; b[i] = 2 * i; }
             return (int)sizeof(row_t) + (*p)[3] * 100 + b[4] * 1000 + (int)sizeof(int[n]) * 10000;
         }
         int evaluated(int n) { int calls = 0; size_t s = sizeof(char[(calls++, n)]); size_t t = sizeof(int[3]); return (int)(s + t) * 10 + calls; }
         int heap(int n) { void *malloc(size_t); void free(void *); int (*p)[n] = malloc(sizeof(int[4][n])); p[3][n - 1] = 7; int v = p[3][n - 1] + (int)sizeof(*p); free(p); return v; }
         struct point { short x, y; };
         int structs(int n) { struct point pts[n]; for (int i = 0; i < n; i++) { pts[i].x = (short)i; pts[i].y = (short)-i; } return pts[n - 1].x - pts[n - 1].y + (int)sizeof pts; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)sum(10));
  printf("%d\n", (int)matrix(3, 4));
  printf("%d\n", (int)three(2, 3, 4));
  printf("%d\n", (int)square(3));
  printf("%d\n", (int)typedefs(6));
  printf("%d\n", (int)evaluated(5));
  printf("%d\n", (int)heap(5));
  printf("%d\n", (int)structs(4));
  return 0;
}
