int
main(void)
{
	int i;

	i = i || 0;
	i = i || 4;
	i = 4 || i;
	i = 0 || i;
	i = i && 0;
	i = i && 4;
	i = 4 && i;
	i = 0 && i;
	i = i << 0;
	i = 0 << i;
	i = i >> 0;
	i = 0 >> i;
	i = i + 0;
	i = 0 + i;
	i = i - 0;
	i = 0 - i;
	i = i | 0;
	i = 0 | i;
	i = i ^ 0;
	i = 0 ^ i;
	i = i * 0;
	i = 0 * i;
	i = i * 1;
	i = 1 * i;
	i = i / 1;

	if (i)
		i = 1 / i;

	i = i & ~0;
	i = ~0 & i;
	i = i % 1;

	if (0)
		i = i / 0;
	if (0)
		i = i % 0;

	return 0;
}
