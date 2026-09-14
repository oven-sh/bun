
#define f1(c)     c
#define f2()      f1('\n')
#define f3()      f1("h")

int
main()
{
	int a = f2() == '\n';

	return !(a == 1);
}
