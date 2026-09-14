#include <wchar.h>

int
main()
{
	wchar_t c;

	c = L'á';

	if (c != 225)
		return 1;
	return 0;
}
