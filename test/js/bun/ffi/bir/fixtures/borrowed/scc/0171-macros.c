#define X (2)
#define L (0)
#define H (1)
#define Q(x) x

int
main(void)
{
	return X == L + H + Q(1) ? 0 : 1;
}
