#define CAT(x,y) x ## y
#define XCAT(x,y) CAT(x,y)
#define FOO foo
#define BAR bar

int foobar;

int
main(void)
{
	int foo = 1, bar = 0;

	CAT(foo,bar) += foo + bar;
	if (foobar != 1)
		return 1;
	XCAT(FOO,BAR) += foo + bar;
	if (foobar != 2)
		return 2;

	return 0;
}
