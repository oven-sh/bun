static int my_strlen(const char *s) { int n = 0; while (*s++) n++; return n; }
           static int my_strcmp(const char *a, const char *b) {
               while (*a && *a == *b) { a++; b++; }
               return (unsigned char)*a - (unsigned char)*b;
           }
           int len_hello(void) { return my_strlen("hello"); }
           int len_concat(void) { return my_strlen("abc" "def" "\n"); }
           int cmp(void) { return my_strcmp("apple", "apple") == 0 && my_strcmp("a", "b") < 0 && my_strcmp("b", "a") > 0; }
           int escapes(void) { const char *s = "\x41\101\n\t\\\"\0zz"; return s[0] + s[1] + s[2] + s[3] + s[4] + s[5] + s[6]; }
           int char_consts(void) { return 'a' + '\n' + '\x41' + '\0' + '\'' + '\\'; }
           int sizeof_lit(void) { return sizeof("hello") + sizeof "ab"; }
           int index_lit(void) { return "hello"[1]; }
           int count_char(const char *s, int c) { int n = 0; for (; *s; s++) if (*s == c) n++; return n; }
           int count_l(void) { return count_char("hello world", 'l'); }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)len_hello());
  printf("%d\n", (int)len_concat());
  printf("%d\n", (int)cmp());
  printf("%d\n", (int)escapes());
  printf("%d\n", (int)char_consts());
  printf("%d\n", (int)sizeof_lit());
  printf("%d\n", (int)index_lit());
  printf("%d\n", (int)count_l());
  return 0;
}
