
int
main(void)
{
	int a = L'\u00a1';

	if (a != 0xa1)
		return 1;
	if (L'\u00a1' != 0xa1)
		return 2;
	if (L'\U000000b1' != 0xb1)
		return 3;

	return 0;
}
