// C11 7.27 <time.h>: the arithmetic types, struct tm by pointer and by value, and the conversions that do not
// depend on when or where the program runs.
#include <stdio.h>
#include <string.h>
#include <time.h>

static struct tm the_day_after(struct tm day) { day.tm_mday += 1; return day; }

int main(void) {
  // time_t and clock_t are arithmetic types; the clock does not run backwards.
  time_t now = time(0), also_now;
  time(&also_now);
  clock_t before = clock();
  printf("%d %d %d\n", now > 1600000000, difftime(also_now, now) >= 0 && difftime(also_now, now) < 5, clock() >= before && CLOCKS_PER_SEC > 0);
  // A fixed moment, broken down in UTC: 2001-09-09 01:46:40, a Sunday, day 251 of the year.
  time_t moment = 1000000000;
  struct tm *utc = gmtime(&moment);
  struct tm copy = *utc;
  printf("%d-%02d-%02d %02d:%02d:%02d %d %d %d\n", copy.tm_year + 1900, copy.tm_mon + 1, copy.tm_mday, copy.tm_hour, copy.tm_min, copy.tm_sec, copy.tm_wday, copy.tm_yday, copy.tm_isdst);
  // A structure by value, in and out; mktime normalizes (in local time, so only the date parts that cannot shift).
  struct tm next = the_day_after(copy);
  printf("%d %d\n", next.tm_mday, copy.tm_mday);
  struct tm overflowing = {.tm_year = 101, .tm_mon = 0, .tm_mday = 32, .tm_hour = 12, .tm_isdst = -1};
  time_t normalized = mktime(&overflowing);
  printf("%d %d %d %d %d\n", normalized != (time_t)-1, overflowing.tm_mon, overflowing.tm_mday, overflowing.tm_wday, overflowing.tm_yday);
  // strftime in the "C" locale, and asctime's fixed format.
  char text[64];
  size_t length = strftime(text, sizeof text, "%Y-%m-%d %H:%M:%S %a %b %j %%", &copy);
  printf("%s %d\n", text, (int)length);
  printf("%d %s", strftime(text, 4, "%Y-%m-%d", &copy) == 0, asctime(&copy));
  struct timespec precise;
  int base = timespec_get(&precise, TIME_UTC);
  printf("%d %d\n", base == TIME_UTC, precise.tv_sec >= now && precise.tv_nsec >= 0 && precise.tv_nsec < 1000000000);
  return 0;
}
