typedef struct FILE FILE;
extern FILE *stdout, *stderr;
extern char **environ;
extern int counter_elsewhere;
int printf(const char *, ...);
static FILE **where = &stdout;
static int *pcounter = &counter_elsewhere + 1;
int is_stdout(void) { return *where == stdout && stdout != stderr; }
int bump(void) { counter_elsewhere += 5; return ++counter_elsewhere + pcounter[-1]; }
int has_env(void) { return environ != 0; }

int main(void) {
  printf("%d\n", is_stdout());
  printf("%d\n", bump());
  printf("%d\n", has_env());
  return 0;
}
