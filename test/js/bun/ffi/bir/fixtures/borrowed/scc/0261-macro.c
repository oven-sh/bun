#define A(sizeof) sizeof(c)

int
f(int a)
{
	return a + 1;
}

int
main(void)
{
	int c = 0;

	return !(A(f) == 1);
}
