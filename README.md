# ScanGov action

Audit your site against [ScanGov standards](https://standards.scangov.org)
inside GitHub Actions, before it deploys.

The action serves and audits your site on localhost inside your workflow. It runs the
same configuration ScanGov's production auditor. It writes the results to the job summary. Nothing created is reachable from
outside the runner, no page content leaves it.

> Status: pre-release. Per-page scores for all five ScanGov topics,
> including readability, use the same logic as scangov.org. Domain-level
> and host-dependent checks stay with production monitoring.

## Set up on a GitHub Pages site

The simplest case: plain HTML, CSS and JavaScript in the repository, no
build step, published by GitHub Pages at `https://<org>.github.io/<repo>/`.

1. In the repository settings, under Pages, set the source to **GitHub
   Actions** instead of deploying from a branch. This is what lets the
   audit run before the site goes live.

2. Add `.github/workflows/deploy.yml`:

   ```yaml
   name: Deploy
   on:
     push:
       branches: [main]
   jobs:
     site:
       uses: ScanGov/action/.github/workflows/pages.yml@v1.0.1
       with:
         site-dir: .
         base-path: /<repo>/
         canonical-domain: <org>.github.io
       permissions:
         contents: read
         pages: write
         id-token: write
   ```

   `base-path` is the path your project site is published under.
   `canonical-domain` is the domain your pages already use in canonical
   links and the sitemap. It is never fetched.

   The tag shown is the latest release, pinned exactly. See
   [Versions](docs/reference.md#versions).

3. Push to `main`. The workflow checks every HTML page in the repository, runs
   Lighthouse on a sample of them with the performance category on the
   homepage, writes the report to the run's summary, and deploys. See
   [which pages get Lighthouse](docs/reference.md#which-pages-get-lighthouse)
   to change the sample.

By default the audit reports and never holds up a deploy. When you are
ready for it to gate the deploy, add one line under `with:`:

```yaml
       block: true
```

From then on a deploy only happens after a clean audit. Remove the line to
go back to report-only.

## Check only some topics

Every input above also works in a plain step with `ScanGov/action@v1.0.1`.
If another tool already covers one of ScanGov's five topics, name the ones
this action should handle. The report shows only those, and Lighthouse runs
only the categories they need. Here an accessibility checker owns that topic
and ScanGov covers the rest, failing on reading level:

```yaml
      - uses: ScanGov/action@v1.0.1
        with:
          site-dir: _site
          canonical-domain: www.example.gov
          topics: usability,botability,security,readability
          fail-on: readability
```

To watch the performance of one page and nothing else, for example the
login screen of an app running in the job, name the page and set `topics`
to `none`:

```yaml
      - uses: ScanGov/action@v1.0.1
        with:
          base-url: http://127.0.0.1:3000
          pages: /login/
          performance-pages: /login/
          topics: none
```

Details, including the full ramp-check pairing:
[Running alongside another tool](docs/reference.md#running-alongside-another-tool)
and [Lab performance](docs/reference.md#lab-performance).

## Other setups

- [Sites with a build step](docs/build-step.md): Eleventy, Astro, Hugo,
  Jekyll and similar, deployed to GitHub Pages.
- [Sites built by their host](docs/host-builds.md): Netlify, Cloudflare
  Pages, Vercel.
- [Inputs, outputs and running locally](docs/reference.md).
- [What the action checks, and what only production can](docs/coverage.md).

## License

MIT
