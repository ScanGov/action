# Sites with a build step

For Eleventy, Astro, Hugo, Jekyll and similar generators deployed to GitHub
Pages, the only difference from the no-build setup is that the build runs
first and the action audits the output directory.

With the reusable workflow, pass the build command and output directory:

```yaml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  site:
    uses: ScanGov/action/.github/workflows/pages.yml@v1
    with:
      build-command: npm ci && npx @11ty/eleventy
      site-dir: _site
      canonical-domain: www.example.gov
    permissions:
      contents: read
      pages: write
      id-token: write
```

The reusable workflow installs Node 22 before running the build command.
For generators that are not Node based, put their install step in the
command too, or use the action directly inside your own workflow as in
[examples/pages-eleventy.yml](../examples/pages-eleventy.yml).

Sites on a custom domain use `/` as the base path, which is the default, and
their real domain as `canonical-domain`.
