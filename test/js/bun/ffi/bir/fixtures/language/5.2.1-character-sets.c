// C11 5.2.1 and 5.2.2: the characters every program can use, and what the escape sequences are.
#include <stdio.h>
#include <string.h>

int main(void) {
  // The 26 + 26 letters and 10 digits are distinct, positive, and the digits are consecutive.
  const char *upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ", *lower = "abcdefghijklmnopqrstuvwxyz", *digits = "0123456789";
  const char *graphic = "!\"#%&'()*+,-./:;<=>?[\\]^_{|}~";
  int positive = 1, consecutive = 1;
  for (const char *set = upper; set; set = set == upper ? lower : set == lower ? digits : set == digits ? graphic : 0)
    for (const char *p = set; *p; p++) positive &= *p > 0;
  for (int i = 0; i < 9; i++) consecutive &= digits[i + 1] == digits[i] + 1;
  printf("%d %d %d\n", positive, consecutive, (int)(strlen(upper) + strlen(lower) + strlen(digits) + strlen(graphic)));
  // The null character is all bits zero; the control characters have their escapes.
  printf("%d %d %d %d %d %d %d %d\n", '\0', '\a', '\b', '\f', '\n', '\r', '\t', '\v');
  printf("%d %d %d %d %d\n", '\'', '\"', '\?', '\\', '"');
  // Octal escapes take up to three digits, hexadecimal ones as many as there are.
  printf("%d %d %d %d %d\n", '\7', '\77', '\101', '\x41', (unsigned char)'\xff');
  printf("%d %d\n", (int)sizeof("\1234") - 1, "\1234"[1]);
  printf("%d %d\n", (int)sizeof("\x0000041") - 1, "\x0000041"[0]);
  // Universal character names in literals are UTF-8 in a plain string.
  const unsigned char *euro = (const unsigned char *)"€", *beyond = (const unsigned char *)"\U0001F600";
  printf("%d %02x %02x %02x | %d %02x %02x %02x %02x\n", (int)strlen((const char *)euro), euro[0], euro[1], euro[2],
         (int)strlen((const char *)beyond), beyond[0], beyond[1], beyond[2], beyond[3]);
  printf("%d %d\n", (int)sizeof("café") - 1, (int)sizeof(u8"café") - 1);
  // Bytes of the source that are not ASCII pass through a string unchanged.
  printf("%d\n", (int)sizeof("é") - 1);
  return 0;
}
