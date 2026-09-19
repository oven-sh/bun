int
f1(int a)
{
	return a-1;
}

int
f2(double a)
{
	return 0;
}

int
f3(int (*p)(), int a)
{
	return (*p)(a);
}

int
main()
{
	int (*fp1)();
	int (*fp2)(int (*)(int), int);

	fp1 = f1;
	if ((*fp1)(1) != 0)
		return 1;
	fp1 = f2;
	if ((*fp1)(0) != 0)
		return 2;
	fp2 = f3;
	if ((fp2)(f1, 1) != 0)
		return 3;

	return 0;
}
