#include <signal.h>
#include <unistd.h>

int main(void) {
  usleep(250000);
  kill(getppid(), SIGUSR1);
  return 0;
}
