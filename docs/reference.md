# Reference

## Inputs

| Input | Default | Description |
|---|---|---|
| `site-dir` | | Directory containing the built site. Served on 127.0.0.1. |
| `base-url` | | An already running server to audit instead of `site-dir`. Needs `pages`. |
| `base-path` | `/` | Path prefix the site is published under, such as `/my-repo/` for a project Pages site. |
| `canonical-domain` | | The domain your pages already use in canonical links, og:url and the sitemap, for example `www.example.gov`. A full origin like `https://www.example.gov` is accepted too. Used to resolve those URLs against the local tree. Never fetched. |
| `pages` | all HTML pages | Comma-separated paths to audit. |
| `max-pages` | `200` | Cap on pages audited per run. |
| `scangov-domain` | | Domain known to ScanGov. Enables a read-only lookup of production results for host-dependent checks. |
| `baseline` | | Accepted findings file. |
| `fail-on` | `accessibility` | ScanGov topics (`accessibility`, `usability`, `botability`, `security`) whose failing attributes count as findings. |
| `with-cls` | `false` | Also run the Lighthouse performance category for a lab CLS reading. |
| `block` | `false` | Set `true` to fail the job when there are findings, which blocks any job that depends on it. Default is report only. |
| `report-dir` | `scangov-report` | Where reports are written. Uploaded as a workflow artifact. |
| `node-version` | `22` | Lighthouse 13 needs Node 22.19 or newer. |

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
- uses: ScanGov/action@v1
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
        uses: ScanGov/action@v1
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
accessible," this action asks "will this pass ScanGov."
