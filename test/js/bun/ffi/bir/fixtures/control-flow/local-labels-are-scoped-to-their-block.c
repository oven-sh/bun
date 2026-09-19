#define FIND(array, n, key, out) ({ __label__ found, done; int i_; \
             for (i_ = 0; i_ < (n); i_++) if ((array)[i_] == (key)) goto found; \
             (out) = -1; goto done; found: (out) = i_; done: ; (out); })
         int both(void) {
             int a[4] = { 5, 6, 7, 8 }, first, second;
             FIND(a, 4, 7, first);
             FIND(a, 4, 9, second);
             return first * 10 + second;
         }
         int nested(int x) {
             __label__ out;
             { __label__ out; if (x) goto out; x = 100; out: x += 1; }
             if (x > 50) goto out;
             x += 1000;
             out: return x;
         }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)both());
  printf("%d\n", (int)nested(0));
  printf("%d\n", (int)nested(1));
  return 0;
}
