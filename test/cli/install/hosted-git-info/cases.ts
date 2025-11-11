/**
 * Contains all the possible test cases that hosted-git-archive.test.ts tests against.
 *
 * These are organized according to the structure in https://github.com/npm/hosted-git-info/blob/main/test/ at the time
 * of writing.
 *
 * TODO(markovejnovic): This does not include the following set of tests:
 *   - https://github.com/npm/hosted-git-info/blob/main/test/file.js
 *   - https://github.com/npm/hosted-git-info/blob/main/test/parse-url.js
 */
// This is a valid git branch name that contains other occurences of the characters we check
// for to determine the committish in order to test that we parse those correctly
const committishDefaults = { committish: "lk/br@nch.t#st:^1.0.0-pre.4" };

type Provider = "bitbucket" | "gist" | "github" | "gitlab" | "sourcehut" | "misc";

const defaults = {
  bitbucket: { type: "bitbucket", user: "foo", project: "bar" },
  gist: { type: "gist", user: null, project: "feedbeef" },
  github: { type: "github", user: "foo", project: "bar" },
  gitlab: { type: "gitlab", user: "foo", project: "bar" },
  gitlabSubgroup: { type: "gitlab", user: "foo/bar", project: "baz" },
  sourcehut: { type: "sourcehut", user: "~foo", project: "bar" },
};

