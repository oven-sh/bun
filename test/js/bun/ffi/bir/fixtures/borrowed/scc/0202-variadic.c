#define debug1(...)    test1(__VA_ARGS__)
#define debug2(...)    test2(0, #__VA_ARGS__)
#define debug3(t, ...) ((t==1) ? test1(__VA_ARGS__):test2(__VA_ARGS__))

int
test1(int x, char *s)
{
	int i;

	if (x != 3)
		return 0;
	for (i = 0; s[i]; i++) {
		if (s[i] != "test1"[i])
			return 0;
	}
	return 1;
}

int
test2(int x, char *s)
{
	int i;

	for (i = 0; s[i]; i++) {
		if (s[i] != "1, 2"[i])
			return 0;
	}
	return 1;
}

int
main()
{
	if (!debug1(3, "test1"))
		return 1;
	if (!debug2(1, 2))
		return 2;
	if (!debug3(1, 3, "test1"))
		return 3;
	if (!debug3(2, 0, "1, 2"))
		return 4;

	return 0;
}
