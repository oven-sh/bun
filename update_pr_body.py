# usage: update_pr_body.py <pr number> <body file>   (checks the file before it writes the body)
import subprocess, sys
n, path = sys.argv[1], sys.argv[2]
s = open(path, encoding="utf-8").read()
assert s.startswith("### Problem") or s.startswith("Fixes #"), "body file does not look like a PR body"
assert "API rate limit" not in s and '"message"' not in s[:40]
r = subprocess.run(["gh", "api", "graphql", "-f", "query=query { repository(owner: \"oven-sh\", name: \"bun\") { pullRequest(number: %s) { id } } }" % n, "--jq", ".data.repository.pullRequest.id"], capture_output=True, text=True)
pid = r.stdout.strip()
assert pid.startswith("PR_"), (r.stdout, r.stderr)
q = "mutation($id: ID!, $body: String!) { updatePullRequest(input: {pullRequestId: $id, body: $body}) { pullRequest { number } } }"
r = subprocess.run(["gh", "api", "graphql", "-f", "query=" + q, "-f", "id=" + pid, "-f", "body=" + s], capture_output=True, text=True)
print(r.stdout[:120], r.stderr[:200])
