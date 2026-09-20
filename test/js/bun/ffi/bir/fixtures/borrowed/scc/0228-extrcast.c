int atoi(const char *);

void *p[] = {atoi};

int
main(void)
{
	return p[0] == 0;
}
