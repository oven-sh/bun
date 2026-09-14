int
f2(int c)
{
	return c+2;
}

int
f1(int a)
{
	return a+3;
}

int
main(void)
{
	int h1 = 5, h2 = 3, h3;

	h3 = f1(h1) + f2(h2);
	if (h3 != 13)
		return 1;
}
