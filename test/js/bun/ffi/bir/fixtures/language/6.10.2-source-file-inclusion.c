// C11 6.10.2: #include with "quotes", with <brackets>, and with a name made by macros; a file may be included
// again and again unless it guards itself.
#include <stdio.h>
#include <string.h>

#include "6.10.2-included.h"
#define included_file included_file_2
#define LINE_INSIDE LINE_INSIDE_2
#define HEADER "6.10.2-included.h"
#include HEADER
#undef included_file
#undef LINE_INSIDE
#define included_file included_file_3
#define LINE_INSIDE LINE_INSIDE_3
#define QUOTE(x) #x
#define AS_STRING(x) QUOTE(x)
#define NAME 6.10.2-included.h
#include AS_STRING(NAME)
#undef included_file
#undef LINE_INSIDE

// The header that says `#pragma once` is read once however it is named.
#include "6.10.2-included-once.h"
#include "./6.10.2-included-once.h"
#define ONCE "6.10.2-included-once.h"
#include ONCE

// A standard header named through a macro, with brackets.
#define STANDARD <limits.h>
#include STANDARD
#include <stddef.h>

int main(void) {
  printf("%d %d %d\n", INCLUDED_TIMES, LINE_INSIDE_3 == 20, INCLUDE_LEVEL_INSIDE);
  const char *tail = strrchr(included_file, '/');
  tail = tail ? tail + 1 : included_file;
  const char *backslash = strrchr(tail, '\\');
  printf("%s %d\n", backslash ? backslash + 1 : tail, strcmp(included_file_2, included_file_3) == 0);
  printf("%d %d %d\n", included_once_counter, CHAR_BIT, (int)sizeof(size_t) == (int)sizeof(void *));
#if defined __has_include
#if __has_include("6.10.2-included.h") && __has_include(<stdio.h>) && !__has_include("no-such-file.h") && !__has_include(<no/such/file.h>)
  printf("__has_include\n");
#endif
#endif
  return 0;
}
