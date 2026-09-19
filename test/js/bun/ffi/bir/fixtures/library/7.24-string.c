// C11 7.24 <string.h>: every function, against expected results; several are builtins a compiler may expand itself.
#include <stdio.h>
#include <string.h>

static int checks, wrong;
// Every check says what it checked and whether it held; the test compares that, line by line, with values.json.
#define CHECK(c) do { int holds = (c) ? 1 : 0; checks++; wrong += !holds; printf("%s => %d\n", #c, holds); } while (0)
static int sign(int v) { return (v > 0) - (v < 0); }

int main(void) {
  char buffer[32], other[32];
  volatile size_t three = 3;          // so that sizes are not all constants
  // Copying.
  CHECK(memcpy(buffer, "abcdef", 7) == buffer && strcmp(buffer, "abcdef") == 0);
  CHECK(memmove(buffer + 2, buffer, 4) == buffer + 2 && memcmp(buffer, "ababcd", 7) == 0);     // overlapping, forward
  CHECK(memmove(buffer, buffer + 1, 5) == buffer && memcmp(buffer, "babcdd", 6) == 0);         // and backward
  CHECK(strcpy(other, "hello") == other && other[5] == 0);
  memset(buffer, 'x', sizeof buffer);
  CHECK(strncpy(buffer, "hi", 5) == buffer && buffer[1] == 'i' && buffer[2] == 0 && buffer[4] == 0 && buffer[5] == 'x');       // pads with zeros
  CHECK(strncpy(buffer, "truncated", three) == buffer && buffer[2] == 'u' && buffer[3] == 0);                                  // (what was there stays)
  memcpy(buffer, "abc", three + 1);
  CHECK(buffer[3] == 0 && strlen(buffer) == 3);
  // Concatenation.
  strcpy(buffer, "one");
  CHECK(strcat(buffer, " two") == buffer && strcmp(buffer, "one two") == 0);
  CHECK(strncat(buffer, " three and more", 6) == buffer && strcmp(buffer, "one two three") == 0);
  // Comparison.
  CHECK(memcmp("abc", "abd", 3) < 0 && memcmp("abc", "abd", 2) == 0 && memcmp("\xff", "\x01", 1) > 0);       // as unsigned char
  CHECK(sign(strcmp("apple", "apply")) == -1 && strcmp("same", "same") == 0 && sign(strcmp("b", "a")) == 1 && sign(strcmp("ab", "a")) == 1);
  CHECK(strncmp("prefix-one", "prefix-two", 7) == 0 && strncmp("prefix-one", "prefix-two", 8) < 0 && strncmp("a", "b", 0) == 0);
  CHECK(sign(strcoll("a", "b")) == -1);
  CHECK(strxfrm(other, "xyz", sizeof other) == 3 && strcmp(other, "xyz") == 0 && strxfrm(0, "abcd", 0) == 4);
  // Searching.
  const char *text = "the quick brown fox";
  CHECK(memchr(text, 'q', 19) == text + 4 && memchr(text, 'q', 4) == 0 && memchr(text, 0, 20) == text + 19);
  CHECK(strchr(text, 'o') == text + 12 && strrchr(text, 'o') == text + 17 && strchr(text, 'z') == 0 && strchr(text, 0) == text + 19 && strrchr(text, 't') == text);
  CHECK(strspn(text, "the ") == 4 && strcspn(text, "xq") == 4 && strcspn(text, "") == 19 && strspn(text, "") == 0);
  CHECK(strpbrk(text, "kcu") == text + 5 && strpbrk(text, "XYZ") == 0);
  CHECK(strstr(text, "brown") == text + 10 && strstr(text, "") == text && strstr(text, "browny") == 0 && strstr(text, "the") == text);
  // Tokens: strtok keeps its place between calls and writes into the string.
  char sentence[] = "  split,these;;words ";
  char *word = strtok(sentence, " ,;");
  int count = 0; size_t letters = 0;
  while (word) { count++; letters += strlen(word); word = strtok(0, " ,;"); }
  CHECK(count == 3 && letters == 15 && sentence[7] == 0);
  // Miscellaneous.
  CHECK(memset(buffer, 0x5a, 8) == buffer && buffer[0] == 0x5a && buffer[7] == 0x5a && (memset(buffer, 0, three), buffer[2] == 0 && buffer[3] == 0x5a));
  CHECK(strlen("") == 0 && strlen("four") == 4 && strlen("embedded\0zero") == 8);
  CHECK(strerror(0) != 0 && strlen(strerror(1)) > 0);
  // The same through pointers to the functions, where no builtin can stand in.
  void *(*copy)(void *, const void *, size_t) = memcpy;
  size_t (*length)(const char *) = strlen;
  int (*compare)(const char *, const char *) = strcmp;
  char *(*find)(const char *, int) = strchr;
  copy(buffer, "through a pointer", 18);
  CHECK(length(buffer) == 17 && compare(buffer, "through a pointer") == 0 && find(buffer, 'p') == buffer + 10);
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}
