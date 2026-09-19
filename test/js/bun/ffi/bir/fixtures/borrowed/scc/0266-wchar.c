#include <wchar.h>

int
main()
{
	wchar_t buf[30] = L"abc";

	if (buf[0] != L'a')
		return 1;
	if (buf[1] != L'b')
		return 2;
	if (buf[2] != L'c')
		return 3;
	if (buf[3] != L'\0')
		return 4;

	return 0;
}
