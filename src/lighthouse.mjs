/*
* Run Lighthouse the way ScanGov's production auditor runs it, so the
* audit ids and pass/fail results line up with scangov.org.
*
* Flags mirror ScanGov's production auditor: headless Chrome, the
* ScanGovBot emulated user agent, no CPU slowdown, a 30 second load wait,
* audioeye blocked, and by default only the accessibility, best-practices
* and seo categories. The caller names the categories a run needs, which
* lets a topic that another tool covers (accessibility, say) be left out.
* The performance category is added per page on request: it adds a
* throttled trace, the lab CLS reading joins the usability score, and the
* other lab metrics are reported without being scored.
*/

import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const USER_AGENT = 'Mozilla/5.0 (compatible; ScanGovBot/1.0; +https://scangov.com/bot) Lighthouse';

const CHROME_FLAGS = [
  '--headless=new',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu'
];

export const DEFAULT_CATEGORIES = ['accessibility', 'best-practices', 'seo'];

/*
* Lab performance readings from a result that ran the performance category.
* Reported, never scored: a shared runner's timings are a regression signal
* between runs of the same site, not a production number. Times in ms.
*/
export function labPerformance(lhr) {
  let audits = lhr?.audits || {};
  let ms = id => (typeof audits[id]?.numericValue === 'number' ? Math.round(audits[id].numericValue) : null);
  let score = lhr?.categories?.performance?.score;
  let cls = audits['cumulative-layout-shift']?.numericValue;
  return {
    score: typeof score === 'number' ? Math.round(score * 100) : null,
    'first-contentful-paint': ms('first-contentful-paint'),
    'largest-contentful-paint': ms('largest-contentful-paint'),
    'cumulative-layout-shift': typeof cls === 'number' ? Math.round(cls * 1000) / 1000 : null,
    'total-blocking-time': ms('total-blocking-time'),
    'speed-index': ms('speed-index'),
    'server-response-time': ms('server-response-time')
  };
}

export class LighthouseRunner {
  constructor() {
    this.chrome = null;
    this.version = require('lighthouse/package.json').version;
  }

  async start() {
    this.chrome = await launch({ chromeFlags: CHROME_FLAGS });
  }

  async stop() {
    if (this.chrome) {
      await this.chrome.kill();
      this.chrome = null;
    }
  }

  async audit(url, { categories = DEFAULT_CATEGORIES, performance = false } = {}) {
    if (!this.chrome) throw new Error('runner not started');
    categories = [...categories];
    if (performance && !categories.includes('performance')) categories.push('performance');
    if (categories.length === 0) throw new Error('no Lighthouse categories to run');
    let result = await lighthouse(url, {
      port: this.chrome.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: categories,
      emulatedUserAgent: USER_AGENT,
      throttling: { cpuSlowdownMultiplier: 1 },
      maxWaitForLoad: 30000,
      blockedUrlPatterns: ['*audioeye.com*'],
      disableFullPageScreenshot: true
    });
    if (!result?.lhr) throw new Error('lighthouse returned no result');
    if (result.lhr.runtimeError) {
      throw new Error(`${result.lhr.runtimeError.code}: ${result.lhr.runtimeError.message}`);
    }
    return result.lhr;
  }
}
