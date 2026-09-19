int but, aclick;

int
main(void)
{
	int r;

	r = 0;
	if (aclick == 1 && but)
		r = but == 1 && aclick == 0;
	if (aclick == 0 && but)
		r = but == 1 || aclick == 0;
	if (aclick == 1 && but == 0)
		r = !but;
	return r;
}
