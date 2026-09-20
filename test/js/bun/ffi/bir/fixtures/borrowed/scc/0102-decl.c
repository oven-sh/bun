#include <stdio.h>

static void
printhello(char *hello[static 1])
{
        puts(*hello);
}

int
main(void)
{
        char *p = "Hello, world!";
        char *hello[] = {p};
        printhello(hello);

	return 0;
}
