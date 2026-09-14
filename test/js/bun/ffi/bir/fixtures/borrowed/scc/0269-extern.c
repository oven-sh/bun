extern unsigned char tbl[];

unsigned char tbl[8] =  {
	1, 0, 2, 0,
};

unsigned char c = 3;

int
main(void)
{
	if (tbl[0] != 1 || tbl[2] != 2)
		return 1;
	if (tbl[4] != 0)
		return 2;
	return 0;
}