export const validGitUrls: { [K in Provider]: { [K in string]: object } } = {
  bitbucket: {
    // shortcuts
    //
    // NOTE auth is accepted but ignored
    "bitbucket:foo/bar": { ...defaults.bitbucket, default: "shortcut" },
    "bitbucket:foo/bar#branch": { ...defaults.bitbucket, default: "shortcut", committish: "branch" },
    "bitbucket:user@foo/bar": { ...defaults.bitbucket, default: "shortcut", auth: null },
    "bitbucket:user@foo/bar#branch": { ...defaults.bitbucket, default: "shortcut", auth: null, committish: "branch" },
    "bitbucket:user:password@foo/bar": { ...defaults.bitbucket, default: "shortcut", auth: null },
    "bitbucket:user:password@foo/bar#branch": {
      ...defaults.bitbucket,
      default: "shortcut",
      auth: null,
      committish: "branch",
    },
    "bitbucket::password@foo/bar": { ...defaults.bitbucket, default: "shortcut", auth: null },
    "bitbucket::password@foo/bar#branch": {
      ...defaults.bitbucket,
      default: "shortcut",
      auth: null,
      committish: "branch",
    },

    "bitbucket:foo/bar.git": { ...defaults.bitbucket, default: "shortcut" },
    "bitbucket:foo/bar.git#branch": { ...defaults.bitbucket, default: "shortcut", committish: "branch" },
    "bitbucket:user@foo/bar.git": { ...defaults.bitbucket, default: "shortcut", auth: null },
    "bitbucket:user@foo/bar.git#branch": {
      ...defaults.bitbucket,
      default: "shortcut",
      auth: null,
      committish: "branch",
    },
    "bitbucket:user:password@foo/bar.git": { ...defaults.bitbucket, default: "shortcut", auth: null },
    "bitbucket:user:password@foo/bar.git#branch": {
      ...defaults.bitbucket,
      default: "shortcut",
      auth: null,
      committish: "branch",
    },
    "bitbucket::password@foo/bar.git": { ...defaults.bitbucket, default: "shortcut", auth: null },
    "bitbucket::password@foo/bar.git#branch": {
      ...defaults.bitbucket,
      default: "shortcut",
      auth: null,
      committish: "branch",
    },

    // no-protocol git+ssh
    //
    // NOTE auth is accepted but ignored
    "git@bitbucket.org:foo/bar": { ...defaults.bitbucket, default: "sshurl", auth: null },
    "git@bitbucket.org:foo/bar#branch": {
      ...defaults.bitbucket,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "user@bitbucket.org:foo/bar": { ...defaults.bitbucket, default: "sshurl", auth: null },
    "user@bitbucket.org:foo/bar#branch": {
      ...defaults.bitbucket,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "user:password@bitbucket.org:foo/bar": { ...defaults.bitbucket, default: "sshurl", auth: null },
    "user:password@bitbucket.org:foo/bar#branch": {
      ...defaults.bitbucket,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    ":password@bitbucket.org:foo/bar": { ...defaults.bitbucket, default: "sshurl", auth: null },
    ":password@bitbucket.org:foo/bar#branch": {
      ...defaults.bitbucket,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    "git@bitbucket.org:foo/bar.git": { ...defaults.bitbucket, default: "sshurl", auth: null },
    "git@bitbucket.org:foo/bar.git#branch": {
      ...defaults.bitbucket,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "user@bitbucket.org:foo/bar.git": { ...defaults.bitbucket, default: "sshurl", auth: null },
    "user@bitbucket.org:foo/bar.git#branch": {
      ...defaults.bitbucket,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "user:password@bitbucket.org:foo/bar.git": { ...defaults.bitbucket, default: "sshurl", auth: null },
    "user:password@bitbucket.org:foo/bar.git#branch": {
      ...defaults.bitbucket,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    ":password@bitbucket.org:foo/bar.git": { ...defaults.bitbucket, default: "sshurl", auth: null },
    ":password@bitbucket.org:foo/bar.git#branch": {
      ...defaults.bitbucket,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    // git+ssh urls
    //
    // NOTE auth is accepted but ignored
    "git+ssh://bitbucket.org:foo/bar": { ...defaults.bitbucket, default: "sshurl" },
    "git+ssh://bitbucket.org:foo/bar#branch": { ...defaults.bitbucket, default: "sshurl", committish: "branch" },
    "git+ssh://user@bitbucket.org:foo/bar": { ...defaults.bitbucket, default: "sshurl", auth: null },
    "git+ssh://user@bitbucket.org:foo/bar#branch": {
      ...defaults.bitbucket,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "git+ssh://user:password@bitbucket.org:foo/bar": { ...defaults.bitbucket, default: "sshurl", auth: null },
    "git+ssh://user:password@bitbucket.org:foo/bar#branch": {
      ...defaults.bitbucket,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "git+ssh://:password@bitbucket.org:foo/bar": { ...defaults.bitbucket, default: "sshurl", auth: null },
    "git+ssh://:password@bitbucket.org:foo/bar#branch": {
      ...defaults.bitbucket,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    "git+ssh://bitbucket.org:foo/bar.git": { ...defaults.bitbucket, default: "sshurl" },
    "git+ssh://bitbucket.org:foo/bar.git#branch": { ...defaults.bitbucket, default: "sshurl", committish: "branch" },
    "git+ssh://user@bitbucket.org:foo/bar.git": { ...defaults.bitbucket, default: "sshurl", auth: null },
    "git+ssh://user@bitbucket.org:foo/bar.git#branch": {
      ...defaults.bitbucket,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "git+ssh://user:password@bitbucket.org:foo/bar.git": { ...defaults.bitbucket, default: "sshurl", auth: null },
    "git+ssh://user:password@bitbucket.org:foo/bar.git#branch": {
      ...defaults.bitbucket,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "git+ssh://:password@bitbucket.org:foo/bar.git": { ...defaults.bitbucket, default: "sshurl", auth: null },
    "git+ssh://:password@bitbucket.org:foo/bar.git#branch": {
      ...defaults.bitbucket,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    // ssh urls
    //
    // NOTE auth is accepted but ignored
    "ssh://bitbucket.org:foo/bar": { ...defaults.bitbucket, default: "sshurl" },
    "ssh://bitbucket.org:foo/bar#branch": { ...defaults.bitbucket, default: "sshurl", committish: "branch" },
    "ssh://user@bitbucket.org:foo/bar": { ...defaults.bitbucket, default: "sshurl", auth: null },
    "ssh://user@bitbucket.org:foo/bar#branch": {
      ...defaults.bitbucket,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "ssh://user:password@bitbucket.org:foo/bar": { ...defaults.bitbucket, default: "sshurl", auth: null },
    "ssh://user:password@bitbucket.org:foo/bar#branch": {
      ...defaults.bitbucket,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "ssh://:password@bitbucket.org:foo/bar": { ...defaults.bitbucket, default: "sshurl", auth: null },
    "ssh://:password@bitbucket.org:foo/bar#branch": {
      ...defaults.bitbucket,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    "ssh://bitbucket.org:foo/bar.git": { ...defaults.bitbucket, default: "sshurl" },
    "ssh://bitbucket.org:foo/bar.git#branch": { ...defaults.bitbucket, default: "sshurl", committish: "branch" },
    "ssh://user@bitbucket.org:foo/bar.git": { ...defaults.bitbucket, default: "sshurl", auth: null },
    "ssh://user@bitbucket.org:foo/bar.git#branch": {
      ...defaults.bitbucket,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "ssh://user:password@bitbucket.org:foo/bar.git": { ...defaults.bitbucket, default: "sshurl", auth: null },
    "ssh://user:password@bitbucket.org:foo/bar.git#branch": {
      ...defaults.bitbucket,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "ssh://:password@bitbucket.org:foo/bar.git": { ...defaults.bitbucket, default: "sshurl", auth: null },
    "ssh://:password@bitbucket.org:foo/bar.git#branch": {
      ...defaults.bitbucket,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    // git+https urls
    //
    // NOTE auth is accepted and respected
    "git+https://bitbucket.org/foo/bar": { ...defaults.bitbucket, default: "https" },
    "git+https://bitbucket.org/foo/bar#branch": { ...defaults.bitbucket, default: "https", committish: "branch" },
    "git+https://user@bitbucket.org/foo/bar": { ...defaults.bitbucket, default: "https", auth: "user" },
    "git+https://user@bitbucket.org/foo/bar#branch": {
      ...defaults.bitbucket,
      default: "https",
      auth: "user",
      committish: "branch",
    },
    "git+https://user:password@bitbucket.org/foo/bar": {
      ...defaults.bitbucket,
      default: "https",
      auth: "user:password",
    },
    "git+https://user:password@bitbucket.org/foo/bar#branch": {
      ...defaults.bitbucket,
      default: "https",
      auth: "user:password",
      committish: "branch",
    },
    "git+https://:password@bitbucket.org/foo/bar": { ...defaults.bitbucket, default: "https", auth: ":password" },
    "git+https://:password@bitbucket.org/foo/bar#branch": {
      ...defaults.bitbucket,
      default: "https",
      auth: ":password",
      committish: "branch",
    },

    "git+https://bitbucket.org/foo/bar.git": { ...defaults.bitbucket, default: "https" },
    "git+https://bitbucket.org/foo/bar.git#branch": { ...defaults.bitbucket, default: "https", committish: "branch" },
    "git+https://user@bitbucket.org/foo/bar.git": { ...defaults.bitbucket, default: "https", auth: "user" },
    "git+https://user@bitbucket.org/foo/bar.git#branch": {
      ...defaults.bitbucket,
      default: "https",
      auth: "user",
      committish: "branch",
    },
    "git+https://user:password@bitbucket.org/foo/bar.git": {
      ...defaults.bitbucket,
      default: "https",
      auth: "user:password",
    },
    "git+https://user:password@bitbucket.org/foo/bar.git#branch": {
      ...defaults.bitbucket,
      default: "https",
      auth: "user:password",
      committish: "branch",
    },
    "git+https://:password@bitbucket.org/foo/bar.git": { ...defaults.bitbucket, default: "https", auth: ":password" },
    "git+https://:password@bitbucket.org/foo/bar.git#branch": {
      ...defaults.bitbucket,
      default: "https",
      auth: ":password",
      committish: "branch",
    },

    // https urls
    //
    // NOTE auth is accepted and respected
    "https://bitbucket.org/foo/bar": { ...defaults.bitbucket, default: "https" },
    "https://bitbucket.org/foo/bar#branch": { ...defaults.bitbucket, default: "https", committish: "branch" },
    "https://user@bitbucket.org/foo/bar": { ...defaults.bitbucket, default: "https", auth: "user" },
    "https://user@bitbucket.org/foo/bar#branch": {
      ...defaults.bitbucket,
      default: "https",
      auth: "user",
      committish: "branch",
    },
    "https://user:password@bitbucket.org/foo/bar": { ...defaults.bitbucket, default: "https", auth: "user:password" },
    "https://user:password@bitbucket.org/foo/bar#branch": {
      ...defaults.bitbucket,
      default: "https",
      auth: "user:password",
      committish: "branch",
    },
    "https://:password@bitbucket.org/foo/bar": { ...defaults.bitbucket, default: "https", auth: ":password" },
    "https://:password@bitbucket.org/foo/bar#branch": {
      ...defaults.bitbucket,
      default: "https",
      auth: ":password",
      committish: "branch",
    },

    "https://bitbucket.org/foo/bar.git": { ...defaults.bitbucket, default: "https" },
    "https://bitbucket.org/foo/bar.git#branch": { ...defaults.bitbucket, default: "https", committish: "branch" },
    "https://user@bitbucket.org/foo/bar.git": { ...defaults.bitbucket, default: "https", auth: "user" },
    "https://user@bitbucket.org/foo/bar.git#branch": {
      ...defaults.bitbucket,
      default: "https",
      auth: "user",
      committish: "branch",
    },
    "https://user:password@bitbucket.org/foo/bar.git": {
      ...defaults.bitbucket,
      default: "https",
      auth: "user:password",
    },
    "https://user:password@bitbucket.org/foo/bar.git#branch": {
      ...defaults.bitbucket,
      default: "https",
      auth: "user:password",
      committish: "branch",
    },
    "https://:password@bitbucket.org/foo/bar.git": { ...defaults.bitbucket, default: "https", auth: ":password" },
    "https://:password@bitbucket.org/foo/bar.git#branch": {
      ...defaults.bitbucket,
      default: "https",
      auth: ":password",
      committish: "branch",
    },
  },
  gist: {
    // shortcuts
    //
    // NOTE auth is accepted but ignored
    "gist:feedbeef": { ...defaults.gist, default: "shortcut" },
    "gist:feedbeef#branch": { ...defaults.gist, default: "shortcut", committish: "branch" },
    "gist:user@feedbeef": { ...defaults.gist, default: "shortcut", auth: null },
    "gist:user@feedbeef#branch": { ...defaults.gist, default: "shortcut", auth: null, committish: "branch" },
    "gist:user:password@feedbeef": { ...defaults.gist, default: "shortcut", auth: null },
    "gist:user:password@feedbeef#branch": { ...defaults.gist, default: "shortcut", auth: null, committish: "branch" },
    "gist::password@feedbeef": { ...defaults.gist, default: "shortcut", auth: null },
    "gist::password@feedbeef#branch": { ...defaults.gist, default: "shortcut", auth: null, committish: "branch" },

    "gist:feedbeef.git": { ...defaults.gist, default: "shortcut" },
    "gist:feedbeef.git#branch": { ...defaults.gist, default: "shortcut", committish: "branch" },
    "gist:user@feedbeef.git": { ...defaults.gist, default: "shortcut", auth: null },
    "gist:user@feedbeef.git#branch": { ...defaults.gist, default: "shortcut", auth: null, committish: "branch" },
    "gist:user:password@feedbeef.git": { ...defaults.gist, default: "shortcut", auth: null },
    "gist:user:password@feedbeef.git#branch": {
      ...defaults.gist,
      default: "shortcut",
      auth: null,
      committish: "branch",
    },
    "gist::password@feedbeef.git": { ...defaults.gist, default: "shortcut", auth: null },
    "gist::password@feedbeef.git#branch": { ...defaults.gist, default: "shortcut", auth: null, committish: "branch" },

    "gist:/feedbeef": { ...defaults.gist, default: "shortcut" },
    "gist:/feedbeef#branch": { ...defaults.gist, default: "shortcut", committish: "branch" },
    "gist:user@/feedbeef": { ...defaults.gist, default: "shortcut", auth: null },
    "gist:user@/feedbeef#branch": { ...defaults.gist, default: "shortcut", auth: null, committish: "branch" },
    "gist:user:password@/feedbeef": { ...defaults.gist, default: "shortcut", auth: null },
    "gist:user:password@/feedbeef#branch": {
      ...defaults.gist,
      default: "shortcut",
      auth: null,
      committish: "branch",
    },
    "gist::password@/feedbeef": { ...defaults.gist, default: "shortcut", auth: null },
    "gist::password@/feedbeef#branch": { ...defaults.gist, default: "shortcut", auth: null, committish: "branch" },

    "gist:/feedbeef.git": { ...defaults.gist, default: "shortcut" },
    "gist:/feedbeef.git#branch": { ...defaults.gist, default: "shortcut", committish: "branch" },
    "gist:user@/feedbeef.git": { ...defaults.gist, default: "shortcut", auth: null },
    "gist:user@/feedbeef.git#branch": { ...defaults.gist, default: "shortcut", auth: null, committish: "branch" },
    "gist:user:password@/feedbeef.git": { ...defaults.gist, default: "shortcut", auth: null },
    "gist:user:password@/feedbeef.git#branch": {
      ...defaults.gist,
      default: "shortcut",
      auth: null,
      committish: "branch",
    },
    "gist::password@/feedbeef.git": { ...defaults.gist, default: "shortcut", auth: null },
    "gist::password@/feedbeef.git#branch": {
      ...defaults.gist,
      default: "shortcut",
      auth: null,
      committish: "branch",
    },

    "gist:foo/feedbeef": { ...defaults.gist, default: "shortcut", user: "foo" },
    "gist:foo/feedbeef#branch": { ...defaults.gist, default: "shortcut", user: "foo", committish: "branch" },
    "gist:user@foo/feedbeef": { ...defaults.gist, default: "shortcut", user: "foo", auth: null },
    "gist:user@foo/feedbeef#branch": {
      ...defaults.gist,
      default: "shortcut",
      user: "foo",
      auth: null,
      committish: "branch",
    },
    "gist:user:password@foo/feedbeef": { ...defaults.gist, default: "shortcut", user: "foo", auth: null },
    "gist:user:password@foo/feedbeef#branch": {
      ...defaults.gist,
      default: "shortcut",
      user: "foo",
      auth: null,
      committish: "branch",
    },
    "gist::password@foo/feedbeef": { ...defaults.gist, default: "shortcut", user: "foo", auth: null },
    "gist::password@foo/feedbeef#branch": {
      ...defaults.gist,
      default: "shortcut",
      user: "foo",
      auth: null,
      committish: "branch",
    },

    "gist:foo/feedbeef.git": { ...defaults.gist, default: "shortcut", user: "foo" },
    "gist:foo/feedbeef.git#branch": { ...defaults.gist, default: "shortcut", user: "foo", committish: "branch" },
    "gist:user@foo/feedbeef.git": { ...defaults.gist, default: "shortcut", user: "foo", auth: null },
    "gist:user@foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "shortcut",
      user: "foo",
      auth: null,
      committish: "branch",
    },
    "gist:user:password@foo/feedbeef.git": { ...defaults.gist, default: "shortcut", user: "foo", auth: null },
    "gist:user:password@foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "shortcut",
      user: "foo",
      auth: null,
      committish: "branch",
    },
    "gist::password@foo/feedbeef.git": { ...defaults.gist, default: "shortcut", user: "foo", auth: null },
    "gist::password@foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "shortcut",
      user: "foo",
      auth: null,
      committish: "branch",
    },

    // git urls
    //
    // NOTE auth is accepted and respected
    "git://gist.github.com/feedbeef": { ...defaults.gist, default: "git" },
    "git://gist.github.com/feedbeef#branch": { ...defaults.gist, default: "git", committish: "branch" },
    "git://user@gist.github.com/feedbeef": { ...defaults.gist, default: "git", auth: "user" },
    "git://user@gist.github.com/feedbeef#branch": {
      ...defaults.gist,
      default: "git",
      auth: "user",
      committish: "branch",
    },
    "git://user:password@gist.github.com/feedbeef": { ...defaults.gist, default: "git", auth: "user:password" },
    "git://user:password@gist.github.com/feedbeef#branch": {
      ...defaults.gist,
      default: "git",
      auth: "user:password",
      committish: "branch",
    },
    "git://:password@gist.github.com/feedbeef": { ...defaults.gist, default: "git", auth: ":password" },
    "git://:password@gist.github.com/feedbeef#branch": {
      ...defaults.gist,
      default: "git",
      auth: ":password",
      committish: "branch",
    },

    "git://gist.github.com/feedbeef.git": { ...defaults.gist, default: "git" },
    "git://gist.github.com/feedbeef.git#branch": { ...defaults.gist, default: "git", committish: "branch" },
    "git://user@gist.github.com/feedbeef.git": { ...defaults.gist, default: "git", auth: "user" },
    "git://user@gist.github.com/feedbeef.git#branch": {
      ...defaults.gist,
      default: "git",
      auth: "user",
      committish: "branch",
    },
    "git://user:password@gist.github.com/feedbeef.git": { ...defaults.gist, default: "git", auth: "user:password" },
    "git://user:password@gist.github.com/feedbeef.git#branch": {
      ...defaults.gist,
      default: "git",
      auth: "user:password",
      committish: "branch",
    },
    "git://:password@gist.github.com/feedbeef.git": { ...defaults.gist, default: "git", auth: ":password" },
    "git://:password@gist.github.com/feedbeef.git#branch": {
      ...defaults.gist,
      default: "git",
      auth: ":password",
      committish: "branch",
    },

    "git://gist.github.com/foo/feedbeef": { ...defaults.gist, default: "git", user: "foo" },
    "git://gist.github.com/foo/feedbeef#branch": {
      ...defaults.gist,
      default: "git",
      user: "foo",
      committish: "branch",
    },
    "git://user@gist.github.com/foo/feedbeef": { ...defaults.gist, default: "git", user: "foo", auth: "user" },
    "git://user@gist.github.com/foo/feedbeef#branch": {
      ...defaults.gist,
      default: "git",
      user: "foo",
      auth: "user",
      committish: "branch",
    },
    "git://user:password@gist.github.com/foo/feedbeef": {
      ...defaults.gist,
      default: "git",
      user: "foo",
      auth: "user:password",
    },
    "git://user:password@gist.github.com/foo/feedbeef#branch": {
      ...defaults.gist,
      default: "git",
      user: "foo",
      auth: "user:password",
      committish: "branch",
    },
    "git://:password@gist.github.com/foo/feedbeef": {
      ...defaults.gist,
      default: "git",
      user: "foo",
      auth: ":password",
    },
    "git://:password@gist.github.com/foo/feedbeef#branch": {
      ...defaults.gist,
      default: "git",
      user: "foo",
      auth: ":password",
      committish: "branch",
    },

    "git://gist.github.com/foo/feedbeef.git": { ...defaults.gist, default: "git", user: "foo" },
    "git://gist.github.com/foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "git",
      user: "foo",
      committish: "branch",
    },
    "git://user@gist.github.com/foo/feedbeef.git": { ...defaults.gist, default: "git", user: "foo", auth: "user" },
    "git://user@gist.github.com/foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "git",
      user: "foo",
      auth: "user",
      committish: "branch",
    },
    "git://user:password@gist.github.com/foo/feedbeef.git": {
      ...defaults.gist,
      default: "git",
      user: "foo",
      auth: "user:password",
    },
    "git://user:password@gist.github.com/foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "git",
      user: "foo",
      auth: "user:password",
      committish: "branch",
    },
    "git://:password@gist.github.com/foo/feedbeef.git": {
      ...defaults.gist,
      default: "git",
      user: "foo",
      auth: ":password",
    },
    "git://:password@gist.github.com/foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "git",
      user: "foo",
      auth: ":password",
      committish: "branch",
    },

    // no-protocol git+ssh
    //
    // NOTE auth is accepted and ignored
    "git@gist.github.com:feedbeef": { ...defaults.gist, default: "sshurl", auth: null },
    "git@gist.github.com:feedbeef#branch": { ...defaults.gist, default: "sshurl", auth: null, committish: "branch" },
    "user@gist.github.com:feedbeef": { ...defaults.gist, default: "sshurl", auth: null },
    "user@gist.github.com:feedbeef#branch": { ...defaults.gist, default: "sshurl", auth: null, committish: "branch" },
    "user:password@gist.github.com:feedbeef": { ...defaults.gist, default: "sshurl", auth: null },
    "user:password@gist.github.com:feedbeef#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    ":password@gist.github.com:feedbeef": { ...defaults.gist, default: "sshurl", auth: null },
    ":password@gist.github.com:feedbeef#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    "git@gist.github.com:feedbeef.git": { ...defaults.gist, default: "sshurl", auth: null },
    "git@gist.github.com:feedbeef.git#branch": {
      ...defaults.gist,
      default: "sshurl",
      committish: "branch",
      auth: null,
    },
    "user@gist.github.com:feedbeef.git": { ...defaults.gist, default: "sshurl", auth: null },
    "user@gist.github.com:feedbeef.git#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "user:password@gist.github.com:feedbeef.git": { ...defaults.gist, default: "sshurl", auth: null },
    "user:password@gist.github.com:feedbeef.git#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    ":password@gist.github.com:feedbeef.git": { ...defaults.gist, default: "sshurl", auth: null },
    ":password@gist.github.com:feedbeef.git#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    "git@gist.github.com:foo/feedbeef": { ...defaults.gist, default: "sshurl", auth: null, user: "foo" },
    "git@gist.github.com:foo/feedbeef#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
      committish: "branch",
    },
    "user@gist.github.com:foo/feedbeef": { ...defaults.gist, default: "sshurl", auth: null, user: "foo" },
    "user@gist.github.com:foo/feedbeef#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
      committish: "branch",
    },
    "user:password@gist.github.com:foo/feedbeef": { ...defaults.gist, default: "sshurl", auth: null, user: "foo" },
    "user:password@gist.github.com:foo/feedbeef#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
      committish: "branch",
    },
    ":password@gist.github.com:foo/feedbeef": { ...defaults.gist, default: "sshurl", auth: null, user: "foo" },
    ":password@gist.github.com:foo/feedbeef#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
      committish: "branch",
    },

    "git@gist.github.com:foo/feedbeef.git": { ...defaults.gist, default: "sshurl", auth: null, user: "foo" },
    "git@gist.github.com:foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
      committish: "branch",
    },
    "user@gist.github.com:foo/feedbeef.git": { ...defaults.gist, default: "sshurl", auth: null, user: "foo" },
    "user@gist.github.com:foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
      committish: "branch",
    },
    "user:password@gist.github.com:foo/feedbeef.git": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
    },
    "user:password@gist.github.com:foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
      committish: "branch",
    },
    ":password@gist.github.com:foo/feedbeef.git": { ...defaults.gist, default: "sshurl", auth: null, user: "foo" },
    ":password@gist.github.com:foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
      committish: "branch",
    },

    // git+ssh urls
    //
    // NOTE auth is accepted but ignored
    // NOTE see TODO at list of invalids, some inputs fail and shouldn't
    "git+ssh://gist.github.com:feedbeef": { ...defaults.gist, default: "sshurl", auth: null },
    "git+ssh://gist.github.com:feedbeef#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "git+ssh://user@gist.github.com:feedbeef": { ...defaults.gist, default: "sshurl", auth: null },
    "git+ssh://user@gist.github.com:feedbeef#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "git+ssh://user:password@gist.github.com:feedbeef": { ...defaults.gist, default: "sshurl", auth: null },
    "git+ssh://user:password@gist.github.com:feedbeef#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "git+ssh://:password@gist.github.com:feedbeef": { ...defaults.gist, default: "sshurl", auth: null },
    "git+ssh://:password@gist.github.com:feedbeef#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    "git+ssh://gist.github.com:feedbeef.git": { ...defaults.gist, default: "sshurl", auth: null },
    "git+ssh://gist.github.com:feedbeef.git#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "git+ssh://user@gist.github.com:feedbeef.git": { ...defaults.gist, default: "sshurl", auth: null },
    "git+ssh://user@gist.github.com:feedbeef.git#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "git+ssh://user:password@gist.github.com:feedbeef.git": { ...defaults.gist, default: "sshurl", auth: null },
    "git+ssh://user:password@gist.github.com:feedbeef.git#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "git+ssh://:password@gist.github.com:feedbeef.git": { ...defaults.gist, default: "sshurl", auth: null },
    "git+ssh://:password@gist.github.com:feedbeef.git#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    "git+ssh://gist.github.com:foo/feedbeef": { ...defaults.gist, default: "sshurl", user: "foo" },
    "git+ssh://gist.github.com:foo/feedbeef#branch": {
      ...defaults.gist,
      default: "sshurl",
      user: "foo",
      committish: "branch",
    },
    "git+ssh://user@gist.github.com:foo/feedbeef": { ...defaults.gist, default: "sshurl", auth: null, user: "foo" },
    "git+ssh://user@gist.github.com:foo/feedbeef#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
      committish: "branch",
    },
    "git+ssh://user:password@gist.github.com:foo/feedbeef": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
    },
    "git+ssh://user:password@gist.github.com:foo/feedbeef#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
      committish: "branch",
    },
    "git+ssh://:password@gist.github.com:foo/feedbeef": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
    },
    "git+ssh://:password@gist.github.com:foo/feedbeef#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
      committish: "branch",
    },

    "git+ssh://gist.github.com:foo/feedbeef.git": { ...defaults.gist, default: "sshurl", user: "foo" },
    "git+ssh://gist.github.com:foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "sshurl",
      user: "foo",
      committish: "branch",
    },
    "git+ssh://user@gist.github.com:foo/feedbeef.git": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
    },
    "git+ssh://user@gist.github.com:foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
      committish: "branch",
    },
    "git+ssh://user:password@gist.github.com:foo/feedbeef.git": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
    },
    "git+ssh://user:password@gist.github.com:foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
      committish: "branch",
    },
    "git+ssh://:password@gist.github.com:foo/feedbeef.git": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
    },
    "git+ssh://:password@gist.github.com:foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
      committish: "branch",
    },

    // ssh urls
    //
    // NOTE auth is accepted but ignored
    "ssh://gist.github.com:feedbeef": { ...defaults.gist, default: "sshurl", auth: null },
    "ssh://gist.github.com:feedbeef#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "ssh://user@gist.github.com:feedbeef": { ...defaults.gist, default: "sshurl", auth: null },
    "ssh://user@gist.github.com:feedbeef#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "ssh://user:password@gist.github.com:feedbeef": { ...defaults.gist, default: "sshurl", auth: null },
    "ssh://user:password@gist.github.com:feedbeef#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "ssh://:password@gist.github.com:feedbeef": { ...defaults.gist, default: "sshurl", auth: null },
    "ssh://:password@gist.github.com:feedbeef#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    "ssh://gist.github.com:feedbeef.git": { ...defaults.gist, default: "sshurl", auth: null },
    "ssh://gist.github.com:feedbeef.git#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "ssh://user@gist.github.com:feedbeef.git": { ...defaults.gist, default: "sshurl", auth: null },
    "ssh://user@gist.github.com:feedbeef.git#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "ssh://user:password@gist.github.com:feedbeef.git": { ...defaults.gist, default: "sshurl", auth: null },
    "ssh://user:password@gist.github.com:feedbeef.git#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "ssh://:password@gist.github.com:feedbeef.git": { ...defaults.gist, default: "sshurl", auth: null },
    "ssh://:password@gist.github.com:feedbeef.git#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    "ssh://gist.github.com:foo/feedbeef": { ...defaults.gist, default: "sshurl", user: "foo" },
    "ssh://gist.github.com:foo/feedbeef#branch": {
      ...defaults.gist,
      default: "sshurl",
      user: "foo",
      committish: "branch",
    },
    "ssh://user@gist.github.com:foo/feedbeef": { ...defaults.gist, default: "sshurl", auth: null, user: "foo" },
    "ssh://user@gist.github.com:foo/feedbeef#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
      committish: "branch",
    },
    "ssh://user:password@gist.github.com:foo/feedbeef": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
    },
    "ssh://user:password@gist.github.com:foo/feedbeef#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
      committish: "branch",
    },
    "ssh://:password@gist.github.com:foo/feedbeef": { ...defaults.gist, default: "sshurl", auth: null, user: "foo" },
    "ssh://:password@gist.github.com:foo/feedbeef#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
      committish: "branch",
    },

    "ssh://gist.github.com:foo/feedbeef.git": { ...defaults.gist, default: "sshurl", user: "foo" },
    "ssh://gist.github.com:foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "sshurl",
      user: "foo",
      committish: "branch",
    },
    "ssh://user@gist.github.com:foo/feedbeef.git": { ...defaults.gist, default: "sshurl", auth: null, user: "foo" },
    "ssh://user@gist.github.com:foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
      committish: "branch",
    },
    "ssh://user:password@gist.github.com:foo/feedbeef.git": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
    },
    "ssh://user:password@gist.github.com:foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
      committish: "branch",
    },
    "ssh://:password@gist.github.com:foo/feedbeef.git": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
    },
    "ssh://:password@gist.github.com:foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "sshurl",
      auth: null,
      user: "foo",
      committish: "branch",
    },

    // git+https urls
    //
    // NOTE auth is accepted and respected
    "git+https://gist.github.com/feedbeef": { ...defaults.gist, default: "https" },
    "git+https://gist.github.com/feedbeef#branch": { ...defaults.gist, default: "https", committish: "branch" },
    "git+https://user@gist.github.com/feedbeef": { ...defaults.gist, default: "https", auth: "user" },
    "git+https://user@gist.github.com/feedbeef#branch": {
      ...defaults.gist,
      default: "https",
      auth: "user",
      committish: "branch",
    },
    "git+https://user:password@gist.github.com/feedbeef": {
      ...defaults.gist,
      default: "https",
      auth: "user:password",
    },
    "git+https://user:password@gist.github.com/feedbeef#branch": {
      ...defaults.gist,
      default: "https",
      auth: "user:password",
      committish: "branch",
    },
    "git+https://:password@gist.github.com/feedbeef": { ...defaults.gist, default: "https", auth: ":password" },
    "git+https://:password@gist.github.com/feedbeef#branch": {
      ...defaults.gist,
      default: "https",
      auth: ":password",
      committish: "branch",
    },

    "git+https://gist.github.com/feedbeef.git": { ...defaults.gist, default: "https" },
    "git+https://gist.github.com/feedbeef.git#branch": { ...defaults.gist, default: "https", committish: "branch" },
    "git+https://user@gist.github.com/feedbeef.git": { ...defaults.gist, default: "https", auth: "user" },
    "git+https://user@gist.github.com/feedbeef.git#branch": {
      ...defaults.gist,
      default: "https",
      auth: "user",
      committish: "branch",
    },
    "git+https://user:password@gist.github.com/feedbeef.git": {
      ...defaults.gist,
      default: "https",
      auth: "user:password",
    },
    "git+https://user:password@gist.github.com/feedbeef.git#branch": {
      ...defaults.gist,
      default: "https",
      auth: "user:password",
      committish: "branch",
    },
    "git+https://:password@gist.github.com/feedbeef.git": { ...defaults.gist, default: "https", auth: ":password" },
    "git+https://:password@gist.github.com/feedbeef.git#branch": {
      ...defaults.gist,
      default: "https",
      auth: ":password",
      committish: "branch",
    },

    "git+https://gist.github.com/foo/feedbeef": { ...defaults.gist, default: "https", user: "foo" },
    "git+https://gist.github.com/foo/feedbeef#branch": {
      ...defaults.gist,
      default: "https",
      user: "foo",
      committish: "branch",
    },
    "git+https://user@gist.github.com/foo/feedbeef": {
      ...defaults.gist,
      default: "https",
      auth: "user",
      user: "foo",
    },
    "git+https://user@gist.github.com/foo/feedbeef#branch": {
      ...defaults.gist,
      default: "https",
      auth: "user",
      user: "foo",
      committish: "branch",
    },
    "git+https://user:password@gist.github.com/foo/feedbeef": {
      ...defaults.gist,
      default: "https",
      auth: "user:password",
      user: "foo",
    },
    "git+https://user:password@gist.github.com/foo/feedbeef#branch": {
      ...defaults.gist,
      default: "https",
      auth: "user:password",
      user: "foo",
      committish: "branch",
    },
    "git+https://:password@gist.github.com/foo/feedbeef": {
      ...defaults.gist,
      default: "https",
      auth: ":password",
      user: "foo",
    },
    "git+https://:password@gist.github.com/foo/feedbeef#branch": {
      ...defaults.gist,
      default: "https",
      auth: ":password",
      user: "foo",
      committish: "branch",
    },

    "git+https://gist.github.com/foo/feedbeef.git": { ...defaults.gist, default: "https", user: "foo" },
    "git+https://gist.github.com/foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "https",
      user: "foo",
      committish: "branch",
    },
    "git+https://user@gist.github.com/foo/feedbeef.git": {
      ...defaults.gist,
      default: "https",
      auth: "user",
      user: "foo",
    },
    "git+https://user@gist.github.com/foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "https",
      auth: "user",
      user: "foo",
      committish: "branch",
    },
    "git+https://user:password@gist.github.com/foo/feedbeef.git": {
      ...defaults.gist,
      default: "https",
      auth: "user:password",
      user: "foo",
    },
    "git+https://user:password@gist.github.com/foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "https",
      auth: "user:password",
      user: "foo",
      committish: "branch",
    },
    "git+https://:password@gist.github.com/foo/feedbeef.git": {
      ...defaults.gist,
      default: "https",
      auth: ":password",
      user: "foo",
    },
    "git+https://:password@gist.github.com/foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "https",
      auth: ":password",
      user: "foo",
      committish: "branch",
    },

    // https urls
    //
    // NOTE auth is accepted and respected
    "https://gist.github.com/feedbeef": { ...defaults.gist, default: "https" },
    "https://gist.github.com/feedbeef#branch": { ...defaults.gist, default: "https", committish: "branch" },
    "https://user@gist.github.com/feedbeef": { ...defaults.gist, default: "https", auth: "user" },
    "https://user@gist.github.com/feedbeef#branch": {
      ...defaults.gist,
      default: "https",
      auth: "user",
      committish: "branch",
    },
    "https://user:password@gist.github.com/feedbeef": { ...defaults.gist, default: "https", auth: "user:password" },
    "https://user:password@gist.github.com/feedbeef#branch": {
      ...defaults.gist,
      default: "https",
      auth: "user:password",
      committish: "branch",
    },
    "https://:password@gist.github.com/feedbeef": { ...defaults.gist, default: "https", auth: ":password" },
    "https://:password@gist.github.com/feedbeef#branch": {
      ...defaults.gist,
      default: "https",
      auth: ":password",
      committish: "branch",
    },

    "https://gist.github.com/feedbeef.git": { ...defaults.gist, default: "https" },
    "https://gist.github.com/feedbeef.git#branch": { ...defaults.gist, default: "https", committish: "branch" },
    "https://user@gist.github.com/feedbeef.git": { ...defaults.gist, default: "https", auth: "user" },
    "https://user@gist.github.com/feedbeef.git#branch": {
      ...defaults.gist,
      default: "https",
      auth: "user",
      committish: "branch",
    },
    "https://user:password@gist.github.com/feedbeef.git": {
      ...defaults.gist,
      default: "https",
      auth: "user:password",
    },
    "https://user:password@gist.github.com/feedbeef.git#branch": {
      ...defaults.gist,
      default: "https",
      auth: "user:password",
      committish: "branch",
    },
    "https://:password@gist.github.com/feedbeef.git": { ...defaults.gist, default: "https", auth: ":password" },
    "https://:password@gist.github.com/feedbeef.git#branch": {
      ...defaults.gist,
      default: "https",
      auth: ":password",
      committish: "branch",
    },

    "https://gist.github.com/foo/feedbeef": { ...defaults.gist, default: "https", user: "foo" },
    "https://gist.github.com/foo/feedbeef#branch": {
      ...defaults.gist,
      default: "https",
      user: "foo",
      committish: "branch",
    },
    "https://user@gist.github.com/foo/feedbeef": { ...defaults.gist, default: "https", auth: "user", user: "foo" },
    "https://user@gist.github.com/foo/feedbeef#branch": {
      ...defaults.gist,
      default: "https",
      auth: "user",
      user: "foo",
      committish: "branch",
    },
    "https://user:password@gist.github.com/foo/feedbeef": {
      ...defaults.gist,
      default: "https",
      auth: "user:password",
      user: "foo",
    },
    "https://user:password@gist.github.com/foo/feedbeef#branch": {
      ...defaults.gist,
      default: "https",
      auth: "user:password",
      user: "foo",
      committish: "branch",
    },
    "https://:password@gist.github.com/foo/feedbeef": {
      ...defaults.gist,
      default: "https",
      auth: ":password",
      user: "foo",
    },
    "https://:password@gist.github.com/foo/feedbeef#branch": {
      ...defaults.gist,
      default: "https",
      auth: ":password",
      user: "foo",
      committish: "branch",
    },

    "https://gist.github.com/foo/feedbeef.git": { ...defaults.gist, default: "https", user: "foo" },
    "https://gist.github.com/foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "https",
      user: "foo",
      committish: "branch",
    },
    "https://user@gist.github.com/foo/feedbeef.git": {
      ...defaults.gist,
      default: "https",
      auth: "user",
      user: "foo",
    },
    "https://user@gist.github.com/foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "https",
      auth: "user",
      user: "foo",
      committish: "branch",
    },
    "https://user:password@gist.github.com/foo/feedbeef.git": {
      ...defaults.gist,
      default: "https",
      auth: "user:password",
      user: "foo",
    },
    "https://user:password@gist.github.com/foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "https",
      auth: "user:password",
      user: "foo",
      committish: "branch",
    },
    "https://:password@gist.github.com/foo/feedbeef.git": {
      ...defaults.gist,
      default: "https",
      auth: ":password",
      user: "foo",
    },
    "https://:password@gist.github.com/foo/feedbeef.git#branch": {
      ...defaults.gist,
      default: "https",
      auth: ":password",
      user: "foo",
      committish: "branch",
    },
  },
  github: {
    // shortcuts
    //
    // NOTE auth is accepted but ignored
    "github:foo/bar": { ...defaults.github, default: "shortcut" },
    [`github:foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "shortcut",
      ...committishDefaults,
    },
    "github:user@foo/bar": { ...defaults.github, default: "shortcut", auth: null },
    [`github:user@foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "shortcut",
      auth: null,
      ...committishDefaults,
    },
    "github:user:password@foo/bar": { ...defaults.github, default: "shortcut", auth: null },
    [`github:user:password@foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "shortcut",
      auth: null,
      ...committishDefaults,
    },
    "github::password@foo/bar": { ...defaults.github, default: "shortcut", auth: null },
    [`github::password@foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "shortcut",
      auth: null,
      ...committishDefaults,
    },

    "github:foo/bar.git": { ...defaults.github, default: "shortcut" },
    [`github:foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "shortcut",
      ...committishDefaults,
    },
    "github:user@foo/bar.git": { ...defaults.github, default: "shortcut", auth: null },
    [`github:user@foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "shortcut",
      auth: null,
      ...committishDefaults,
    },
    "github:user:password@foo/bar.git": { ...defaults.github, default: "shortcut", auth: null },
    [`github:user:password@foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "shortcut",
      auth: null,
      ...committishDefaults,
    },
    "github::password@foo/bar.git": { ...defaults.github, default: "shortcut", auth: null },
    [`github::password@foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "shortcut",
      auth: null,
      ...committishDefaults,
    },

    // git urls
    //
    // NOTE auth is accepted and respected
    "git://github.com/foo/bar": { ...defaults.github, default: "git" },
    [`git://github.com/foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "git",
      ...committishDefaults,
    },
    "git://user@github.com/foo/bar": { ...defaults.github, default: "git", auth: "user" },
    [`git://user@github.com/foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "git",
      auth: "user",
      ...committishDefaults,
    },
    "git://user:password@github.com/foo/bar": { ...defaults.github, default: "git", auth: "user:password" },
    [`git://user:password@github.com/foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "git",
      auth: "user:password",
      ...committishDefaults,
    },
    "git://:password@github.com/foo/bar": { ...defaults.github, default: "git", auth: ":password" },
    [`git://:password@github.com/foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "git",
      auth: ":password",
      ...committishDefaults,
    },

    "git://github.com/foo/bar.git": { ...defaults.github, default: "git" },
    [`git://github.com/foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "git",
      ...committishDefaults,
    },
    "git://git@github.com/foo/bar.git": { ...defaults.github, default: "git", auth: "git" },
    [`git://git@github.com/foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "git",
      auth: "git",
      ...committishDefaults,
    },
    "git://user:password@github.com/foo/bar.git": { ...defaults.github, default: "git", auth: "user:password" },
    [`git://user:password@github.com/foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "git",
      auth: "user:password",
      ...committishDefaults,
    },
    "git://:password@github.com/foo/bar.git": { ...defaults.github, default: "git", auth: ":password" },
    [`git://:password@github.com/foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "git",
      auth: ":password",
      ...committishDefaults,
    },

    // no-protocol git+ssh
    //
    // NOTE auth is _required_ (see invalid list) but ignored
    "user@github.com:foo/bar": { ...defaults.github, default: "sshurl", auth: null },
    [`user@github.com:foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "sshurl",
      auth: null,
      ...committishDefaults,
    },
    "user:password@github.com:foo/bar": { ...defaults.github, default: "sshurl", auth: null },
    [`user:password@github.com:foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "sshurl",
      auth: null,
      ...committishDefaults,
    },
    ":password@github.com:foo/bar": { ...defaults.github, default: "sshurl", auth: null },
    [`:password@github.com:foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "sshurl",
      auth: null,
      ...committishDefaults,
    },

    "user@github.com:foo/bar.git": { ...defaults.github, default: "sshurl", auth: null },
    [`user@github.com:foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "sshurl",
      auth: null,
      ...committishDefaults,
    },
    "user:password@github.com:foo/bar.git": { ...defaults.github, default: "sshurl", auth: null },
    [`user:password@github.com:foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "sshurl",
      auth: null,
      ...committishDefaults,
    },
    ":password@github.com:foo/bar.git": { ...defaults.github, default: "sshurl", auth: null },
    [`:password@github.com:foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "sshurl",
      auth: null,
      ...committishDefaults,
    },

    // git+ssh urls
    //
    // NOTE auth is accepted but ignored
    "git+ssh://github.com:foo/bar": { ...defaults.github, default: "sshurl" },
    [`git+ssh://github.com:foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "sshurl",
      ...committishDefaults,
    },
    "git+ssh://user@github.com:foo/bar": { ...defaults.github, default: "sshurl", auth: null },
    [`git+ssh://user@github.com:foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "sshurl",
      auth: null,
      ...committishDefaults,
    },
    "git+ssh://user:password@github.com:foo/bar": { ...defaults.github, default: "sshurl", auth: null },
    [`git+ssh://user:password@github.com:foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "sshurl",
      auth: null,
      ...committishDefaults,
    },
    "git+ssh://:password@github.com:foo/bar": { ...defaults.github, default: "sshurl", auth: null },
    [`git+ssh://:password@github.com:foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "sshurl",
      auth: null,
      ...committishDefaults,
    },

    "git+ssh://github.com:foo/bar.git": { ...defaults.github, default: "sshurl" },
    [`git+ssh://github.com:foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "sshurl",
      ...committishDefaults,
    },
    "git+ssh://user@github.com:foo/bar.git": { ...defaults.github, default: "sshurl", auth: null },
    [`git+ssh://user@github.com:foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "sshurl",
      auth: null,
      ...committishDefaults,
    },
    "git+ssh://user:password@github.com:foo/bar.git": { ...defaults.github, default: "sshurl", auth: null },
    [`git+ssh://user:password@github.com:foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "sshurl",
      auth: null,
      ...committishDefaults,
    },
    "git+ssh://:password@github.com:foo/bar.git": { ...defaults.github, default: "sshurl", auth: null },
    [`git+ssh://:password@github.com:foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "sshurl",
      auth: null,
      ...committishDefaults,
    },

    // ssh urls
    //
    // NOTE auth is accepted but ignored
    "ssh://github.com:foo/bar": { ...defaults.github, default: "sshurl" },
    [`ssh://github.com:foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "sshurl",
      ...committishDefaults,
    },
    "ssh://user@github.com:foo/bar": { ...defaults.github, default: "sshurl", auth: null },
    [`ssh://user@github.com:foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "sshurl",
      auth: null,
      ...committishDefaults,
    },
    "ssh://user:password@github.com:foo/bar": { ...defaults.github, default: "sshurl", auth: null },
    [`ssh://user:password@github.com:foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "sshurl",
      auth: null,
      ...committishDefaults,
    },
    "ssh://:password@github.com:foo/bar": { ...defaults.github, default: "sshurl", auth: null },
    [`ssh://:password@github.com:foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "sshurl",
      auth: null,
      ...committishDefaults,
    },

    "ssh://github.com:foo/bar.git": { ...defaults.github, default: "sshurl" },
    [`ssh://github.com:foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "sshurl",
      ...committishDefaults,
    },
    "ssh://user@github.com:foo/bar.git": { ...defaults.github, default: "sshurl", auth: null },
    [`ssh://user@github.com:foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "sshurl",
      auth: null,
      ...committishDefaults,
    },
    "ssh://user:password@github.com:foo/bar.git": { ...defaults.github, default: "sshurl", auth: null },
    [`ssh://user:password@github.com:foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "sshurl",
      auth: null,
      ...committishDefaults,
    },
    "ssh://:password@github.com:foo/bar.git": { ...defaults.github, default: "sshurl", auth: null },
    [`ssh://:password@github.com:foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "sshurl",
      auth: null,
      ...committishDefaults,
    },

    // git+https urls
    //
    // NOTE auth is accepted and respected
    "git+https://github.com/foo/bar": { ...defaults.github, default: "https" },
    [`git+https://github.com/foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "https",
      ...committishDefaults,
    },
    "git+https://user@github.com/foo/bar": { ...defaults.github, default: "https", auth: "user" },
    [`git+https://user@github.com/foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "https",
      auth: "user",
      ...committishDefaults,
    },
    "git+https://user:password@github.com/foo/bar": { ...defaults.github, default: "https", auth: "user:password" },
    [`git+https://user:password@github.com/foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "https",
      auth: "user:password",
      ...committishDefaults,
    },
    "git+https://:password@github.com/foo/bar": { ...defaults.github, default: "https", auth: ":password" },
    [`git+https://:password@github.com/foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "https",
      auth: ":password",
      ...committishDefaults,
    },

    "git+https://github.com/foo/bar.git": { ...defaults.github, default: "https" },
    [`git+https://github.com/foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "https",
      ...committishDefaults,
    },
    "git+https://user@github.com/foo/bar.git": { ...defaults.github, default: "https", auth: "user" },
    [`git+https://user@github.com/foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "https",
      auth: "user",
      ...committishDefaults,
    },
    "git+https://user:password@github.com/foo/bar.git": {
      ...defaults.github,
      default: "https",
      auth: "user:password",
    },
    [`git+https://user:password@github.com/foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "https",
      auth: "user:password",
      ...committishDefaults,
    },
    "git+https://:password@github.com/foo/bar.git": { ...defaults.github, default: "https", auth: ":password" },
    [`git+https://:password@github.com/foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "https",
      auth: ":password",
      ...committishDefaults,
    },

    // https urls
    //
    // NOTE auth is accepted and respected
    "https://github.com/foo/bar": { ...defaults.github, default: "https" },
    [`https://github.com/foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "https",
      ...committishDefaults,
    },
    "https://user@github.com/foo/bar": { ...defaults.github, default: "https", auth: "user" },
    [`https://user@github.com/foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "https",
      auth: "user",
      ...committishDefaults,
    },
    "https://user:password@github.com/foo/bar": { ...defaults.github, default: "https", auth: "user:password" },
    [`https://user:password@github.com/foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "https",
      auth: "user:password",
      ...committishDefaults,
    },
    "https://:password@github.com/foo/bar": { ...defaults.github, default: "https", auth: ":password" },
    [`https://:password@github.com/foo/bar#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "https",
      auth: ":password",
      ...committishDefaults,
    },

    "https://github.com/foo/bar.git": { ...defaults.github, default: "https" },
    [`https://github.com/foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "https",
      ...committishDefaults,
    },
    "https://user@github.com/foo/bar.git": { ...defaults.github, default: "https", auth: "user" },
    [`https://user@github.com/foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "https",
      auth: "user",
      ...committishDefaults,
    },
    "https://user:password@github.com/foo/bar.git": { ...defaults.github, default: "https", auth: "user:password" },
    [`https://user:password@github.com/foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "https",
      auth: "user:password",
      ...committishDefaults,
    },
    "https://:password@github.com/foo/bar.git": { ...defaults.github, default: "https", auth: ":password" },
    [`https://:password@github.com/foo/bar.git#${committishDefaults.committish}`]: {
      ...defaults.github,
      default: "https",
      auth: ":password",
      ...committishDefaults,
    },

    // inputs that are not quite proper but we accept anyway
    "https://www.github.com/foo/bar": { ...defaults.github, default: "https" },
    "foo/bar#branch with space": { ...defaults.github, default: "shortcut", committish: "branch with space" },
    "foo/bar#branch:with:colons": { ...defaults.github, default: "shortcut", committish: "branch:with:colons" },
    "https://github.com/foo/bar/tree/branch": { ...defaults.github, default: "https", committish: "branch" },
    "user..blerg--/..foo-js# . . . . . some . tags / / /": {
      ...defaults.github,
      default: "shortcut",
      user: "user..blerg--",
      project: "..foo-js",
      committish: " . . . . . some . tags / / /",
    },
  },
  gitlab: {
    // shortcuts
    //
    // NOTE auth is accepted but ignored
    // NOTE gitlabSubgroups are respected, but the gitlabSubgroup is treated as the project and the real project is lost
    "gitlab:foo/bar": { ...defaults.gitlab, default: "shortcut" },
    "gitlab:foo/bar#branch": { ...defaults.gitlab, default: "shortcut", committish: "branch" },
    "gitlab:user@foo/bar": { ...defaults.gitlab, default: "shortcut", auth: null },
    "gitlab:user@foo/bar#branch": { ...defaults.gitlab, default: "shortcut", auth: null, committish: "branch" },
    "gitlab:user:password@foo/bar": { ...defaults.gitlab, default: "shortcut", auth: null },
    "gitlab:user:password@foo/bar#branch": {
      ...defaults.gitlab,
      default: "shortcut",
      auth: null,
      committish: "branch",
    },
    "gitlab::password@foo/bar": { ...defaults.gitlab, default: "shortcut", auth: null },
    "gitlab::password@foo/bar#branch": { ...defaults.gitlab, default: "shortcut", auth: null, committish: "branch" },

    "gitlab:foo/bar.git": { ...defaults.gitlab, default: "shortcut" },
    "gitlab:foo/bar.git#branch": { ...defaults.gitlab, default: "shortcut", committish: "branch" },
    "gitlab:user@foo/bar.git": { ...defaults.gitlab, default: "shortcut", auth: null },
    "gitlab:user@foo/bar.git#branch": { ...defaults.gitlab, default: "shortcut", auth: null, committish: "branch" },
    "gitlab:user:password@foo/bar.git": { ...defaults.gitlab, default: "shortcut", auth: null },
    "gitlab:user:password@foo/bar.git#branch": {
      ...defaults.gitlab,
      default: "shortcut",
      auth: null,
      committish: "branch",
    },
    "gitlab::password@foo/bar.git": { ...defaults.gitlab, default: "shortcut", auth: null },
    "gitlab::password@foo/bar.git#branch": {
      ...defaults.gitlab,
      default: "shortcut",
      auth: null,
      committish: "branch",
    },

    "gitlab:foo/bar/baz": { ...defaults.gitlabSubgroup, default: "shortcut" },
    "gitlab:foo/bar/baz#branch": { ...defaults.gitlabSubgroup, default: "shortcut", committish: "branch" },
    "gitlab:user@foo/bar/baz": { ...defaults.gitlabSubgroup, default: "shortcut", auth: null },
    "gitlab:user@foo/bar/baz#branch": {
      ...defaults.gitlabSubgroup,
      default: "shortcut",
      auth: null,
      committish: "branch",
    },
    "gitlab:user:password@foo/bar/baz": { ...defaults.gitlabSubgroup, default: "shortcut", auth: null },
    "gitlab:user:password@foo/bar/baz#branch": {
      ...defaults.gitlabSubgroup,
      default: "shortcut",
      auth: null,
      committish: "branch",
    },
    "gitlab::password@foo/bar/baz": { ...defaults.gitlabSubgroup, default: "shortcut", auth: null },
    "gitlab::password@foo/bar/baz#branch": {
      ...defaults.gitlabSubgroup,
      default: "shortcut",
      auth: null,
      committish: "branch",
    },

    "gitlab:foo/bar/baz.git": { ...defaults.gitlabSubgroup, default: "shortcut" },
    "gitlab:foo/bar/baz.git#branch": { ...defaults.gitlabSubgroup, default: "shortcut", committish: "branch" },
    "gitlab:user@foo/bar/baz.git": { ...defaults.gitlabSubgroup, default: "shortcut", auth: null },
    "gitlab:user@foo/bar/baz.git#branch": {
      ...defaults.gitlabSubgroup,
      default: "shortcut",
      auth: null,
      committish: "branch",
    },
    "gitlab:user:password@foo/bar/baz.git": { ...defaults.gitlabSubgroup, default: "shortcut", auth: null },
    "gitlab:user:password@foo/bar/baz.git#branch": {
      ...defaults.gitlabSubgroup,
      default: "shortcut",
      auth: null,
      committish: "branch",
    },
    "gitlab::password@foo/bar/baz.git": { ...defaults.gitlabSubgroup, default: "shortcut", auth: null },
    "gitlab::password@foo/bar/baz.git#branch": {
      ...defaults.gitlabSubgroup,
      default: "shortcut",
      auth: null,
      committish: "branch",
    },

    // no-protocol git+ssh
    //
    // NOTE auth is _required_ (see invalid list) but ignored
    "user@gitlab.com:foo/bar": { ...defaults.gitlab, default: "sshurl", auth: null },
    "user@gitlab.com:foo/bar#branch": { ...defaults.gitlab, default: "sshurl", auth: null, committish: "branch" },
    "user:password@gitlab.com:foo/bar": { ...defaults.gitlab, default: "sshurl", auth: null },
    "user:password@gitlab.com:foo/bar#branch": {
      ...defaults.gitlab,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    ":password@gitlab.com:foo/bar": { ...defaults.gitlab, default: "sshurl", auth: null },
    ":password@gitlab.com:foo/bar#branch": {
      ...defaults.gitlab,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    "user@gitlab.com:foo/bar.git": { ...defaults.gitlab, default: "sshurl", auth: null },
    "user@gitlab.com:foo/bar.git#branch": { ...defaults.gitlab, default: "sshurl", auth: null, committish: "branch" },
    "user:password@gitlab.com:foo/bar.git": { ...defaults.gitlab, default: "sshurl", auth: null },
    "user:password@gitlab.com:foo/bar.git#branch": {
      ...defaults.gitlab,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    ":password@gitlab.com:foo/bar.git": { ...defaults.gitlab, default: "sshurl", auth: null },
    ":password@gitlab.com:foo/bar.git#branch": {
      ...defaults.gitlab,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    "user@gitlab.com:foo/bar/baz": { ...defaults.gitlabSubgroup, default: "sshurl", auth: null },
    "user@gitlab.com:foo/bar/baz#branch": {
      ...defaults.gitlabSubgroup,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "user:password@gitlab.com:foo/bar/baz": { ...defaults.gitlabSubgroup, default: "sshurl", auth: null },
    "user:password@gitlab.com:foo/bar/baz#branch": {
      ...defaults.gitlabSubgroup,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    ":password@gitlab.com:foo/bar/baz": { ...defaults.gitlabSubgroup, default: "sshurl", auth: null },
    ":password@gitlab.com:foo/bar/baz#branch": {
      ...defaults.gitlabSubgroup,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    "user@gitlab.com:foo/bar/baz.git": { ...defaults.gitlabSubgroup, default: "sshurl", auth: null },
    "user@gitlab.com:foo/bar/baz.git#branch": {
      ...defaults.gitlabSubgroup,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "user:password@gitlab.com:foo/bar/baz.git": { ...defaults.gitlabSubgroup, default: "sshurl", auth: null },
    "user:password@gitlab.com:foo/bar/baz.git#branch": {
      ...defaults.gitlabSubgroup,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    ":password@gitlab.com:foo/bar/baz.git": { ...defaults.gitlabSubgroup, default: "sshurl", auth: null },
    ":password@gitlab.com:foo/bar/baz.git#branch": {
      ...defaults.gitlabSubgroup,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    // git+ssh urls
    //
    // NOTE auth is accepted but ignored
    // NOTE subprojects are accepted, but the subproject is treated as the project and the real project is lost
    "git+ssh://gitlab.com:foo/bar": { ...defaults.gitlab, default: "sshurl" },
    "git+ssh://gitlab.com:foo/bar#branch": { ...defaults.gitlab, default: "sshurl", committish: "branch" },
    "git+ssh://user@gitlab.com:foo/bar": { ...defaults.gitlab, default: "sshurl", auth: null },
    "git+ssh://user@gitlab.com:foo/bar#branch": {
      ...defaults.gitlab,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "git+ssh://user:password@gitlab.com:foo/bar": { ...defaults.gitlab, default: "sshurl", auth: null },
    "git+ssh://user:password@gitlab.com:foo/bar#branch": {
      ...defaults.gitlab,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "git+ssh://:password@gitlab.com:foo/bar": { ...defaults.gitlab, default: "sshurl", auth: null },
    "git+ssh://:password@gitlab.com:foo/bar#branch": {
      ...defaults.gitlab,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    "git+ssh://gitlab.com:foo/bar.git": { ...defaults.gitlab, default: "sshurl" },
    "git+ssh://gitlab.com:foo/bar.git#branch": { ...defaults.gitlab, default: "sshurl", committish: "branch" },
    "git+ssh://user@gitlab.com:foo/bar.git": { ...defaults.gitlab, default: "sshurl", auth: null },
    "git+ssh://user@gitlab.com:foo/bar.git#branch": {
      ...defaults.gitlab,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "git+ssh://user:password@gitlab.com:foo/bar.git": { ...defaults.gitlab, default: "sshurl", auth: null },
    "git+ssh://user:password@gitlab.com:foo/bar.git#branch": {
      ...defaults.gitlab,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "git+ssh://:password@gitlab.com:foo/bar.git": { ...defaults.gitlab, default: "sshurl", auth: null },
    "git+ssh://:password@gitlab.com:foo/bar.git#branch": {
      ...defaults.gitlab,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    "git+ssh://gitlab.com:foo/bar/baz": { ...defaults.gitlabSubgroup, default: "sshurl" },
    "git+ssh://gitlab.com:foo/bar/baz#branch": {
      ...defaults.gitlabSubgroup,
      default: "sshurl",
      committish: "branch",
    },
    "git+ssh://user@gitlab.com:foo/bar/baz": { ...defaults.gitlabSubgroup, default: "sshurl", auth: null },
    "git+ssh://user@gitlab.com:foo/bar/baz#branch": {
      ...defaults.gitlabSubgroup,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "git+ssh://user:password@gitlab.com:foo/bar/baz": { ...defaults.gitlabSubgroup, default: "sshurl", auth: null },
    "git+ssh://user:password@gitlab.com:foo/bar/baz#branch": {
      ...defaults.gitlabSubgroup,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "git+ssh://:password@gitlab.com:foo/bar/baz": { ...defaults.gitlabSubgroup, default: "sshurl", auth: null },
    "git+ssh://:password@gitlab.com:foo/bar/baz#branch": {
      ...defaults.gitlabSubgroup,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    "git+ssh://gitlab.com:foo/bar/baz.git": { ...defaults.gitlabSubgroup, default: "sshurl" },
    "git+ssh://gitlab.com:foo/bar/baz.git#branch": {
      ...defaults.gitlabSubgroup,
      default: "sshurl",
      committish: "branch",
    },
    "git+ssh://user@gitlab.com:foo/bar/baz.git": { ...defaults.gitlabSubgroup, default: "sshurl", auth: null },
    "git+ssh://user@gitlab.com:foo/bar/baz.git#branch": {
      ...defaults.gitlabSubgroup,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "git+ssh://user:password@gitlab.com:foo/bar/baz.git": {
      ...defaults.gitlabSubgroup,
      default: "sshurl",
      auth: null,
    },
    "git+ssh://user:password@gitlab.com:foo/bar/baz.git#branch": {
      ...defaults.gitlabSubgroup,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "git+ssh://:password@gitlab.com:foo/bar/baz.git": { ...defaults.gitlabSubgroup, default: "sshurl", auth: null },
    "git+ssh://:password@gitlab.com:foo/bar/baz.git#branch": {
      ...defaults.gitlabSubgroup,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    // ssh urls
    //
    // NOTE auth is accepted but ignored
    // NOTE subprojects are accepted, but the subproject is treated as the project and the real project is lost
    "ssh://gitlab.com:foo/bar": { ...defaults.gitlab, default: "sshurl" },
    "ssh://gitlab.com:foo/bar#branch": { ...defaults.gitlab, default: "sshurl", committish: "branch" },
    "ssh://user@gitlab.com:foo/bar": { ...defaults.gitlab, default: "sshurl", auth: null },
    "ssh://user@gitlab.com:foo/bar#branch": {
      ...defaults.gitlab,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "ssh://user:password@gitlab.com:foo/bar": { ...defaults.gitlab, default: "sshurl", auth: null },
    "ssh://user:password@gitlab.com:foo/bar#branch": {
      ...defaults.gitlab,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "ssh://:password@gitlab.com:foo/bar": { ...defaults.gitlab, default: "sshurl", auth: null },
    "ssh://:password@gitlab.com:foo/bar#branch": {
      ...defaults.gitlab,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    "ssh://gitlab.com:foo/bar.git": { ...defaults.gitlab, default: "sshurl" },
    "ssh://gitlab.com:foo/bar.git#branch": { ...defaults.gitlab, default: "sshurl", committish: "branch" },
    "ssh://user@gitlab.com:foo/bar.git": { ...defaults.gitlab, default: "sshurl", auth: null },
    "ssh://user@gitlab.com:foo/bar.git#branch": {
      ...defaults.gitlab,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "ssh://user:password@gitlab.com:foo/bar.git": { ...defaults.gitlab, default: "sshurl", auth: null },
    "ssh://user:password@gitlab.com:foo/bar.git#branch": {
      ...defaults.gitlab,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "ssh://:password@gitlab.com:foo/bar.git": { ...defaults.gitlab, default: "sshurl", auth: null },
    "ssh://:password@gitlab.com:foo/bar.git#branch": {
      ...defaults.gitlab,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    "ssh://gitlab.com:foo/bar/baz": { ...defaults.gitlabSubgroup, default: "sshurl" },
    "ssh://gitlab.com:foo/bar/baz#branch": { ...defaults.gitlabSubgroup, default: "sshurl", committish: "branch" },
    "ssh://user@gitlab.com:foo/bar/baz": { ...defaults.gitlabSubgroup, default: "sshurl", auth: null },
    "ssh://user@gitlab.com:foo/bar/baz#branch": {
      ...defaults.gitlabSubgroup,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "ssh://user:password@gitlab.com:foo/bar/baz": { ...defaults.gitlabSubgroup, default: "sshurl", auth: null },
    "ssh://user:password@gitlab.com:foo/bar/baz#branch": {
      ...defaults.gitlabSubgroup,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "ssh://:password@gitlab.com:foo/bar/baz": { ...defaults.gitlabSubgroup, default: "sshurl", auth: null },
    "ssh://:password@gitlab.com:foo/bar/baz#branch": {
      ...defaults.gitlabSubgroup,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    "ssh://gitlab.com:foo/bar/baz.git": { ...defaults.gitlabSubgroup, default: "sshurl" },
    "ssh://gitlab.com:foo/bar/baz.git#branch": {
      ...defaults.gitlabSubgroup,
      default: "sshurl",
      committish: "branch",
    },
    "ssh://user@gitlab.com:foo/bar/baz.git": { ...defaults.gitlabSubgroup, default: "sshurl", auth: null },
    "ssh://user@gitlab.com:foo/bar/baz.git#branch": {
      ...defaults.gitlabSubgroup,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "ssh://user:password@gitlab.com:foo/bar/baz.git": { ...defaults.gitlabSubgroup, default: "sshurl", auth: null },
    "ssh://user:password@gitlab.com:foo/bar/baz.git#branch": {
      ...defaults.gitlabSubgroup,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },
    "ssh://:password@gitlab.com:foo/bar/baz.git": { ...defaults.gitlabSubgroup, default: "sshurl", auth: null },
    "ssh://:password@gitlab.com:foo/bar/baz.git#branch": {
      ...defaults.gitlabSubgroup,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    // git+https urls
    //
    // NOTE auth is accepted and respected
    // NOTE subprojects are accepted, but the subproject is treated as the project and the real project is lost
    "git+https://gitlab.com/foo/bar": { ...defaults.gitlab, default: "https" },
    "git+https://gitlab.com/foo/bar#branch": { ...defaults.gitlab, default: "https", committish: "branch" },
    "git+https://user@gitlab.com/foo/bar": { ...defaults.gitlab, default: "https", auth: "user" },
    "git+https://user@gitlab.com/foo/bar#branch": {
      ...defaults.gitlab,
      default: "https",
      auth: "user",
      committish: "branch",
    },
    "git+https://user:password@gitlab.com/foo/bar": { ...defaults.gitlab, default: "https", auth: "user:password" },
    "git+https://user:password@gitlab.com/foo/bar#branch": {
      ...defaults.gitlab,
      default: "https",
      auth: "user:password",
      committish: "branch",
    },
    "git+https://:password@gitlab.com/foo/bar": { ...defaults.gitlab, default: "https", auth: ":password" },
    "git+https://:password@gitlab.com/foo/bar#branch": {
      ...defaults.gitlab,
      default: "https",
      auth: ":password",
      committish: "branch",
    },

    "git+https://gitlab.com/foo/bar.git": { ...defaults.gitlab, default: "https" },
    "git+https://gitlab.com/foo/bar.git#branch": { ...defaults.gitlab, default: "https", committish: "branch" },
    "git+https://user@gitlab.com/foo/bar.git": { ...defaults.gitlab, default: "https", auth: "user" },
    "git+https://user@gitlab.com/foo/bar.git#branch": {
      ...defaults.gitlab,
      default: "https",
      auth: "user",
      committish: "branch",
    },
    "git+https://user:password@gitlab.com/foo/bar.git": {
      ...defaults.gitlab,
      default: "https",
      auth: "user:password",
    },
    "git+https://user:password@gitlab.com/foo/bar.git#branch": {
      ...defaults.gitlab,
      default: "https",
      auth: "user:password",
      committish: "branch",
    },
    "git+https://:password@gitlab.com/foo/bar.git": { ...defaults.gitlab, default: "https", auth: ":password" },
    "git+https://:password@gitlab.com/foo/bar.git#branch": {
      ...defaults.gitlab,
      default: "https",
      auth: ":password",
      committish: "branch",
    },

    "git+https://gitlab.com/foo/bar/baz": { ...defaults.gitlabSubgroup, default: "https" },
    "git+https://gitlab.com/foo/bar/baz#branch": {
      ...defaults.gitlabSubgroup,
      default: "https",
      committish: "branch",
    },
    "git+https://user@gitlab.com/foo/bar/baz": { ...defaults.gitlabSubgroup, default: "https", auth: "user" },
    "git+https://user@gitlab.com/foo/bar/baz#branch": {
      ...defaults.gitlabSubgroup,
      default: "https",
      auth: "user",
      committish: "branch",
    },
    "git+https://user:password@gitlab.com/foo/bar/baz": {
      ...defaults.gitlabSubgroup,
      default: "https",
      auth: "user:password",
    },
    "git+https://user:password@gitlab.com/foo/bar/baz#branch": {
      ...defaults.gitlabSubgroup,
      default: "https",
      auth: "user:password",
      committish: "branch",
    },
    "git+https://:password@gitlab.com/foo/bar/baz": {
      ...defaults.gitlabSubgroup,
      default: "https",
      auth: ":password",
    },
    "git+https://:password@gitlab.com/foo/bar/baz#branch": {
      ...defaults.gitlabSubgroup,
      default: "https",
      auth: ":password",
      committish: "branch",
    },

    "git+https://gitlab.com/foo/bar/baz.git": { ...defaults.gitlabSubgroup, default: "https" },
    "git+https://gitlab.com/foo/bar/baz.git#branch": {
      ...defaults.gitlabSubgroup,
      default: "https",
      committish: "branch",
    },
    "git+https://user@gitlab.com/foo/bar/baz.git": { ...defaults.gitlabSubgroup, default: "https", auth: "user" },
    "git+https://user@gitlab.com/foo/bar/baz.git#branch": {
      ...defaults.gitlabSubgroup,
      default: "https",
      auth: "user",
      committish: "branch",
    },
    "git+https://user:password@gitlab.com/foo/bar/baz.git": {
      ...defaults.gitlabSubgroup,
      default: "https",
      auth: "user:password",
    },
    "git+https://user:password@gitlab.com/foo/bar/baz.git#branch": {
      ...defaults.gitlabSubgroup,
      default: "https",
      auth: "user:password",
      committish: "branch",
    },
    "git+https://:password@gitlab.com/foo/bar/baz.git": {
      ...defaults.gitlabSubgroup,
      default: "https",
      auth: ":password",
    },
    "git+https://:password@gitlab.com/foo/bar/baz.git#branch": {
      ...defaults.gitlabSubgroup,
      default: "https",
      auth: ":password",
      committish: "branch",
    },

    // https urls
    //
    // NOTE auth is accepted and respected
    // NOTE subprojects are accepted, but the subproject is treated as the project and the real project is lost
    "https://gitlab.com/foo/bar": { ...defaults.gitlab, default: "https" },
    "https://gitlab.com/foo/bar#branch": { ...defaults.gitlab, default: "https", committish: "branch" },
    "https://user@gitlab.com/foo/bar": { ...defaults.gitlab, default: "https", auth: "user" },
    "https://user@gitlab.com/foo/bar#branch": {
      ...defaults.gitlab,
      default: "https",
      auth: "user",
      committish: "branch",
    },
    "https://user:password@gitlab.com/foo/bar": { ...defaults.gitlab, default: "https", auth: "user:password" },
    "https://user:password@gitlab.com/foo/bar#branch": {
      ...defaults.gitlab,
      default: "https",
      auth: "user:password",
      committish: "branch",
    },
    "https://:password@gitlab.com/foo/bar": { ...defaults.gitlab, default: "https", auth: ":password" },
    "https://:password@gitlab.com/foo/bar#branch": {
      ...defaults.gitlab,
      default: "https",
      auth: ":password",
      committish: "branch",
    },

    "https://gitlab.com/foo/bar.git": { ...defaults.gitlab, default: "https" },
    "https://gitlab.com/foo/bar.git#branch": { ...defaults.gitlab, default: "https", committish: "branch" },
    "https://user@gitlab.com/foo/bar.git": { ...defaults.gitlab, default: "https", auth: "user" },
    "https://user@gitlab.com/foo/bar.git#branch": {
      ...defaults.gitlab,
      default: "https",
      auth: "user",
      committish: "branch",
    },
    "https://user:password@gitlab.com/foo/bar.git": { ...defaults.gitlab, default: "https", auth: "user:password" },
    "https://user:password@gitlab.com/foo/bar.git#branch": {
      ...defaults.gitlab,
      default: "https",
      auth: "user:password",
      committish: "branch",
    },
    "https://:password@gitlab.com/foo/bar.git": { ...defaults.gitlab, default: "https", auth: ":password" },
    "https://:password@gitlab.com/foo/bar.git#branch": {
      ...defaults.gitlab,
      default: "https",
      auth: ":password",
      committish: "branch",
    },

    "https://gitlab.com/foo/bar/baz": { ...defaults.gitlabSubgroup, default: "https" },
    "https://gitlab.com/foo/bar/baz#branch": { ...defaults.gitlabSubgroup, default: "https", committish: "branch" },
    "https://user@gitlab.com/foo/bar/baz": { ...defaults.gitlabSubgroup, default: "https", auth: "user" },
    "https://user@gitlab.com/foo/bar/baz#branch": {
      ...defaults.gitlabSubgroup,
      default: "https",
      auth: "user",
      committish: "branch",
    },
    "https://user:password@gitlab.com/foo/bar/baz": {
      ...defaults.gitlabSubgroup,
      default: "https",
      auth: "user:password",
    },
    "https://user:password@gitlab.com/foo/bar/baz#branch": {
      ...defaults.gitlabSubgroup,
      default: "https",
      auth: "user:password",
      committish: "branch",
    },
    "https://:password@gitlab.com/foo/bar/baz": { ...defaults.gitlabSubgroup, default: "https", auth: ":password" },
    "https://:password@gitlab.com/foo/bar/baz#branch": {
      ...defaults.gitlabSubgroup,
      default: "https",
      auth: ":password",
      committish: "branch",
    },

    "https://gitlab.com/foo/bar/baz.git": { ...defaults.gitlabSubgroup, default: "https" },
    "https://gitlab.com/foo/bar/baz.git#branch": {
      ...defaults.gitlabSubgroup,
      default: "https",
      committish: "branch",
    },
    "https://user@gitlab.com/foo/bar/baz.git": { ...defaults.gitlabSubgroup, default: "https", auth: "user" },
    "https://user@gitlab.com/foo/bar/baz.git#branch": {
      ...defaults.gitlabSubgroup,
      default: "https",
      auth: "user",
      committish: "branch",
    },
    "https://user:password@gitlab.com/foo/bar/baz.git": {
      ...defaults.gitlabSubgroup,
      default: "https",
      auth: "user:password",
    },
    "https://user:password@gitlab.com/foo/bar/baz.git#branch": {
      ...defaults.gitlabSubgroup,
      default: "https",
      auth: "user:password",
      committish: "branch",
    },
    "https://:password@gitlab.com/foo/bar/baz.git": {
      ...defaults.gitlabSubgroup,
      default: "https",
      auth: ":password",
    },
    "https://:password@gitlab.com/foo/bar/baz.git#branch": {
      ...defaults.gitlabSubgroup,
      default: "https",
      auth: ":password",
      committish: "branch",
    },
  },
  misc: {},
  sourcehut: {
    // shortucts
    "sourcehut:~foo/bar": { ...defaults.sourcehut, default: "shortcut" },
    "sourcehut:~foo/bar#branch": { ...defaults.sourcehut, default: "shortcut", committish: "branch" },

    // shortcuts (.git)
    "sourcehut:~foo/bar.git": { ...defaults.sourcehut, default: "shortcut" },
    "sourcehut:~foo/bar.git#branch": { ...defaults.sourcehut, default: "shortcut", committish: "branch" },

    // no-protocol git+ssh
    "git@git.sr.ht:~foo/bar": { ...defaults.sourcehut, default: "sshurl", auth: null },
    "git@git.sr.ht:~foo/bar#branch": {
      ...defaults.sourcehut,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    // no-protocol git+ssh (.git)
    "git@git.sr.ht:~foo/bar.git": { ...defaults.sourcehut, default: "sshurl", auth: null },
    "git@git.sr.ht:~foo/bar.git#branch": {
      ...defaults.sourcehut,
      default: "sshurl",
      auth: null,
      committish: "branch",
    },

    // git+ssh urls
    "git+ssh://git@git.sr.ht:~foo/bar": { ...defaults.sourcehut, default: "sshurl" },
    "git+ssh://git@git.sr.ht:~foo/bar#branch": {
      ...defaults.sourcehut,
      default: "sshurl",
      committish: "branch",
    },

    // git+ssh urls (.git)
    "git+ssh://git@git.sr.ht:~foo/bar.git": { ...defaults.sourcehut, default: "sshurl" },
    "git+ssh://git@git.sr.ht:~foo/bar.git#branch": {
      ...defaults.sourcehut,
      default: "sshurl",
      committish: "branch",
    },

    // https urls
    "https://git.sr.ht/~foo/bar": { ...defaults.sourcehut, default: "https" },
    "https://git.sr.ht/~foo/bar#branch": { ...defaults.sourcehut, default: "https", committish: "branch" },

    "https://git.sr.ht/~foo/bar.git": { ...defaults.sourcehut, default: "https" },
    "https://git.sr.ht/~foo/bar.git#branch": { ...defaults.sourcehut, default: "https", committish: "branch" },
  },
};

export const invalidGitUrls = {
  bitbucket: [
    // invalid protocol
    "git://bitbucket.org/foo/bar",
    // url to get a tarball
    "https://bitbucket.org/foo/bar/get/archive.tar.gz",
    // missing project
    "https://bitbucket.org/foo",
  ],
  gist: [
    // raw urls that are wrong anyway but for some reason are in the wild
    "https://gist.github.com/foo/feedbeef/raw/fix%2Fbug/",
    // missing both user and project
    "https://gist.github.com/",
  ],
  github: [
    // foo/bar shorthand but specifying auth
    "user@foo/bar",
    "user:password@foo/bar",
    ":password@foo/bar",
    // foo/bar shorthand but with a space in it
    "foo/ bar",
    // string that ends with a slash, probably a directory
    "foo/bar/",
    // git@github.com style, but omitting the username
    "github.com:foo/bar",
    "github.com/foo/bar",
    // invalid URI encoding
    "github:foo%0N/bar",
    // missing path
    "git+ssh://git@github.com:",
    // a deep url to something we don't know
    "https://github.com/foo/bar/issues",
  ],
  gitlab: [
    // gitlab urls can contain a /-/ segment, make sure we ignore those
    "https://gitlab.com/foo/-/something",
    // missing project
    "https://gitlab.com/foo",
    // tarball, this should not parse so that it can be used for pacote's remote fetcher
    "https://gitlab.com/foo/bar/repository/archive.tar.gz",
    "https://gitlab.com/foo/bar/repository/archive.tar.gz?ref=49b393e2ded775f2df36ef2ffcb61b0359c194c9",
  ],
  misc: [
    "https://google.com",
    "git+ssh://git@nothosted.com/abc/def",
    "git://nothosted.com",
    "git+file:///foo/bar",
    "git+ssh://git@git.unlucky.com:RND/electron-tools/some-tool#2.0.1",
    "::",
    "",
    null,
    undefined,
  ],
  sourcehut: [
    // missing project
    "https://git.sr.ht/~foo",
    // invalid protocols
    "git://git@git.sr.ht:~foo/bar",
    "ssh://git.sr.ht:~foo/bar",
    // tarball url
    "https://git.sr.ht/~foo/bar/archive/HEAD.tar.gz",
  ],
};
