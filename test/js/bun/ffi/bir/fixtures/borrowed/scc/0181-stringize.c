#define XSTR(x) #x
#define STR(x)  XSTR(x)
#define S       y = "str"

int
main()
{
	char *s, *t = STR(S);

	for (s = "y = \"str\""; *s && *t; ++s, ++t) {
		if (*s != *t)
			return 1;
	}

	return 0;
}
