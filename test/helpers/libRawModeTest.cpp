#include <termios.h>
#include <unistd.h>

extern "C" int tty_is_raw(int fd) {
  if (fd < 0) {
    return -2;
  }
  if (!isatty(fd)) {
    return -3;
  }
  struct termios t;
  tcgetattr(0, &t);
  return (t.c_lflag & (ECHO | ICANON)) == 0;
}

extern "C" int tty_is_raw_async_io(int fd) {
  if (fd < 0) {
    return -2;
  }
  if (!isatty(fd)) {
    return -3;
  }
  struct termios t;
  tcgetattr(0, &t);
  return ((t.c_lflag & (ECHO | ICANON)) | (t.c_oflag & (OPOST))) == 0;
}

extern "C" int isatty(int fd);
