#define SIZ 6

int test(char *);

int
test(char *s)
{
	if (s[0] != 'a')
		return 1;
	if (s[1] != 'b')
		return 2;
	if (s[2] != 'c')
		return 3;
	if (s[3] != '\0')
		return 4;
	return 0;
}

int
main(void)
{
	return test((char[SIZ]) {"abc"});
}
