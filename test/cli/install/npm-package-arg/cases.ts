import path from "path";
import os from "os";

export default {
  basic: {
    'foo@1.2': {
      name: 'foo',
      escapedName: 'foo',
      type: 'range',
      saveSpec: null,
      fetchSpec: '1.2',
      raw: 'foo@1.2',
      rawSpec: '1.2',
    },

    'foo@~1.2': {
      name: 'foo',
      escapedName: 'foo',
      type: 'range',
      saveSpec: null,
      fetchSpec: '~1.2',
      raw: 'foo@~1.2',
      rawSpec: '~1.2',
    },

    '@foo/bar': {
      raw: '@foo/bar',
      name: '@foo/bar',
      escapedName: '@foo%2fbar',
      scope: '@foo',
      rawSpec: '*',
      saveSpec: null,
      fetchSpec: '*',
      type: 'range',
    },

    '@foo/bar@': {
      raw: '@foo/bar@',
      name: '@foo/bar',
      escapedName: '@foo%2fbar',
      scope: '@foo',
      rawSpec: '*',
      saveSpec: null,
      fetchSpec: '*',
      type: 'range',
    },

    '@foo/bar@baz': {
      raw: '@foo/bar@baz',
      name: '@foo/bar',
      escapedName: '@foo%2fbar',
      scope: '@foo',
      rawSpec: 'baz',
      saveSpec: null,
      fetchSpec: 'baz',
      type: 'tag',
    },

    '@f fo o al/ a d s ;f': {
      raw: '@f fo o al/ a d s ;f',
      name: null,
      escapedName: null,
      rawSpec: '@f fo o al/ a d s ;f',
      saveSpec: 'file:@f fo o al/ a d s ;f',
      fetchSpec: '/test/a/b/@f fo o al/ a d s ;f',
      type: 'directory',
    },

    'foo@1.2.3': {
      name: 'foo',
      escapedName: 'foo',
      type: 'version',
      saveSpec: null,
      fetchSpec: '1.2.3',
      raw: 'foo@1.2.3',
    },

    'foo@=v1.2.3': {
      name: 'foo',
      escapedName: 'foo',
      type: 'version',
      saveSpec: null,
      fetchSpec: '=v1.2.3',
      raw: 'foo@=v1.2.3',
      rawSpec: '=v1.2.3',
    },

    'foo@npm:bar': {
      name: 'foo',
      escapedName: 'foo',
      type: 'alias',
      saveSpec: null,
      fetchSpec: null,
      raw: 'foo@npm:bar',
      rawSpec: 'npm:bar',
      subSpec: {
        registry: true,
        name: 'bar',
        escapedName: 'bar',
        type: 'range',
        raw: 'bar',
        rawSpec: '*',
        saveSpec: null,
        fetchSpec: '*',
      },
    },

    'git+ssh://git@notgithub.com/user/foo#1.2.3': {
      name: null,
      escapedName: null,
      type: 'git',
      saveSpec: 'git+ssh://git@notgithub.com/user/foo#1.2.3',
      fetchSpec: 'ssh://git@notgithub.com/user/foo',
      gitCommittish: '1.2.3',
      raw: 'git+ssh://git@notgithub.com/user/foo#1.2.3',
    },

    'git+ssh://git@notgithub.com/user/foo': {
      name: null,
      escapedName: null,
      type: 'git',
      saveSpec: 'git+ssh://git@notgithub.com/user/foo',
      fetchSpec: 'ssh://git@notgithub.com/user/foo',
      gitCommittish: null,
      raw: 'git+ssh://git@notgithub.com/user/foo',
    },

    'git+ssh://git@notgithub.com:user/foo': {
      name: null,
      escapedName: null,
      type: 'git',
      saveSpec: 'git+ssh://git@notgithub.com:user/foo',
      fetchSpec: 'git@notgithub.com:user/foo',
      gitCommittish: null,
      raw: 'git+ssh://git@notgithub.com:user/foo',
    },

    'git+ssh://mydomain.com:foo': {
      name: null,
      escapedName: null,
      type: 'git',
      saveSpec: 'git+ssh://mydomain.com:foo',
      fetchSpec: 'mydomain.com:foo',
      gitCommittish: null,
      raw: 'git+ssh://mydomain.com:foo',
    },

    'git+ssh://git@notgithub.com:user/foo#1.2.3': {
      name: null,
      escapedName: null,
      type: 'git',
      saveSpec: 'git+ssh://git@notgithub.com:user/foo#1.2.3',
      fetchSpec: 'git@notgithub.com:user/foo',
      gitCommittish: '1.2.3',
      raw: 'git+ssh://git@notgithub.com:user/foo#1.2.3',
    },

    'git+ssh://mydomain.com:foo#1.2.3': {
      name: null,
      escapedName: null,
      type: 'git',
      saveSpec: 'git+ssh://mydomain.com:foo#1.2.3',
      fetchSpec: 'mydomain.com:foo',
      gitCommittish: '1.2.3',
      raw: 'git+ssh://mydomain.com:foo#1.2.3',
    },

    'git+ssh://mydomain.com:foo/bar#1.2.3': {
      name: null,
      escapedName: null,
      type: 'git',
      saveSpec: 'git+ssh://mydomain.com:foo/bar#1.2.3',
      fetchSpec: 'mydomain.com:foo/bar',
      gitCommittish: '1.2.3',
      raw: 'git+ssh://mydomain.com:foo/bar#1.2.3',
    },

    'git+ssh://mydomain.com:1234#1.2.3': {
      name: null,
      escapedName: null,
      type: 'git',
      saveSpec: 'git+ssh://mydomain.com:1234#1.2.3',
      fetchSpec: 'ssh://mydomain.com:1234',
      gitCommittish: '1.2.3',
      raw: 'git+ssh://mydomain.com:1234#1.2.3',
    },

    'git+ssh://mydomain.com:1234/hey#1.2.3': {
      name: null,
      escapedName: null,
      type: 'git',
      saveSpec: 'git+ssh://mydomain.com:1234/hey#1.2.3',
      fetchSpec: 'ssh://mydomain.com:1234/hey',
      gitCommittish: '1.2.3',
      raw: 'git+ssh://mydomain.com:1234/hey#1.2.3',
    },

    'git+ssh://mydomain.com:1234/hey': {
      name: null,
      escapedName: null,
      type: 'git',
      saveSpec: 'git+ssh://mydomain.com:1234/hey',
      fetchSpec: 'ssh://mydomain.com:1234/hey',
      gitCommittish: null,
      raw: 'git+ssh://mydomain.com:1234/hey',
    },

    'git+ssh://username:password@mydomain.com:1234/hey#1.2.3': {
      name: null,
      escapedName: null,
      type: 'git',
      saveSpec: 'git+ssh://username:password@mydomain.com:1234/hey#1.2.3',
      fetchSpec: 'ssh://username:password@mydomain.com:1234/hey',
      gitCommittish: '1.2.3',
      raw: 'git+ssh://username:password@mydomain.com:1234/hey#1.2.3',
    },

    'git+ssh://git@github.com/user/foo#1.2.3': {
      name: null,
      escapedName: null,
      type: 'git',
      saveSpec: 'git+ssh://git@github.com/user/foo.git#1.2.3',
      fetchSpec: 'ssh://git@github.com/user/foo.git',
      gitCommittish: '1.2.3',
      raw: 'git+ssh://git@github.com/user/foo#1.2.3',
    },

    'git+ssh://git@notgithub.com/user/foo#semver:^1.2.3': {
      name: null,
      escapedName: null,
      type: 'git',
      hosted: null,
      saveSpec: 'git+ssh://git@notgithub.com/user/foo#semver:^1.2.3',
      fetchSpec: 'ssh://git@notgithub.com/user/foo',
      gitCommittish: null,
      gitRange: '^1.2.3',
      raw: 'git+ssh://git@notgithub.com/user/foo#semver:^1.2.3',
    },

    'git+ssh://git@notgithub.com:user/foo#semver:^1.2.3': {
      name: null,
      escapedName: null,
      type: 'git',
      hosted: null,
      saveSpec: 'git+ssh://git@notgithub.com:user/foo#semver:^1.2.3',
      fetchSpec: 'git@notgithub.com:user/foo',
      gitCommittish: null,
      gitRange: '^1.2.3',
      raw: 'git+ssh://git@notgithub.com:user/foo#semver:^1.2.3',
    },

    'git+ssh://git@github.com/user/foo#semver:^1.2.3': {
      name: null,
      escapedName: null,
      type: 'git',
      saveSpec: 'git+ssh://git@github.com/user/foo.git#semver:^1.2.3',
      fetchSpec: 'ssh://git@github.com/user/foo.git',
      gitCommittish: null,
      gitRange: '^1.2.3',
      raw: 'git+ssh://git@github.com/user/foo#semver:^1.2.3',
    },

    'git+ssh://git@github.com:user/foo#semver:^1.2.3': {
      name: null,
      escapedName: null,
      type: 'git',
      saveSpec: 'git+ssh://git@github.com/user/foo.git#semver:^1.2.3',
      fetchSpec: 'ssh://git@github.com/user/foo.git',
      gitCommittish: null,
      gitRange: '^1.2.3',
      raw: 'git+ssh://git@github.com:user/foo#semver:^1.2.3',
    },

    'user/foo#semver:^1.2.3': {
      name: null,
      escapedName: null,
      type: 'git',
      saveSpec: 'github:user/foo#semver:^1.2.3',
      fetchSpec: null,
      gitCommittish: null,
      gitRange: '^1.2.3',
      raw: 'user/foo#semver:^1.2.3',
    },

    'user/foo#path:dist': {
      name: null,
      escapedName: null,
      type: 'git',
      saveSpec: 'github:user/foo#path:dist',
      fetchSpec: null,
      gitCommittish: null,
      gitSubdir: '/dist',
      raw: 'user/foo#path:dist',
    },

    'user/foo#1234::path:dist': {
      name: null,
      escapedName: null,
      type: 'git',
      saveSpec: 'github:user/foo#1234::path:dist',
      fetchSpec: null,
      gitCommittish: '1234',
      gitRange: null,
      gitSubdir: '/dist',
      raw: 'user/foo#1234::path:dist',
    },

    'user/foo#notimplemented:value': {
      name: null,
      escapedName: null,
      type: 'git',
      saveSpec: 'github:user/foo#notimplemented:value',
      fetchSpec: null,
      gitCommittish: null,
      gitRange: null,
      gitSubdir: null,
      raw: 'user/foo#notimplemented:value',
    },

    'git+file://path/to/repo#1.2.3': {
      name: null,
      escapedName: null,
      type: 'git',
      saveSpec: 'git+file://path/to/repo#1.2.3',
      fetchSpec: 'file://path/to/repo',
      gitCommittish: '1.2.3',
      raw: 'git+file://path/to/repo#1.2.3',
    },

    'git://notgithub.com/user/foo': {
      name: null,
      escapedName: null,
      type: 'git',
      saveSpec: 'git://notgithub.com/user/foo',
      fetchSpec: 'git://notgithub.com/user/foo',
      raw: 'git://notgithub.com/user/foo',
    },

    '@foo/bar@git+ssh://notgithub.com/user/foo': {
      name: '@foo/bar',
      escapedName: '@foo%2fbar',
      scope: '@foo',
      saveSpec: 'git+ssh://notgithub.com/user/foo',
      fetchSpec: 'ssh://notgithub.com/user/foo',
      rawSpec: 'git+ssh://notgithub.com/user/foo',
      raw: '@foo/bar@git+ssh://notgithub.com/user/foo',
      type: 'git',
    },

    'git@npm:not-git': {
      name: 'git',
      type: 'alias',
      subSpec: {
        type: 'range',
        registry: true,
        name: 'not-git',
        fetchSpec: '*',
      },
      raw: 'git@npm:not-git',
    },

    'not-git@hostname.com:some/repo': {
      name: null,
      type: 'git',
      saveSpec: 'git+ssh://not-git@hostname.com:some/repo',
      fetchSpec: 'not-git@hostname.com:some/repo',
      raw: 'not-git@hostname.com:some/repo',
    },

    '/path/to/foo': {
      name: null,
      escapedName: null,
      type: 'directory',
      saveSpec: 'file:/path/to/foo',
      fetchSpec: '/path/to/foo',
      raw: '/path/to/foo',
    },

    '/path/to/foo.tar': {
      name: null,
      escapedName: null,
      type: 'file',
      saveSpec: 'file:/path/to/foo.tar',
      fetchSpec: '/path/to/foo.tar',
      raw: '/path/to/foo.tar',
    },

    '/path/to/foo.tgz': {
      name: null,
      escapedName: null,
      type: 'file',
      saveSpec: 'file:/path/to/foo.tgz',
      fetchSpec: '/path/to/foo.tgz',
      raw: '/path/to/foo.tgz',
    },
    'file:path/to/foo': {
      name: null,
      escapedName: null,
      type: 'directory',
      saveSpec: 'file:path/to/foo',
      fetchSpec: '/test/a/b/path/to/foo',
      raw: 'file:path/to/foo',
    },
    'file:path/to/foo.tar.gz': {
      name: null,
      escapedName: null,
      type: 'file',
      saveSpec: 'file:path/to/foo.tar.gz',
      fetchSpec: '/test/a/b/path/to/foo.tar.gz',
      raw: 'file:path/to/foo.tar.gz',
    },

    'file:~/path/to/foo': {
      name: null,
      escapedName: null,
      type: 'directory',
      saveSpec: 'file:~/path/to/foo',
      fetchSpec: path.normalize(path.join(os.homedir(), '/path/to/foo')),
      raw: 'file:~/path/to/foo',
    },

    'file:/~/path/to/foo': {
      name: null,
      escapedName: null,
      type: 'directory',
      saveSpec: 'file:~/path/to/foo',
      fetchSpec: path.normalize(path.join(os.homedir(), '/path/to/foo')),
      raw: 'file:/~/path/to/foo',
    },

    'file:/~path/to/foo': {
      name: null,
      escapedName: null,
      type: 'directory',
      saveSpec: 'file:/~path/to/foo',
      fetchSpec: '/~path/to/foo',
      raw: 'file:/~path/to/foo',
    },

    'file:/.path/to/foo': {
      name: null,
      escapedName: null,
      type: 'directory',
      saveSpec: 'file:/.path/to/foo',
      fetchSpec: '/.path/to/foo',
      raw: 'file:/.path/to/foo',
    },

    'file:./path/to/foo': {
      name: null,
      escapedName: null,
      type: 'directory',
      saveSpec: 'file:path/to/foo',
      fetchSpec: '/test/a/b/path/to/foo',
      raw: 'file:./path/to/foo',
    },

    'file:/./path/to/foo': {
      name: null,
      escapedName: null,
      type: 'directory',
      saveSpec: 'file:path/to/foo',
      fetchSpec: '/test/a/b/path/to/foo',
      raw: 'file:/./path/to/foo',
    },

    'file://./path/to/foo': {
      name: null,
      escapedName: null,
      type: 'directory',
      saveSpec: 'file:path/to/foo',
      fetchSpec: '/test/a/b/path/to/foo',
      raw: 'file://./path/to/foo',
    },

    'file:../path/to/foo': {
      name: null,
      escapedName: null,
      type: 'directory',
      saveSpec: 'file:../path/to/foo',
      fetchSpec: '/test/a/path/to/foo',
      raw: 'file:../path/to/foo',
    },

    'file:/../path/to/foo': {
      name: null,
      escapedName: null,
      type: 'directory',
      saveSpec: 'file:../path/to/foo',
      fetchSpec: '/test/a/path/to/foo',
      raw: 'file:/../path/to/foo',
    },

    'file://../path/to/foo': {
      name: null,
      escapedName: null,
      type: 'directory',
      saveSpec: 'file:../path/to/foo',
      fetchSpec: '/test/a/path/to/foo',
      raw: 'file://../path/to/foo',
    },

    'file:///path/to/foo': {
      name: null,
      escapedName: null,
      type: 'directory',
      saveSpec: 'file:/path/to/foo',
      fetchSpec: '/path/to/foo',
      raw: 'file:///path/to/foo',
    },
    'file:/path/to/foo': {
      name: null,
      escapedName: null,
      type: 'directory',
      saveSpec: 'file:/path/to/foo',
      fetchSpec: '/path/to/foo',
      raw: 'file:/path/to/foo',
    },
    'file://path/to/foo': {
      name: null,
      escapedName: null,
      type: 'directory',
      saveSpec: 'file:/path/to/foo',
      fetchSpec: '/path/to/foo',
      raw: 'file://path/to/foo',
    },
    'file:////path/to/foo': {
      name: null,
      escapedName: null,
      type: 'directory',
      saveSpec: 'file:/path/to/foo',
      fetchSpec: '/path/to/foo',
      raw: 'file:////path/to/foo',
    },

    'file://.': {
      name: null,
      escapedName: null,
      type: 'directory',
      saveSpec: 'file:',
      fetchSpec: '/test/a/b',
      raw: 'file://.',
    },

    'http://insecure.com/foo.tgz': {
      name: null,
      escapedName: null,
      type: 'remote',
      saveSpec: 'http://insecure.com/foo.tgz',
      fetchSpec: 'http://insecure.com/foo.tgz',
      raw: 'http://insecure.com/foo.tgz',
    },

    'https://server.com/foo.tgz': {
      name: null,
      escapedName: null,
      type: 'remote',
      saveSpec: 'https://server.com/foo.tgz',
      fetchSpec: 'https://server.com/foo.tgz',
      raw: 'https://server.com/foo.tgz',
    },

    'foo@latest': {
      name: 'foo',
      escapedName: 'foo',
      type: 'tag',
      saveSpec: null,
      fetchSpec: 'latest',
      raw: 'foo@latest',
    },

    foo: {
      name: 'foo',
      escapedName: 'foo',
      type: 'range',
      saveSpec: null,
      fetchSpec: '*',
      raw: 'foo',
    },

    'foo@ 1.2 ': {
      name: 'foo',
      escapedName: 'foo',
      type: 'range',
      saveSpec: null,
      fetchSpec: '1.2',
      raw: 'foo@ 1.2 ',
      rawSpec: ' 1.2 ',
    },

    'foo@ 1.2.3 ': {
      name: 'foo',
      escapedName: 'foo',
      type: 'version',
      saveSpec: null,
      fetchSpec: '1.2.3',
      raw: 'foo@ 1.2.3 ',
      rawSpec: ' 1.2.3 ',
    },

    'foo@1.2.3 ': {
      name: 'foo',
      escapedName: 'foo',
      type: 'version',
      saveSpec: null,
      fetchSpec: '1.2.3',
      raw: 'foo@1.2.3 ',
      rawSpec: '1.2.3 ',
    },

    'foo@ 1.2.3': {
      name: 'foo',
      escapedName: 'foo',
      type: 'version',
      saveSpec: null,
      fetchSpec: '1.2.3',
      raw: 'foo@ 1.2.3',
      rawSpec: ' 1.2.3',
    },
  },
  bitbucket: {
    'bitbucket:user/foo-js': {
      name: null,
      type: 'git',
      saveSpec: 'bitbucket:user/foo-js',
      raw: 'bitbucket:user/foo-js',
    },

    'bitbucket:user/foo-js#bar/baz': {
      name: null,
      type: 'git',
      saveSpec: 'bitbucket:user/foo-js#bar/baz',
      raw: 'bitbucket:user/foo-js#bar/baz',
    },

    'bitbucket:user..blerg--/..foo-js# . . . . . some . tags / / /': {
      name: null,
      type: 'git',
      saveSpec: 'bitbucket:user..blerg--/..foo-js# . . . . . some . tags / / /',
      raw: 'bitbucket:user..blerg--/..foo-js# . . . . . some . tags / / /',
    },

    'bitbucket:user/foo-js#bar/baz/bin': {
      name: null,
      type: 'git',
      saveSpec: 'bitbucket:user/foo-js#bar/baz/bin',
      raw: 'bitbucket:user/foo-js#bar/baz/bin',
    },

    'foo@bitbucket:user/foo-js': {
      name: 'foo',
      type: 'git',
      saveSpec: 'bitbucket:user/foo-js',
      raw: 'foo@bitbucket:user/foo-js',
    },

    'git+ssh://git@bitbucket.org/user/foo#1.2.3': {
      name: null,
      type: 'git',
      saveSpec: 'git+ssh://git@bitbucket.org/user/foo.git#1.2.3',
      raw: 'git+ssh://git@bitbucket.org/user/foo#1.2.3',
    },

    'https://bitbucket.org/user/foo.git': {
      name: null,
      type: 'git',
      saveSpec: 'git+https://bitbucket.org/user/foo.git',
      raw: 'https://bitbucket.org/user/foo.git',
    },

    '@foo/bar@git+ssh://bitbucket.org/user/foo': {
      name: '@foo/bar',
      scope: '@foo',
      type: 'git',
      saveSpec: 'git+ssh://git@bitbucket.org/user/foo.git',
      rawSpec: 'git+ssh://bitbucket.org/user/foo',
      raw: '@foo/bar@git+ssh://bitbucket.org/user/foo',
    },
  },
  github: {
    'user/foo-js': {
      name: null,
      type: 'git',
      saveSpec: 'github:user/foo-js',
      raw: 'user/foo-js',
    },

    'user/foo-js#bar/baz': {
      name: null,
      type: 'git',
      saveSpec: 'github:user/foo-js#bar/baz',
      raw: 'user/foo-js#bar/baz',
    },

    'user..blerg--/..foo-js# . . . . . some . tags / / /': {
      name: null,
      type: 'git',
      saveSpec: 'github:user..blerg--/..foo-js# . . . . . some . tags / / /',
      raw: 'user..blerg--/..foo-js# . . . . . some . tags / / /',
    },

    'user/foo-js#bar/baz/bin': {
      name: null,
      type: 'git',
      raw: 'user/foo-js#bar/baz/bin',
    },

    'foo@user/foo-js': {
      name: 'foo',
      type: 'git',
      saveSpec: 'github:user/foo-js',
      raw: 'foo@user/foo-js',
    },

    'github:user/foo-js': {
      name: null,
      type: 'git',
      saveSpec: 'github:user/foo-js',
      raw: 'github:user/foo-js',
    },

    'git+ssh://git@github.com/user/foo#1.2.3': {
      name: null,
      type: 'git',
      saveSpec: 'git+ssh://git@github.com/user/foo.git#1.2.3',
      raw: 'git+ssh://git@github.com/user/foo#1.2.3',
    },

    'git+ssh://git@github.com:user/foo#1.2.3': {
      name: null,
      type: 'git',
      saveSpec: 'git+ssh://git@github.com/user/foo.git#1.2.3',
      raw: 'git+ssh://git@github.com:user/foo#1.2.3',
    },

    'git://github.com/user/foo': {
      name: null,
      type: 'git',
      saveSpec: 'git://github.com/user/foo.git',
      raw: 'git://github.com/user/foo',
    },

    'https://github.com/user/foo.git': {
      name: null,
      type: 'git',
      saveSpec: 'git+https://github.com/user/foo.git',
      raw: 'https://github.com/user/foo.git',
    },

    '@foo/bar@git+ssh://github.com/user/foo': {
      name: '@foo/bar',
      scope: '@foo',
      type: 'git',
      saveSpec: 'git+ssh://git@github.com/user/foo.git',
      rawSpec: 'git+ssh://github.com/user/foo',
      raw: '@foo/bar@git+ssh://github.com/user/foo',
    },

    'foo@bar/foo': {
      name: 'foo',
      type: 'git',
      saveSpec: 'github:bar/foo',
      raw: 'foo@bar/foo',
    },

    'git@github.com:12345': {
      name: undefined,
      type: 'git',
      saveSpec: 'git+ssh://git@github.com:12345',
      fetchSpec: 'ssh://git@github.com:12345',
      raw: 'git@github.com:12345',
    },

    'git@github.com:12345/': {
      name: undefined,
      type: 'git',
      saveSpec: 'git+ssh://git@github.com:12345/',
      fetchSpec: 'ssh://git@github.com:12345/',
      raw: 'git@github.com:12345/',
    },

    'git@github.com:12345/foo': {
      name: undefined,
      type: 'git',
      saveSpec: 'git+ssh://git@github.com:12345/foo',
      fetchSpec: 'ssh://git@github.com:12345/foo',
      raw: 'git@github.com:12345/foo',
    },

    'git@github.com:12345foo': {
      name: undefined,
      type: 'git',
      saveSpec: 'git+ssh://git@github.com:12345foo',
      fetchSpec: 'git@github.com:12345foo',
      raw: 'git@github.com:12345foo',
    },
  },
  gitlab: {
    'gitlab:user/foo-js': {
      name: null,
      type: 'git',
      raw: 'gitlab:user/foo-js',
    },

    'gitlab:user/foo-js#bar/baz': {
      name: null,
      type: 'git',
      raw: 'gitlab:user/foo-js#bar/baz',
    },

    'gitlab:user..blerg--/..foo-js# . . . . . some . tags / / /': {
      name: null,
      type: 'git',
      saveSpec: 'gitlab:user..blerg--/..foo-js# . . . . . some . tags / / /',
      raw: 'gitlab:user..blerg--/..foo-js# . . . . . some . tags / / /',
    },

    'gitlab:user/foo-js#bar/baz/bin': {
      name: null,
      type: 'git',
      saveSpec: 'gitlab:user/foo-js#bar/baz/bin',
      raw: 'gitlab:user/foo-js#bar/baz/bin',
    },

    'foo@gitlab:user/foo-js': {
      name: 'foo',
      type: 'git',
      saveSpec: 'gitlab:user/foo-js',
      raw: 'foo@gitlab:user/foo-js',
    },

    'git+ssh://git@gitlab.com/user/foo#1.2.3': {
      name: null,
      type: 'git',
      saveSpec: 'git+ssh://git@gitlab.com/user/foo.git#1.2.3',
      raw: 'git+ssh://git@gitlab.com/user/foo#1.2.3',
    },

    'https://gitlab.com/user/foo.git': {
      name: null,
      type: 'git',
      saveSpec: 'git+https://gitlab.com/user/foo.git',
      raw: 'https://gitlab.com/user/foo.git',
    },

    '@foo/bar@git+ssh://gitlab.com/user/foo': {
      name: '@foo/bar',
      scope: '@foo',
      type: 'git',
      saveSpec: 'git+ssh://git@gitlab.com/user/foo.git',
      rawSpec: 'git+ssh://gitlab.com/user/foo',
      raw: '@foo/bar@git+ssh://gitlab.com/user/foo',
    },
  },
  windows: {
    'C:\\x\\y\\z': {
      raw: 'C:\\x\\y\\z',
      scope: null,
      name: null,
      escapedName: null,
      rawSpec: 'C:\\x\\y\\z',
      fetchSpec: 'C:\\x\\y\\z',
      type: 'directory',
    },

    'foo@C:\\x\\y\\z': {
      raw: 'foo@C:\\x\\y\\z',
      scope: null,
      name: 'foo',
      escapedName: 'foo',
      rawSpec: 'C:\\x\\y\\z',
      fetchSpec: 'C:\\x\\y\\z',
      type: 'directory',
    },

    'foo@file:///C:\\x\\y\\z': {
      raw: 'foo@file:///C:\\x\\y\\z',
      scope: null,
      name: 'foo',
      escapedName: 'foo',
      rawSpec: 'file:///C:\\x\\y\\z',
      fetchSpec: 'C:\\x\\y\\z',
      type: 'directory',
    },

    'foo@file://C:\\x\\y\\z': {
      raw: 'foo@file://C:\\x\\y\\z',
      scope: null,
      name: 'foo',
      escapedName: 'foo',
      rawSpec: 'file://C:\\x\\y\\z',
      fetchSpec: 'C:\\x\\y\\z',
      type: 'directory',
    },

    'file:///C:\\x\\y\\z': {
      raw: 'file:///C:\\x\\y\\z',
      scope: null,
      name: null,
      escapedName: null,
      rawSpec: 'file:///C:\\x\\y\\z',
      fetchSpec: 'C:\\x\\y\\z',
      type: 'directory',
    },

    'file://C:\\x\\y\\z': {
      raw: 'file://C:\\x\\y\\z',
      scope: null,
      name: null,
      escapedName: null,
      rawSpec: 'file://C:\\x\\y\\z',
      fetchSpec: 'C:\\x\\y\\z',
      type: 'directory',
    },

    'foo@/foo/bar/baz': {
      raw: 'foo@/foo/bar/baz',
      scope: null,
      name: 'foo',
      escapedName: 'foo',
      rawSpec: '/foo/bar/baz',
      fetchSpec: 'C:\\foo\\bar\\baz',
      type: 'directory',
    },

    'foo@git+file://C:\\x\\y\\z': {
      type: 'git',
      registry: null,
      where: null,
      raw: 'foo@git+file://C:\\x\\y\\z',
      name: 'foo',
      escapedName: 'foo',
      scope: null,
      rawSpec: 'git+file://C:\\x\\y\\z',
      saveSpec: 'git+file://C:\\x\\y\\z',
      fetchSpec: 'file://c:/x/y/z',
      gitRange: null,
      gitCommittish: null,
      hosted: null,
    },
  },
};
