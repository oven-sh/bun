#define LEN(a)   sizeof((a))/sizeof((a)[0])

int
main(void)
{
	char s[] = "bla";

	return !(LEN(s) == 4);
}
