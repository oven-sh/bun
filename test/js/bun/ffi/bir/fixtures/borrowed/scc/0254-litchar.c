int c = '\xff';

int
main(void)
{
	char c = -1;

	if ('\xff' > 0)
		return !(c > 0);
	else
		return !(c < 0);
}
