// Function pointers: tables in data (relocations), callbacks, switch dispatch.

typedef int (*binop)(int, int);

static int add(int a, int b) { return a + b; }
static int sub(int a, int b) { return a - b; }
static int mul(int a, int b) { return a * b; }
static int divide(int a, int b) { return b ? a / b : 0; }

static const binop ops[4] = { add, sub, mul, divide };

struct Command { const char *name; binop run; };
static const struct Command commands[] = {
    { "add", add }, { "sub", sub }, { "mul", mul }, { "div", divide },
};

int apply(int op, int a, int b) {
    return ops[op & 3](a, b);
}

int apply_by_letter(char letter, int a, int b) {
    for (unsigned i = 0; i < sizeof commands / sizeof commands[0]; i++)
        if (commands[i].name[0] == letter) return commands[i].run(a, b);
    return -1;
}

int fold(binop f, const int *values, int n, int init) {
    int acc = init;
    for (int i = 0; i < n; i++) acc = f(acc, values[i]);
    return acc;
}

int sum_and_product(void) {
    static const int values[] = { 1, 2, 3, 4, 5 };
    return fold(add, values, 5, 0) * 1000 + fold(mul, values, 5, 1);
}

// `callback` is a native (or JSCallback) function pointer.
int call_twice(int (*callback)(int), int x) {
    return callback(callback(x));
}

int classify(int c) {
    switch (c) {
    case ' ': case '\t': case '\n': return 0;
    case '0': case '1': case '2': case '3': case '4':
    case '5': case '6': case '7': case '8': case '9': return 1;
    case '_': return 2;
    default:
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) return 2;
        return 3;
    }
}

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)apply(2, 6, 7));
  printf("%d\n", (int)apply_by_letter(115, 10, 3));
  printf("%d\n", (int)apply_by_letter(120, 1, 1));
  printf("%d\n", (int)sum_and_product());
  printf("%d\n", (int)classify(55));
  printf("%d\n", (int)classify(43));
  printf("%d\n", (int)classify(95));
  printf("%d\n", (int)classify(10));
  return 0;
}
