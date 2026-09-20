int
f(char *v[])
{
	char *s;

	s = v[0];

	return s[0] == 's' && s[1] == 'h' && s[2] == '\0';
}

int
main()
{
	int n;

	n = f((char *[]) {"sh", "-c"});

	if (!n)
		return 1;
	return  0;
}
