int sum_goto(int n) { int s = 0, i = 0; top: if (i >= n) goto done; s += i; i++; goto top; done: return s; }
         int forward(int x) { if (x) goto skip; x = 100; skip: return x + 1; }
         int out_of_nested(int n) {
             int found = -1;
             for (int i = 0; i < n; i++) for (int j = 0; j < n; j++) if (i * j == 12) { found = i * 10 + j; goto out; }
             out: return found;
         }
         int into_block(int x) { goto inside; { x = 0; inside: x += 5; } return x; }
         int label_at_end(int x) { if (x) goto end; x = 3; end: ; return x; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)sum_goto(10));
  printf("%d\n", (int)forward(0));
  printf("%d\n", (int)forward(5));
  printf("%d\n", (int)out_of_nested(10));
  printf("%d\n", (int)into_block(1));
  printf("%d\n", (int)label_at_end(0));
  return 0;
}
