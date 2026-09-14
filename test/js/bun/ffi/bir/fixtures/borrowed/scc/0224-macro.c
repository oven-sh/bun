#define _PROTOTYPE(x, y) x y

_PROTOTYPE(int fun, (char *s, int n, const char *format,
                                                  char *arg)    );
_PROTOTYPE(int fun, (char *s, int n, const char *format, char *arg)    );
_PROTOTYPE(int fun, (char *s, int n, const char *format, char
	*arg)    );

int
fun(char *s, int n, const char *format, char *arg)
{
	return 0;
}

int
main()
{
	return fun(0, 0, 0, 0);
}
