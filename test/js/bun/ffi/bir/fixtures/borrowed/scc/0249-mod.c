int
main(void)
{
	int a = -1;
	unsigned b = 3, c = 10;

	if (!(a % 2 == -1))
		return 1;
	if (!(b % 2 == 1))
		return 2;
	if (!(c % 8 == 2))
		return 2;

	return 0;
}
