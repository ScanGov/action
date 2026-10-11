# Sites built by their host

Netlify, Cloudflare Pages, Vercel and Amplify pull from the repository and
build on their side, so there is no GitHub deploy step to gate. Two options:

**Audit a duplicate build on pull requests.** Run the same build inside
GitHub Actions purely to audit it and report in the job summary. Nothing is
blocked, but findings are visible before merge. See
[examples/host-builds.yml](../examples/host-builds.yml).

**Move the build into GitHub Actions.** Then the host deploys a prebuilt
directory and the audit can gate the deploy as it does on GitHub Pages.
How to do that depends on the host.

Response headers on these platforms come from a `_headers` file. The action
does not read it today.
