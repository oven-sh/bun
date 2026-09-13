int one(void) { return 1; }

int tw\
o(void) { re\
turn 2; } // what??/
int three(void) { return 3; } /* ??/ */
int splice(void) { return 0x1\
0; }
#define STR(x) #x
const char *text(void) { return STR(a   "b\n"   c); }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)one());
  printf("%d\n", (int)two());
  printf("%d\n", (int)three());
  printf("%d\n", (int)splice());
  printf("%s\n", (const char *)text());
  return 0;
}
