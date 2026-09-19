// Recursion, loops, 64-bit arithmetic.

int fib(int n) {
    return n < 2 ? n : fib(n - 1) + fib(n - 2);
}

long long fib_iter(int n) {
    long long a = 0, b = 1;
    for (int i = 0; i < n; i++) {
        long long next = a + b;
        a = b;
        b = next;
    }
    return a;
}

unsigned gcd(unsigned a, unsigned b) {
    while (b) {
        unsigned t = a % b;
        a = b;
        b = t;
    }
    return a;
}

int collatz_steps(unsigned long long n) {
    int steps = 0;
    while (n != 1) {
        n = (n & 1) ? 3 * n + 1 : n / 2;
        steps++;
    }
    return steps;
}

int count_primes(int limit) {
    static unsigned char composite[10000];
    if (limit > 10000) limit = 10000;
    int count = 0;
    for (int i = 0; i < limit; i++) composite[i] = 0;
    for (int i = 2; i < limit; i++) {
        if (composite[i]) continue;
        count++;
        for (int j = i * 2; j < limit; j += i) composite[j] = 1;
    }
    return count;
}

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)fib(15));
  printf("%lld\n", (long long)fib_iter(80));
  printf("%d\n", (int)gcd(1071, 462));
  printf("%d\n", (int)collatz_steps(27LL));
  printf("%d\n", (int)count_primes(1000));
  return 0;
}
