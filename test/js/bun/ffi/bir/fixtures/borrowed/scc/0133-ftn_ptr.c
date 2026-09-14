int
foo(void)
{
	return 0;
}

int
bar(void)
{
	return 24;
}

int
main(void)
{
	return (1 ? foo : bar)();
}
