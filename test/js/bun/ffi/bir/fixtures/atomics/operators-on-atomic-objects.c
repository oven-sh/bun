_Atomic int counter = 10;
         _Atomic unsigned char small = 250;
         _Atomic short half = -32768;
         _Atomic long long wide = 1;
         _Atomic float real = 1.5f;
         _Atomic double precise;
         _Atomic _Bool flag;
         _Atomic(int *) cursor;
         int *_Atomic also_cursor;
         static int slots[8];
         struct Stats { _Atomic int hits; int plain; _Atomic long long bytes; };
         static struct Stats stats = { .hits = 3, .bytes = 1000 };
         int read(void) { return counter; }
         int assign(int v) { return counter = v; }
         int add_assign(int v) { return counter += v; }
         int sub_assign(int v) { return counter -= v; }
         int post_inc(void) { return counter++; }
         int pre_dec(void) { return --counter; }
         int bitwise(void) { counter = 0xf0; counter &= 0x3c; counter |= 1; counter ^= 0xff; return counter; }
         int multiply(int v) { return counter *= v; }
         int divide(int v) { counter /= v; return counter; }
         int modulo(int v) { return counter %= v; }
         int shifts(void) { counter = 3; counter <<= 4; int a = counter; counter >>= 2; return a * 100 + counter; }
         int mixed(void) { counter = 7; counter *= 1.5; return counter; }
         int wrap_small(void) { int a = small++; int b = small += 10; small -= 20; return a * 1000000 + b * 1000 + small; }
         int wrap_half(void) { half--; int a = half; half += 2; return a * 2 + (half == -32767); }
         long long wide_ops(void) { wide <<= 40; wide += 5; wide *= 3; return wide--; }
         float real_ops(float v) { real += v; real *= 2.0f; float old = real++; return old + real; }
         double precise_ops(void) { precise = 0.5; precise -= 2.0; precise /= 4.0; return precise; }
         int flag_ops(void) { flag = 5; int a = flag; flag ^= 1; int b = flag; flag |= 2; return a * 100 + b * 10 + flag; }
         int cursor_ops(void) {
             cursor = slots; cursor += 3; int *a = cursor++; int *b = --cursor; cursor -= 1;
             also_cursor = slots + 7; also_cursor--;
             return (int)(a - slots) * 1000 + (int)(b - slots) * 100 + (int)(cursor - slots) * 10 + (int)(also_cursor - slots);
         }
         int members(struct Stats *s) { s->hits++; s->bytes += 24; s->plain = s->hits; return s->plain + (int)s->bytes; }
         int member_ops(void) { return members(&stats); }
         int local_atomic(int v) { _Atomic int local = v; local += 2; _Atomic int other = local; return other++ + local; }
         int sizes(void) { return sizeof(counter) * 1000 + sizeof(small) * 100 + sizeof(wide) * 10 + _Alignof(_Atomic short); }
         int in_expression(int v) { counter = v; return counter + counter * 2 + (counter > 3 ? 100 : 0) + !counter; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)read());
  printf("%d\n", (int)assign(5));
  printf("%d\n", (int)add_assign(7));
  printf("%d\n", (int)sub_assign(2));
  printf("%d\n", (int)post_inc());
  printf("%d\n", (int)pre_dec());
  printf("%d\n", (int)bitwise());
  printf("%d\n", (int)assign(6));
  printf("%d\n", (int)multiply(7));
  printf("%d\n", (int)divide(-5));
  printf("%d\n", (int)modulo(3));
  printf("%d\n", (int)shifts());
  printf("%d\n", (int)mixed());
  printf("%d\n", (int)wrap_small());
  printf("%d\n", (int)wrap_half());
  printf("%lld\n", (long long)wide_ops());
  printf("%.9g\n", (double)real_ops(0x1.0000000000000p-2f));
  printf("%.17g\n", (double)precise_ops());
  printf("%d\n", (int)flag_ops());
  printf("%d\n", (int)cursor_ops());
  printf("%d\n", (int)member_ops());
  printf("%d\n", (int)local_atomic(5));
  printf("%d\n", (int)sizes());
  printf("%d\n", (int)in_expression(4));
  printf("%d\n", (int)in_expression(0));
  return 0;
}
