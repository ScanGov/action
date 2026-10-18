# Reference

## Inputs

| Input | Default | Description |
|---|---|---|
| `site-dir` | | Directory containing the built site. Served on 127.0.0.1. |
| `base-url` | | An already running server to audit instead of `site-dir`. Needs `pages`. |
| `base-path` | `/` | Path prefix the site is published under, such as `/my-repo/` for a project Pages site. |
| `canonical-domain` | | The domain your pages already use in canonical links, og:url and the sitemap, for example `www.example.gov`. A full origin like `https://www.example.gov` is accepted too. Used to resolve those URLs against the local tree. Never fetched. |
| `pages` | all HTML pages | Comma-separated paths to check. |
| `max-pages` | `200` | Cap on pages checked per run. |
| `lighthouse-pages` | a sample | Comma-separated paths that get the full Lighthouse pass, or `all`. See [Which pages get Lighthouse](#which-pages-get-lighthouse). |
| `lighthouse-max-pages` | `10` | Size of the Lighthouse sample when `lighthouse-pages` is not set. |
| `performance-pages` | the homepage | Comma-separated paths that also run the Lighthouse performance category, or `all` or `none`. Gives a lab CLS reading that counts toward usability, plus report-only lab timings. See [Lab performance](#lab-performance). |
| `topics` | all five | Comma-separated ScanGov topics (`accessibility`, `usability`, `botability`, `security`, `readability`) to check and report, or `none` with `performance-pages` for performance alone. See [Running alongside another tool](#running-alongside-another-tool). |
| `scangov-domain` | | Domain known to ScanGov. Enables a read-only lookup of production results for host-dependent checks. |
| `baseline` | | Accepted findings file. |
| `fail-on` | `accessibility` when it is among `topics` | Topics whose failing attributes count as findings, or `none`. Must be a subset of `topics`. |
| `block` | `false` | Set `true` to fail the job when there are findings, which blocks any job that depends on it. Default is report only. |
| `report-dir` | `scangov-report` | Where reports are written. Uploaded as a workflow artifact. |
| `node-version` | `22` | Lighthouse 13 needs Node 22.19 or newer. |

## Which pages get Lighthouse

Every HTML page in the tree is checked from its markup: social tags,
language, and the readability grade. That takes about a second for a hundred
pages. The full Lighthouse pass, which produces the accessibility, usability,
botability and security scores, takes several seconds per page on a hosted
runner, so by default it runs on a sample of ten pages chosen the same way
every time:

1. the homepage, then the landing page of every top-level section, largest
   section first;
2. the first inner page of every section in the same order, which is usually
   the detail template behind the landing page.

In the report, sampled pages are marked `Lighthouse` and the rest
`HTML only`, with `-` in the four Lighthouse-derived columns. To change the
sample:

```yaml
    lighthouse-max-pages: 20            # a bigger sample
    lighthouse-pages: /,/apply/,/news/  # exactly these pages
    lighthouse-pages: all               # every page, the slow way
```

The performance category adds a throttled trace per page, so it runs on the
homepage alone by default. Name other pages with `performance-pages`, or set
it to `all` or `none`. A page named there is added to the Lighthouse set if
it is not already in it.

## Lab performance

On the pages that run the performance category, the lab CLS reading counts
toward the usability score, the same way production uses it. The other lab
readings are reported and never scored: performance score, First Contentful
Paint, Largest Contentful Paint, Total Blocking Time, Speed Index and server
response time. They appear in a table of their own in the Markdown report and
under `lab` for each page in `scangov.json`.

Treat them as a regression signal between runs of the same site on the same
runner type. A shared runner is slower and noisier than a visitor's device,
and Core Web Vitals in ScanGov come from Chrome field data, so a lab number
here says nothing about the production grade.

### Performance on one page

To watch one URL and nothing else, say a login screen of an app that is
running in the job, point at the server, name the page, and set `topics` to
`none`. Only the performance category runs and the report is the lab table.

```yaml
      - uses: ScanGov/action@v1.0.3
        with:
          base-url: http://127.0.0.1:3000
          pages: /login/
          performance-pages: /login/
          topics: none
```

The page has to be reachable without logging in; Lighthouse loads it fresh.
Add `lighthouse-pages: all` alongside the page list instead of `topics: none`
if you also want the ScanGov topics on that page.

## Running alongside another tool

If another step in your workflow already covers one of ScanGov's topics,
name the topics this action should handle and it leaves the rest alone.
The report shows only those columns, and Lighthouse runs only the categories
they need. A run limited to `readability` starts no browser at all.

The common case is an accessibility tool with deeper checks than
Lighthouse's axe subset, such as
[ramp-check](https://github.com/Mayor-s-Office-of-Innovation/ramp-check),
which adds motion, keyboard, reflow and cross-page consistency. Let it own
accessibility and have this action cover the other four topics:

```yaml
      - uses: Mayor-s-Office-of-Innovation/ramp-check/action@main
        with:
          base-url: http://127.0.0.1:3000

      - uses: ScanGov/action@v1.0.3
        with:
          base-url: http://127.0.0.1:3000
          pages: /,/services/,/contact/
          canonical-domain: www.example.gov
          topics: usability,botability,security,readability
          fail-on: readability
```

`fail-on` defaults to `accessibility` only when that topic is among
`topics`; otherwise nothing counts as a finding until you say so. Set it to
`none` to report without findings while keeping `block` for later. The full
example is [examples/with-ramp-check.yml](../examples/with-ramp-check.yml).

## Outputs

| Output | Description |
|---|---|
| `report-dir` | Directory containing `scangov.json`, `scangov.md` and raw Lighthouse results under `lhr/`. |
| `exit-code` | 0 clean, 1 findings, 2 configuration error. |
| `outcome` | `clean` or `findings`, regardless of `block`. Use it to gate later jobs yourself. |
| `findings` | Number of findings. |

The Markdown report is also appended to the job summary on every run. That
needs no extra permissions.

## Using the action directly

The reusable workflow in the README covers GitHub Pages. To put the audit
inside your own workflow:

```yaml
- uses: ScanGov/action@v1.0.3
  with:
    site-dir: _site
    canonical-domain: www.example.gov
```

## Report only, or gate it yourself

The default is report only: the job passes whatever the audit found. Set
`block: true` to fail the job on findings. Or leave blocking off and use the
`outcome` output to decide for yourself what to gate, for example blocking
only on the default branch:

```yaml
jobs:
  audit:
    runs-on: ubuntu-latest
    outputs:
      outcome: ${{ steps.scangov.outputs.outcome }}
    steps:
      - uses: actions/checkout@v4
      - id: scangov
        uses: ScanGov/action@v1.0.3
        with:
          site-dir: .

  deploy:
    needs: audit
    if: needs.audit.outputs.outcome == 'clean' || github.ref != 'refs/heads/main'
    # ...
```

## Running locally

```sh
git clone https://github.com/ScanGov/action scangov-action
cd scangov-action && npm install
node src/cli.mjs --site-dir /path/to/_site --canonical-domain www.example.gov
```

`npm test` serves the fixture site and enumerates its pages without running
Lighthouse. `npm run smoke` runs the full audit against it, which needs
Chrome installed.

## Related tools

[ramp-check](https://github.com/Mayor-s-Office-of-Innovation/ramp-check)
runs deeper accessibility checks (motion, keyboard, reflow, cross-page
consistency) in CI. The two complement each other: ramp-check asks "is this
accessible," this action asks "will this pass ScanGov." To run both without
hearing about accessibility twice, see
[Running alongside another tool](#running-alongside-another-tool).

## Versions

Every `ScanGov/action@v…` reference in this repository points at the
latest release, pinned exactly. There is no floating `v1` tag, so copying
an example gives you a version that does not change under you. Releases are
listed at <https://github.com/ScanGov/action/releases>. To upgrade, change
the tag in your workflow.

To cut a release, run the **Release** workflow from the Actions tab with the
new version number. It repoints every reference here at the new tag, sets
`package.json` to match, commits to `main`, tags, and publishes the release.
The same bump can be run locally with `npm run set-version -- 1.2.3`.
