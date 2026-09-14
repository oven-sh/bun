#define x f
#define y() f

typedef struct { int f; } S;

int
main()
{
	S s;

	s.x = 0;
	return s.y();
}
