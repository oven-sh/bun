int f1(int b[static 3])
{
	return b[0] + 1;
}

int f2(int b[volatile 3])
{
	return b[0] + 2;
}

int
main(void)
{
	int a[10] = {1, 2, 3};
	int b[10] = {4, 5, 6};

	return !(f1(a) + f2(b) == 8);
}
