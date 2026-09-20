#define TEST1 1 // comment
#define TEST2 2

int
main(void)
{
	if (TEST1 != 1)
		return 1;
	if (TEST2 != 2)
		return 2;
	return 0;
}
