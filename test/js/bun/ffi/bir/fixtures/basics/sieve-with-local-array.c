int primes_below(int n) {
             char composite[1000];
             for (int i = 0; i < 1000; i++) composite[i] = 0;
             int count = 0;
             for (int i = 2; i < n; i++) {
                 if (composite[i]) continue;
                 count++;
                 for (int j = i * i; j < n; j += i) composite[j] = 1;
             }
             return count;
         }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)primes_below(100));
  printf("%d\n", (int)primes_below(1000));
  return 0;
}
