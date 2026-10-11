# What the action checks

The deciding question for every ScanGov check is where its answer comes from.

**From the files.** These run inside the runner and give the same answer
production would: Lighthouse accessibility audits, doctype and charset, page
title, meta description, viewport, canonical, hreflang, link text, social
(og:) tags, robots.txt and sitemap validity, security.txt, GovernmentOrganization
schema, and readability.

**From the host.** A static build has no response headers and no transport,
so these cannot be verified from the files: HTTPS, HSTS, Content-Security-Policy
and X-Frame-Options headers, X-Content-Type-Options, and www resolution.
On GitHub Pages these are decided by GitHub. On Netlify and Cloudflare Pages
they come from a `_headers` file.

**From the world.** Core Web Vitals in ScanGov come from Chrome field data
and cannot be measured on a runner. Links to external sites need the outside
world to answer.

Checks in the second and third groups stay with
[ScanGov monitoring](https://scangov.org) of the live site. A report from
this action predicts the file-derived half of a ScanGov grade.

## Things only CI can do

- Audit every page in the build in minutes, with no crawl politeness limits.
- Check every sitemap entry against the actual output tree, and every page
  in the tree for presence in the sitemap.

## Findings to read carefully

- `errors-in-console` can fire for third-party scripts whose keys are
  restricted to the production hostname. A missing favicon also shows up
  here, as a 404.
- Lab CLS from a shared runner is a regression signal, not a production
  number. It is off by default; enable it with `with-cls`.
