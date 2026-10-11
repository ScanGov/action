/*
* Convert a Lighthouse result (LHR) into ScanGov audit attributes by topic.
*
* This is a port of the compose step in ScanGov's production auditor and
* must stay in step with it: the same audit ids, the same not-applicable
* handling, the same thresholds. It is the seed of the shared @scangov/core
* package. Do not add checks here that production does not make.
*
* Returns { requestedUrl, finalUrl, accessibility, security, botability,
* usability }, each topic as { attributes: { id: boolean } }.
*/

const NOT_SCORED = new Set(['notApplicable', 'informative', 'manual']);

/* A Lighthouse audit counts as failed when it scored below 1 and was applicable. */
function failed(audits, id) {
  let a = audits[id];
  return Boolean(a) && a.score !== 1 && a.scoreDisplayMode !== 'notApplicable';
}

export function composeFromLighthouse(lhr, { performance = false } = {}) {
  let audits = lhr.audits || {};
  let data = {
    requestedUrl: lhr.requestedUrl,
    finalUrl: lhr.finalDisplayedUrl
  };

  /* Accessibility: every scored audit in the category, pass or fail */
  let accessibility = {};
  for (let ref of lhr.categories?.accessibility?.auditRefs || []) {
    let details = audits[ref.id];
    if (!details || NOT_SCORED.has(details.scoreDisplayMode)) continue;
    accessibility[ref.id] = details.score === 1;
  }
  for (let id of ['image-aspect-ratio', 'doctype', 'charset']) {
    if (audits[id] && audits[id].scoreDisplayMode !== 'notApplicable') {
      accessibility[id] = audits[id].score === 1;
    }
  }
  data.accessibility = { attributes: accessibility };

  /* Security */
  let security = {
    csp: !failed(audits, 'csp-xss'),
    hsts: !failed(audits, 'has-hsts'),
    'errors-in-console': !failed(audits, 'errors-in-console'),
    'clickjacking-mitigation': !failed(audits, 'clickjacking-mitigation'),
    'paste-preventing-inputs': !failed(audits, 'paste-preventing-inputs'),
    https: true
  };
  if (failed(audits, 'is-on-https')) {
    security.https = String(lhr.finalDisplayedUrl || '').indexOf('https://') > -1;
  }
  if (failed(audits, 'redirect-http')) {
    security.https = false;
  }
  data.security = { attributes: security };

  /* Botability */
  data.botability = {
    attributes: {
      valid: !failed(audits, 'robots-txt'),
      allowed: !failed(audits, 'is-crawlable'),
      canonical: !failed(audits, 'canonical'),
      'link-text': !failed(audits, 'link-text'),
      hreflang: !failed(audits, 'hreflang')
    }
  };

  /* Usability */
  let usability = {
    title: !failed(audits, 'document-title'),
    description: !failed(audits, 'meta-description'),
    viewport: !failed(audits, 'viewport')
  };
  if (performance) {
    let num = id => audits[id]?.numericValue;
    let field = key => lhr.loadingExperience?.metrics?.[key]?.category === 'FAST';
    usability.fcp = !(num('first-contentful-paint') > 1800) || field('FIRST_CONTENTFUL_PAINT_MS');
    usability.lcp = !(num('largest-contentful-paint') > 2500) || field('LARGEST_CONTENTFUL_PAINT_MS');
    usability.cls = !(num('cumulative-layout-shift') > 0.1);
    usability.ttfb = !(num('server-response-time') > 800);
    usability.inp = !(num('total-blocking-time') > 200);
    data.performanceInfo = {
      'first-contentful-paint': num('first-contentful-paint'),
      'largest-contentful-paint': num('largest-contentful-paint'),
      'cumulative-layout-shift': num('cumulative-layout-shift'),
      'server-response-time': num('server-response-time'),
      'total-blocking-time': num('total-blocking-time')
    };
  }
  data.usability = { attributes: usability };

  return data;
}
