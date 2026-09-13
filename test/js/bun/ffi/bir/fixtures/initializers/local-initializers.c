struct P { int x, y; };
           struct L { struct P a, b; int tail[3]; };
           int designated(void) { int a[8] = { [2] = 5, 6, [6] = 9, [0] = 1 }; return a[0] + a[1] * 10 + a[2] * 100 + a[3] * 1000 + a[6] * 10000 + a[7]; }
           int unsized(void) { int a[] = { 1, 2, 3, 4, 5 }; return sizeof a / sizeof a[0]; }
           int unsized_designated(void) { int a[] = { [4] = 1, 2 }; return sizeof a / sizeof *a; }
           int brace_elision(void) { struct L l = { 1, 2, 3, 4, 5, 6 }; return l.a.x + l.a.y * 10 + l.b.x * 100 + l.b.y * 1000 + l.tail[0] * 10000 + l.tail[1] * 100000 + l.tail[2]; }
           int nested_braces(void) { struct L l = { { 1 }, { .y = 4 }, { 5 } }; return l.a.x + l.a.y * 10 + l.b.x * 100 + l.b.y * 1000 + l.tail[0] * 10000 + l.tail[2]; }
           int nested_designators(void) { struct L l = { .b.y = 7, 8, .a = { 1, 2 }, .tail[1] = 3, 4 }; return l.a.x + l.a.y * 10 + l.b.y * 100 + l.tail[0] * 1000 + l.tail[1] * 10000 + l.tail[2] * 100000; }
           int zero_fill(void) { int a[100] = { 1 }; struct L l = { 0 }; int s = 0; for (int i = 0; i < 100; i++) s += a[i]; return s + l.tail[2] + l.b.y; }
           int char_arrays(void) { char a[] = "hey"; char b[8] = "ab"; char c[3] = "xyz"; char d[] = { "q" }; return sizeof a * 1000 + b[1] + b[2] + b[7] + c[2] + sizeof d * 100000; }
           int matrix(void) { int m[2][3] = { { 1, 2, 3 }, { 4 } }; int n[2][3] = { 1, 2, 3, 4 }; return m[1][0] * 10 + m[1][2] + n[1][0] * 100 + n[0][2] * 1000; }
           int struct_array(void) { struct P ps[] = { { 1, 2 }, { 3, 4 }, [3] = { .y = 9 } }; return sizeof ps / sizeof ps[0] * 100 + ps[1].x + ps[3].y + ps[2].x; }
           int from_expr(int k) { struct P p = { k, k * 2 }; struct P q = p; int arr[2] = { p.x + 1, q.y + 1 }; return arr[0] * 100 + arr[1]; }
           int scalar_braces(void) { int x = { 5 }; double d = { 1.5 }; return x + (int)(d * 2); }
           int union_init(void) { union { int i; char c[4]; } u = { 0x01020304 }, v = { .c = { 9, 8 } }; return u.c[0] + v.c[1] * 10 + v.c[3]; }
           int shadow(void) { int x = 1; { int x = 2; { int x = 3; if (x != 3) return -1; } if (x != 2) return -2; } return x; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)designated());
  printf("%d\n", (int)unsized());
  printf("%d\n", (int)unsized_designated());
  printf("%d\n", (int)brace_elision());
  printf("%d\n", (int)nested_braces());
  printf("%d\n", (int)nested_designators());
  printf("%d\n", (int)zero_fill());
  printf("%d\n", (int)char_arrays());
  printf("%d\n", (int)matrix());
  printf("%d\n", (int)struct_array());
  printf("%d\n", (int)from_expr(4));
  printf("%d\n", (int)scalar_braces());
  printf("%d\n", (int)union_init());
  printf("%d\n", (int)shadow());
  return 0;
}
