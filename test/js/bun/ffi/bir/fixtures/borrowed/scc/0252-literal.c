int
cmp(int *v)
{
	if (v[0] != 1)
		return 1;
	if (v[1] != 2)
		return 2;
	if (v[2] != 3)
		return 3;
	if (v[3] != 4)
		return 4;
	if (v[4] != 69)
		return 5;
	return 0;
}

int
set(int *a)
{
	*a = 69;
	return 1;
}

int
main(void)
{
	int a;

	set(&a);
	return cmp((int []) {1, 2, 3, 4, a});
}
