char *
f1()
{
	return 1,2,3, (void *) 0;
}

char *
f2()
{
	return 1,2,3, 0 ? "" : 0;
}

int
main()
{
	if (f1())
		return 1;
	if (f2())
		return 2;
	return 0;
}
