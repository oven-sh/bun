#ifndef _H
#define _H

#define _PROTO(x, y) x()

_PROTO(int putc, (int, FILE *));

#endif

int
main()
{
	return 0;
}
