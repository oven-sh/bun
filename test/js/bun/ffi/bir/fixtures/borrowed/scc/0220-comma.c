int a;

int
f1()
{
	return a = 2;
}

int
f2()
{
	return a += 1;
}

int
main()
{
	if (f1(), f2() != 3)
		return 1;
	return 0;
}
