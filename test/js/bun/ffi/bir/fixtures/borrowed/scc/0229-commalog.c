int a, b, c;

#include <stdio.h>

int
main()
{
	int d;

	d = a = 1, b = 2, c = 3;
	if (d != 1)
		return 1;
	d = c, a || b;
	if (d != 3)
		return 2;
	d = (c, a || b);
	if (d != 1)
		return 3;
	d = a && (a = b + 2, a = 0);
	if (d != 0)
		return 4;

	return 0;
}
