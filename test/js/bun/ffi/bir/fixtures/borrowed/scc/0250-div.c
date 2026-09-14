int
main(void)
{
	int a = -2;
	unsigned b = 2, c = 16;

	if (!(a / 2 == -1))
		return 1;
	if (!(b / 2 == 1))
		return 2;
	if (!(c / 8 == 2))
		return 3;
	return 0;
}
