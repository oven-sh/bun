// C11 7.14 <signal.h>: a handler written in C is installed, called by the library when the signal is raised, and
// taken off again; sig_atomic_t; SIG_DFL, SIG_IGN and SIG_ERR are distinct from any function.
#include <signal.h>
#include <stdio.h>

static volatile sig_atomic_t received, calls;
static void handler(int number) { received = number; calls++; }
static void other_handler(int number) { received = -number; calls += 10; }

int main(void) {
  void (*previous)(int) = signal(SIGTERM, handler);
  printf("%d %d\n", previous != SIG_ERR, handler != SIG_DFL && handler != SIG_IGN && SIG_DFL != SIG_IGN && SIG_IGN != SIG_ERR);
  int raised = raise(SIGTERM);
  printf("%d %d %d\n", raised, received == SIGTERM, (int)calls);
  // Whether the handler stays installed after a call is the implementation's choice: install it again.
  void (*replaced)(int) = signal(SIGTERM, other_handler);
  printf("%d\n", replaced == handler || replaced == SIG_DFL);
  raise(SIGTERM);
  printf("%d %d\n", received == -SIGTERM, (int)calls);
  // An ignored signal does nothing; and the first disposition goes back.
  signal(SIGTERM, SIG_IGN);
  raised = raise(SIGTERM);
  printf("%d %d\n", raised, (int)calls);
  signal(SIGTERM, previous);
  int numbers[] = {SIGABRT, SIGFPE, SIGILL, SIGINT, SIGSEGV, SIGTERM};
  int distinct = 1;
  for (int i = 0; i < 6; i++) for (int j = 0; j < i; j++) distinct &= numbers[i] != numbers[j] && numbers[i] > 0;
  printf("%d %d\n", distinct, (int)sizeof(sig_atomic_t) >= 1);
  return 0;
}
