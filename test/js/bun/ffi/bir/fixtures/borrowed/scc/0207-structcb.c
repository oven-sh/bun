typedef int (cookie_seek_function_t)(void);

typedef struct _IO_cookie_io_functions_t {
	cookie_seek_function_t *seek;
} cookie_io_functions_t;

cookie_seek_function_t seek;

int
main(void)
{
	return 0;
}
