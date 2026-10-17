/*
* Run Lighthouse the way ScanGov's production auditor runs it, so the
* audit ids and pass/fail results line up with scangov.org.
*
* Flags mirror ScanGov's production auditor: headless Chrome, the
* ScanGovBot emulated user agent, no CPU slowdown, a 30 second load wait,
* audioeye blocked, and only the accessibility, best-practices and seo
* categories. The performance category is added per page on request: it
* adds a throttled trace, and only the lab CLS reading from it is used.
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

  async audit(url, { performance = false } = {}) {
    if (!this.chrome) throw new Error('runner not started');
    let categories = ['accessibility', 'best-practices', 'seo'];
    if (performance) categories.push('performance');
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
