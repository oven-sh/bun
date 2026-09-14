int but, aclick;

int
main(void)
{
	int r;

	aclick = 1;
	but = 1;
	r = 1;
	if (aclick == 1 && but == 1)
		r = ((aclick = 0) + 1 , aclick);
	return r;
}
