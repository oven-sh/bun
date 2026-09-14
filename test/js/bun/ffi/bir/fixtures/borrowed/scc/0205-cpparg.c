#define TOLOWER(c) ((((unsigned)c) - 'A' < 26) ? ((c) | 32) : (c))

int
main(void)
{
	char c, *s = "Bla";

	c = TOLOWER((unsigned char)*s);
	if (c != 'b')
		return 1;

	return 0;
}
