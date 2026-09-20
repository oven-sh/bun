#ifdef __STDC__
#define __(proto) proto
#else
#define __(proto) ()
#endif

extern int func __((int, int));

int
main()
{
	int (*fun)(int,int) = func;

	return (*func)(2, 1);
}

int
func(int a, int b)
{
	return a - b - 1;
}
