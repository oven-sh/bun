
int v[1 + (L'\u0040' == 64)];

int
main(void)
{
	return !(sizeof(v) == sizeof(int [2]));
}
