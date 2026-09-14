#define a(x) #   x

static char *s = a ( 3
2);

static int
cmp(char *s1, char *s2)
{
	while (*s1 && *s2 && *s1 == *s2)
		++s1, ++s2;
	return *s1 == '\0' && *s2 == '\0';
}

int
main(void)
{
	if (!cmp(a(3), "3"))
		return 1;
	if (!cmp(a( 3 ), "3"))
		return 2;
	if (!cmp(a( 3  2 ), "3 2"))
		return 3;
	if (!cmp(s, "3 2"))
		return 4;
	if (!cmp(a("3 2  1\n"), "\"3 2  1\\n\""))
		return 5;
	if (!cmp(a('\n'), "'\\n'"))
		return 6;
	if (!cmp(a('"'), "'\"'"))
		return 6;
	if (!cmp(a(: @\n), ": @\n"))
		return 7;

	return 0;
}
