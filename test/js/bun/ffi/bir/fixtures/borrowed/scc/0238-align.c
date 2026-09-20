struct a {
	char c;
	int i;
};

int
main(void)
{
	struct a s[2] = {
		{.c = 64, .i = 3},
		{.c = 64, .i = 6}
	};

	if (s[0].i != 3)
		return 1;
	if (s[1].i != 6)
		return 2;

	return 0;
}
