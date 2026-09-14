#include <wchar.h>

#define W(L) L"Hello " L

int
test(wchar_t *ws)
{
	int i;
	static wchar_t str[] = L"Hello World!!!!!";

	for (i = 0; ws[i] != L'\0'; ++i) {
		if (ws[i] != str[i])
			return 1;
	}

	return 0;
} 

int
main(void)
{
	wchar_t *ws = W(L"World!");

	return test(ws);
}
