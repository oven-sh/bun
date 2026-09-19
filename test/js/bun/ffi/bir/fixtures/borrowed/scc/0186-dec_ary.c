struct node {
	int index;
};

struct node nodes[2];

int
main(void)
{
	int d = 1, c;

	d = 1;
	c = nodes[--d].index++;
	if (d != 0 || nodes[0].index != 1)
		return 1;

	d = -1;
	c = nodes[++d].index--;
	if (d != 0 || nodes[0].index != 0)
		return 2;

	return 0;
}
