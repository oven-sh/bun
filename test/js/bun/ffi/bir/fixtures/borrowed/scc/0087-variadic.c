#define ARGS(...) __VA_ARGS__

int
none()
{
	return 0;
}

int
one(int a)
{
	if (a != 1)
		return 1;
	
	return 0;
}

int
two(int a, int b)
{
	if (a != 1)
		return 1;
	if (b != 2)
		return 1;
	
	return 0;
}

int
three(int a, int b, int c)
{
	if (a != 1)
		return 1;
	if (b != 2)
		return 1;
	if (c != 3)
		return 1;
	
	return 0;
}

int
main()
{
	if (none(ARGS()))
		return 1;
	if (one(ARGS(1)))
		return 2;
	if (two(ARGS(1, 2)))
		return 3;
	if (three(ARGS(1, 2, 3)))
		return 4;
	return 0;
}
