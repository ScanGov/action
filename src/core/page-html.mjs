/*
* Attributes ScanGov's production auditor derives from the page HTML rather
* than from Lighthouse: social tags, language, crawlable and text-content,
* and the readability analysis. Ported from the production fetch step and
* kept in step with it. Seed of the shared @scangov/core package.
*
* Social tags are detected the way production detects them: a literal search
* for `property="og:..."` in the raw HTML. A tag written with single quotes
* is not found, in CI or in production.
*/

import { parseHTML } from 'linkedom';
import { analyzeDocumentReadability } from './readability.mjs';

export const SOCIAL_TAGS = [
  { tag: 'property="og:site_name"', key: 'ogsitename' },
  { tag: 'property="og:type"', key: 'ogtype' },
  { tag: 'property="og:title"', key: 'ogtitle' },
  { tag: 'property="og:description"', key: 'ogdescription' },
  { tag: 'property="og:url"', key: 'ogurl' },
  { tag: 'property="og:image"', key: 'ogimage' },
  { tag: 'property="og:image:alt"', key: 'ogimagealt' }
];

export function isEnglish(lang) {
  return !lang || lang.startsWith('en');
}

export function analyzePageHtml(html) {
  let result = {
    title: null,
    lang: '',
    usability: { attributes: {} },
    botability: { attributes: {} },
    readabilityInfo: null
  };

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    result.title = titleMatch[1].trim();
  }

  for (let { tag, key } of SOCIAL_TAGS) {
    result.usability.attributes[key] = html.indexOf(tag) > -1;
  }

  if (!html) {
    result.botability.attributes.crawlable = false;
    result.botability.attributes['text-content'] = false;
    return result;
  }

  const { document } = parseHTML(html);
  result.lang = (document.documentElement.getAttribute('lang') || '').trim().toLowerCase();
  result.botability.attributes.crawlable = true;
  result.botability.attributes['text-content'] = true;

  if (isEnglish(result.lang)) {
    result.readabilityInfo = analyzeDocumentReadability(document);
  }
  return result;
}
