import os, sys, tempfile, shutil, zipfile, zipimport
d = tempfile.mkdtemp()
try:
    z = os.path.join(d, 'a.zip')
    with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('dir/two.txt', b'two')
        zf.writestr('mod.py', 'value = 6 * 7\ndef f():\n    return "from the zip"\n')
        zf.writestr('pkg/__init__.py', 'from . import sub\n')
        zf.writestr('pkg/sub.py', 'name = __name__\n')
    sys.path.insert(0, z)
    import mod, pkg
    print(mod.value, mod.f(), mod.__file__ == os.path.join(z, 'mod.py'), type(mod.__loader__).__name__, pkg.sub.name)
    imp = zipimport.zipimporter(z)
    print(imp.get_source('mod')[:10], imp.is_package('pkg'), imp.is_package('mod'), imp.get_data(os.path.join(z, 'dir/two.txt')))
    sys.path.pop(0)
finally:
    shutil.rmtree(d)
