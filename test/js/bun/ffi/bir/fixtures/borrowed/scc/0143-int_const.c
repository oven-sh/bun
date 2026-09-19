int main(void)
{
	int i;
	unsigned u;

	i = 1;
	i = -1;
	i = -1l;
	i = -1u;
	i = -1ll;
	i = 32766 + 1 & 3;
	i = (int) 32768 < 0;
	i = -1u < 0;

	u = 1;
	u = -1;
	u = -1l;
	u = -1u;
	u = -1ll;
	u = (unsigned) 32768 < 0;
	u = 32766 + 1 & 3;
	u = -1u < 0;
	return 0;
}
