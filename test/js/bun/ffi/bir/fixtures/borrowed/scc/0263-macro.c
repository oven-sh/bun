typedef int cc;

#define cc(cc, ...) for(__VA_ARGS__) cc += 2;

int
main(void)
{
	int i, c = 0;

	cc (c, i = 0; i < 3; i++)

	return !(c == 6);
}
