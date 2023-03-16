#include <stdio.h>
#include <termios.h>

extern "C" int tty_is_raw() {
  struct termios t;
  tcgetattr(0, &t);
  return !(t.c_lflag & (ICANON) && t.c_lflag & (ECHO));
}
