import os, sys, tempfile, shutil, zipfile, zipimport
d = tempfile.mkdtemp()
try:
    z = os.path.join(d, 'a.zip')
    with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('dir/two.txt', b'two' * 100)
        zf.writestr('mod.py', 'value = 6 * 7\ndef f():\n    return "from the zip"\n')
        zf.writestr('pkg/__init__.py', 'from . import sub\n')
        zf.writestr('pkg/sub.py', 'name = __name__\n')
    imp = zipimport.zipimporter(z)
    print(imp.get_source('mod')[:10], imp.is_package('pkg'), imp.is_package('mod'), imp.get_data(os.path.join(z, 'dir/two.txt'))[:6], imp.get_filename('mod') == os.path.join(z, 'mod.py'), imp.archive == z, imp.prefix)
    spec = imp.find_spec('mod'); print(spec.name, spec.origin == os.path.join(z, 'mod.py'), type(spec.loader).__name__)
    code = imp.get_code('mod'); ns = {}; exec(code, ns); print(ns['value'], ns['f']())
    import importlib.util
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); print(m.value, m.f(), m.__file__ == os.path.join(z, 'mod.py'))
    try: zipimport.zipimporter(os.path.join(d, 'nope.zip'))
    except zipimport.ZipImportError as e: print('ZipImportError', str(e).split(':')[0])
finally:
    shutil.rmtree(d)
