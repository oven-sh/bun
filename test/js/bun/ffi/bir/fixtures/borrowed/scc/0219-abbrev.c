int
main()
{
	unsigned long c;
	char s[1];

	*s = 10;
	c = 6;
	*s %= c;
	if (*s != 4)
		return 1;

	*s = 8;
	c = 2;
	*s <<= c;
	if (*s != 32)
		return 2;

	*s = 8;
	c = 2;
	*s >>= c;
	if (*s != 2)
		return 3;

	*s = 12;
	c = 8;
	*s &= c;
	if (*s != 8)
		return 4;

	*s = 3;
	c = 1;
	*s ^= c;
	if (*s != 2)
		return 5;

	*s = 1;
	c = 2;
	*s |= c;
	if (*s != 3)
		return 6;

	*s = 1;
	c = 3;
	*s += c;
	if (*s != 4)
		return 7;

	*s = 4;
	c = 1;
	*s -= c;
	if (*s != 3)
		return 8;

	*s = 8;
	c = 2;
	*s /= c;
	if (*s != 4)
		return 9;

	*s = 4;
	c = 4;
	*s *= c;
	if (*s != 16)
		return 10;

	return 0;
}
