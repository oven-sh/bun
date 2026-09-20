int
main(void)
{
	unsigned long long u = 18446744073709551615ull;

	if (u != 18446744073709551615u)
		return 1;
	if (u != 0xFFFFFFFFFFFFFFFF)
		return 2;

	return 0;
}
