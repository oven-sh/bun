unsigned char classes[256] = { [0 ... 255] = 7, ['a' ... 'z'] = 1, ['0' ... '9'] = 2, ['_'] = 3 };
         struct cell { int kind; int value; };
         struct cell grid[2][3] = { [0 ... 1][1 ... 2] = { 4, 5 }, [1][0].value = 9 };
         struct cell old_style = { value: 8, kind: 2 };
         int spaced[4] = { [1] 10, [3] 30 };
         int class_of(int c) { return classes[c]; }
         int grid_sum(void) { int s = 0; for (int i = 0; i < 2; i++) for (int j = 0; j < 3; j++) s += grid[i][j].kind * 10 + grid[i][j].value; return s; }
         int local(int seed) { int table[8] = { [2 ... 5] = seed, [7] = 1 }; int s = 0; for (int i = 0; i < 8; i++) s = s * 3 + table[i]; return s; }
         int others(void) { return old_style.kind * 100 + old_style.value * 10 + spaced[1] + spaced[3] + spaced[0]; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)class_of(113));
  printf("%d\n", (int)class_of(53));
  printf("%d\n", (int)class_of(95));
  printf("%d\n", (int)class_of(200));
  printf("%d\n", (int)grid_sum());
  printf("%d\n", (int)local(2));
  printf("%d\n", (int)others());
  return 0;
}
