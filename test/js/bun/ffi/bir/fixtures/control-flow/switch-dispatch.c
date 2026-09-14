int classify(int x) {
             switch (x) {
                 case 0: return 100;
                 case 1:
                 case 2: return 200;
                 case -5: return 300;
                 case 1000000: return 400;
                 default: return -1;
             }
         }
         int fallthrough(int x) {
             int r = 0;
             switch (x) { case 3: r += 3; case 2: r += 2; case 1: r += 1; break; case 0: r = 50; break; default: r = 99; }
             return r;
         }
         int nested(int a, int b) {
             switch (a) {
                 case 1:
                     switch (b) { case 1: return 11; case 2: return 12; }
                     return 10;
                 case 2: { int k = b * 2; if (k > 5) break; return 20 + k; }
             }
             return 0;
         }
         int on_char(char c) { switch (c) { case 'a': return 1; case 'z': return 26; } return 0; }
         int on_long(long long v) { switch (v) { case 0x100000000LL: return 1; case -1: return 2; } return 3; }
         int on_unsigned(unsigned v) { switch (v) { case 0xffffffffu: return 1; case 0: return 2; } return 3; }
         int no_default(int x) { int r = 5; switch (x) { case 1: r = 6; } return r; }
         int loop_switch(int n) { int s = 0; for (int i = 0; i < n; i++) { switch (i % 3) { case 0: continue; case 1: s += 1; break; default: s += 10; } s += 100; } return s; }
         int duff(int count) {
             int copied = 0; int n = (count + 3) / 4;
             switch (count % 4) {
                 case 0: do { copied++;
                 case 3:      copied++;
                 case 2:      copied++;
                 case 1:      copied++;
                         } while (--n > 0);
             }
             return copied;
         }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)classify(0));
  printf("%d\n", (int)classify(2));
  printf("%d\n", (int)classify(-5));
  printf("%d\n", (int)classify(1000000));
  printf("%d\n", (int)classify(7));
  printf("%d\n", (int)fallthrough(3));
  printf("%d\n", (int)fallthrough(2));
  printf("%d\n", (int)fallthrough(0));
  printf("%d\n", (int)fallthrough(9));
  printf("%d\n", (int)nested(1, 2));
  printf("%d\n", (int)nested(1, 3));
  printf("%d\n", (int)nested(2, 1));
  printf("%d\n", (int)nested(2, 3));
  printf("%d\n", (int)on_char(122));
  printf("%d\n", (int)on_long(4294967296LL));
  printf("%d\n", (int)on_long(-1LL));
  printf("%d\n", (int)on_long(0LL));
  printf("%d\n", (int)on_unsigned(-1));
  printf("%d\n", (int)on_unsigned(0));
  printf("%d\n", (int)no_default(1));
  printf("%d\n", (int)no_default(2));
  printf("%d\n", (int)loop_switch(6));
  printf("%d\n", (int)duff(1));
  printf("%d\n", (int)duff(2));
  printf("%d\n", (int)duff(3));
  printf("%d\n", (int)duff(4));
  printf("%d\n", (int)duff(5));
  printf("%d\n", (int)duff(6));
  printf("%d\n", (int)duff(7));
  printf("%d\n", (int)duff(8));
  printf("%d\n", (int)duff(9));
  printf("%d\n", (int)duff(10));
  printf("%d\n", (int)duff(11));
  return 0;
}
