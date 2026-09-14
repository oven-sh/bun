#include <stdarg.h>

int
fun(int first, ...)
{
	int c;

	va_list va;

	va_start(va, first);
	c = va_arg(va, int);
	va_end(va);

	return c;
}

int
main()
{
	return fun(1, 0);
}
