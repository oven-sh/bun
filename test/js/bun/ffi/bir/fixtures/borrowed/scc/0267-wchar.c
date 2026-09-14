#include <wchar.h>

int
main()
{
	wchar_t ws[] = L"aáb";

	if (ws[0] != 'a')
		return 1;
	if (ws[1] != L'\u00e1')
		return 2;
	if (ws[2] != 'b')
		return 3;
	return 0;
}
