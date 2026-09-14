// What Microsoft C lets a header define: every unit that includes it has the definitions, and the program one of each.
__inline int *counter(void) {
  static int count = 5;
  return &count;
}
__inline int twice(int x) { return x + x; }
__declspec(selectany) int one_value = 42;
__declspec(selectany) const char *const one_name = "shared";
