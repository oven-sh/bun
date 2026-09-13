struct Item { const char *name; int id; int *slot; };
           static int values[4] = { 10, 20, 30, 40 };
           static int counter = 7;
           int *third = &values[2];
           int *also = values + 1;
           static const char *names[] = { "zero", "one", "two" };
           static struct Item items[] = { { "alpha", 1, &counter }, { .id = 2, .name = "beta", .slot = &values[3] } };
           static char *tail = (char *)values + 12;
           static long as_int = (long)&counter;
           static char message[] = "hi there";
           static const char *mid = "abcdef" + 2;
           extern int later;
           int *plater = &later;
           int later = 99;
           int tentative;
           int tentative;
           static double scale = 2.5, negative = -1.0 / 4;
           static unsigned char bytes[3] = { 255, 256 + 1, -1 };
           static int sized = sizeof(struct Item) + sizeof values;
           enum { A, B = 5, C, D = B * 2 + C };
           static int enums[] = { A, B, C, D };
           static short neg = -2;
           static float f = 3;
           static int zero_array[64];
           static int (*fp)(void);
           int read(void) { return *third + *also + names[2][0] + items[0].name[0] + items[1].name[1] + *items[0].slot + *items[1].slot; }
           int read2(void) { return *(int *)tail + (as_int == (long)&counter) + message[3] + *mid + *plater + tentative; }
           int read3(void) { return (int)(scale * 4 + negative * 4) + bytes[0] + bytes[1] + bytes[2] + sized + enums[3] + neg + (int)f + zero_array[63] + (fp == 0); }
           int bump(void) { static int n = 100; static int *p = &counter; return ++n + (*p)++; }
           int sizeof_names(void) { return sizeof names / sizeof names[0]; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)read());
  printf("%d\n", (int)read2());
  printf("%d\n", (int)read3());
  printf("%d\n", (int)bump());
  printf("%d\n", (int)bump());
  printf("%d\n", (int)sizeof_names());
  return 0;
}
