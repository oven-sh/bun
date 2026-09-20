char s0[] = "foo";
char s1[7] = "foo";
char s2[3] = "foo";
char s3[] = {"foo"};
char *p = "foo";

int
cmp(char *s1, char *s2)
{
	while (*s1 && *s1++ == *s2++)
		;
	return *s1;
}

int
main()
{
	if (sizeof(s0) != 4 || cmp(s0, "foo"))
		return 1;
	if (cmp(s1, "foo"))
		return 1;
	if (s2[0] != 'f' || s2[1] != 'o')
		return 1;
	if (sizeof(s3) != 4 || cmp(s3, "foo"))
		return 1;
	return 0;
}
