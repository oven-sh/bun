# Basic filesystem with FUSE
# Used to ensure bun can run files mounted on FUSE
# The filesystem will appear to have `main.js` containing:
# console.log("hello world");
# and `main-symlink.js` as a symlink to `main.js`.
import fuse
import errno, stat, os

fuse.fuse_python_api = (0, 2)

script = b'console.log("hello world");\n'


class TestingFs(fuse.Fuse):
    def getattr(self, path):
        st = fuse.Stat()
        if path == "/":
            st.st_mode = stat.S_IFDIR | 0o755
            st.st_nlink = 2
        elif path == "/main.js":
            st.st_mode = stat.S_IFREG | 0o644
            st.st_nlink = 1
            st.st_size = len(script)
        elif path == "/main-symlink.js":
            st.st_mode = stat.S_IFLNK | 0o644
            st.st_nlink = 1
            st.st_size = len("main.js")
        else:
            return -errno.ENOENT
        return st

    def readdir(self, path, offset):
        for r in ".", "..", "main.js", "main-symlink.js":
            yield fuse.Direntry(r)

    def open(self, path, flags):
        if path != "/main.js" and path != "/main-symlink.js":
            return -errno.ENOENT
        mask = os.O_RDONLY | os.O_WRONLY | os.O_RDWR
        if (flags & mask) != os.O_RDONLY:
            return -errno.EACCES

    def read(self, path, size, offset):
        if path != "/main.js":
            return -errno.ENOENT
        if offset < len(script):
            if offset + size > len(script):
                size = len(script) - offset
            return script[offset : offset + size]
        return b""

    def readlink(self, path):
        if path != "/main-symlink.js":
            return -errno.ENOENT
        return "main.js"


def main():
    server = TestingFs(
        version=fuse.__version__,
        usage="\nSmall filesystem made for testing Bun's ability to run files off of FUSE",
        dash_s_do="setsingle",
    )
    server.parse(errex=1)
    server.main()


if __name__ == "__main__":
    main()
