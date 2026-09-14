#include <stdarg.h>

int
f(int c, ...)
{
	va_list va1, va2;

	va_start(va1, c);
	c += va_arg(va1, int);
	va_copy(va2, va1);
	c += va_arg(va2, int);
	c += va_arg(va1, int);

	va_end(va1);
	va_end(va2);

	return c;
}

int
main()
{
	if (f(0, 1, 2, 7) != 5)
		return 1;
	return 0;
}
