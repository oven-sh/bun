typedef struct List List;
struct List {
	int len;
	struct List *head;
	List *back;
};

List list;

int
main(void)
{
	return list.len;
}
