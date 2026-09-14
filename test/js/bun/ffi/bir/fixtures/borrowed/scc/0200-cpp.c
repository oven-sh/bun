/* taken from ISO/IEC 9899:1999 Section 6.10.3.5 p6 */

#define str(s)      # s
#define xstr(s)     str(s)
#define debug(s, t) test1("x" # s "= %d, x" # t "= %d", \
		  x ## s, x ## t)
#define INCFILE(n) vers ## n
#define vers2      0200-cpp
#define glue(a, b) a ## b
#define xglue(a, b) glue(a, b)
#define HIGHLOW     "hello"
#define LOW         LOW ", world"

int
test1(char *s, int x, int y)
{
	int i;

	for (i = 0; s[i]; i++) {
		if (s[i] != "x1= %d, x2= %d"[i])
			return 0;
	}
	if (x + y != 3)
		return 0;
	return 1;
}

int
test2(char *s1, char *s2)
{
	int i;

	for (i = 0; s1[i]; i++) {
		if (s1[i] != s2[i])
			return 0;
	}
	return s1[i] == '\0' && s2[i] == '\0';
}

int
test4(char *s)
{
	int i;

	for (i = 0; s[i]; i++) {
		if (s[i] != "hello"[i])
			return 0;
	}

	return 1;
}

int
test5(char *s)
{
	int i;

	for (i = 0; s[i]; i++) {
		if (s[i] != "hello, world"[i])
			return 0;
	}

	return 1;
}

int
main()
{
	int x1 = 1, x2 = 2;
	char *s = "strncmp(\"abc\\0d\", \"abc\", '\\4') == 0: @\n";

	if (!debug(1, 2))
		return 1;

	if (!test2(str(strncmp("abc\0d", "abc", '\4') // this goes away
== 0) str(: @\n), s))
		return 2;

#include xstr(INCFILE(2).h)

	if (x != 2)
		return 3;

	if (!test4(glue(HIGH, LOW)))
		return 4;

	if (!test5(xglue(HIGH, LOW)))
		return 5;

	return 0;
}
