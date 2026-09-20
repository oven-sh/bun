struct a {
	int i;
	char s[10];
};

int
main(void)
{
	char *s;
	struct a b = {0, "hola"};

	s = b.s;
	if (s[0] != 'h')
		return 1;
	if (s[1] != 'o')
		return 2;
	if (s[2] != 'l')
		return 3;
	if (s[3] != 'a')
		return 4;
	if (s[4] != '\0')
		return 5;
	if (s[5] != '\0')
		return 6;
	if (s[6] != '\0')
		return 7;
	if (s[7] != '\0')
		return 8;
	if (s[8] != '\0')
		return 9;
	if (s[9] != '\0')
		return 10;
	return 0;
}
