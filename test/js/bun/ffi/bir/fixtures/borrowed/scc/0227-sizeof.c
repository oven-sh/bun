int
main()
{
	char s[sizeof "\0a" - 1] = "\0a";

	if (s[0] != 0 && s[1] != 'a')
		return 1;
	return 0;
}
