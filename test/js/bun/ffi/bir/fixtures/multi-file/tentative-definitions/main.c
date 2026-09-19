int printf(const char *, ...);
void set(int);
int get(void);
int peek(void);
int main(void) {
  set(2);
  printf("%d\n", get());
  printf("%d\n", peek());
  return 0;
}
