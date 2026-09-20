int
main(void)
{
	int a = -2;
	unsigned b = 2;

	if (!(a * 2 == -4))
		return 1;
	if (!(b * 2 == 4))
		return 2;
	if (!(b * 8 == 16))
		return 3;
	return 0;
}
