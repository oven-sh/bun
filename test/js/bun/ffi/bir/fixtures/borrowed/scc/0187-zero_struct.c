struct json_node {
	int type;
	char *name;
};

int
main(void)
{
	struct json_node nodes[16] = { { 0 } };
	char sentinel[] = {
		0x98, 0x98, 0x98, 0x98,
		0x98, 0x98, 0x98, 0x98,
		0x98, 0x98, 0x98, 0x98,
		0x98, 0x98, 0x98, 0x98,
	};
	int i;

	for (i = 0; i < 16; i++) {
		if (nodes[i].name || nodes[i].type)
			return i+1;
	}

	return 0;
}
