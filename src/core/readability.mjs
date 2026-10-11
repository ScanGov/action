/*
* Readability analysis, ported from ScanGov's production auditor.
*
* The grade depends on every step here, not only on the three packages it
* uses: which nodes are stripped, the article preference, headings appended
* back as sentences, line breaks turned into sentence ends, the custom
* character count and syllable counter. A reimplementation with the same
* packages and different pruning gives a different grade, so this file must
* stay in step with production. It is the seed of the shared @scangov/core
* package.
*
* Input is a linkedom (or DOM) document. The document is mutated.
*/

import natural from 'natural';
import { automatedReadability } from 'automated-readability';
import unfluff from 'unfluff';

/* Pages whose markup is still larger than this after stripping scripts are
   skipped: unfluff re-parses the whole document synchronously. */
export const MAX_READABILITY_HTML_BYTES = 5 * 1024 * 1024;

/* ARI above this grade fails the readability attribute. */
export const READABILITY_MAX_GRADE = 8;

const NON_CONTENT_SELECTOR = 'script, style, noscript, template, svg';

export function readabilityPasses(info) {
  return Boolean(info) && Math.round(info.automatedReadabilityIndex) <= READABILITY_MAX_GRADE;
}

function emptyResult(title, skipped) {
  return {
    title: title || 'No title found',
    textContent: '',
    characters: 0,
    textLength: 0,
    words: 0,
    sentences: 0,
    automatedReadabilityIndex: 0,
    ...(skipped ? { skipped } : {})
  };
}

export function analyzeDocumentReadability(document) {
  document.querySelectorAll(NON_CONTENT_SELECTOR).forEach(node => node.remove());

  let remainingBytes = document.documentElement.outerHTML.length;
  if (remainingBytes > MAX_READABILITY_HTML_BYTES) {
    let title = document.querySelector('title')?.textContent?.trim();
    return emptyResult(title, 'html-too-large');
  }

  if (document.querySelector('header')) {
    document.querySelector('header').remove();
  }
  if (document.querySelector('footer')) {
    document.querySelector('footer').remove();
  }
  if (document.querySelector('article')) {
    document.body.innerHTML = document.querySelector('article').outerHTML;
  }

  let headings = document.querySelectorAll('h1,h2,h3,h4');
  headings.forEach(h => h.remove());

  let lessHTML = document.querySelector('html').outerHTML;
  const data = unfluff(lessHTML);
  let text = data.text;

  const hasSentenceEndingPunctuation = s => /[.!?]/.test(s);

  headings.forEach(h => {
    let headerText = h.textContent.trim();
    if (text.indexOf(headerText) < 0) {
      if (!hasSentenceEndingPunctuation(headerText)) {
        headerText += '.';
      }
      if (headerText.indexOf(' ') > -1) {
        text += ` ${headerText} `;
      }
    }
  });

  if (!text || text.trim().length === 0) {
    return emptyResult(data.title);
  }

  const unLineBreakText = text
    .replace(/([.!?])\s*\n+\s*/g, '$1 ')
    .replace(/([^.!?\s])\s*\n+\s*/g, '$1. ');

  const analysis = analyzeText(unLineBreakText);
  let characterCount = unLineBreakText.replace(/[!,'.’\-_; ]/g, '').length;

  let ARIGrade = automatedReadability({
    sentence: analysis.stats.sentences,
    word: analysis.stats.words,
    character: characterCount
  });

  return {
    title: data.title || 'No title found',
    textContent: unLineBreakText,
    characters: characterCount,
    textLength: text.length,
    words: analysis.stats.words,
    sentences: analysis.stats.sentences,
    automatedReadabilityIndex: ARIGrade,
    syllables: analysis.stats.syllables,
    fleschKincaidGrade: analysis.scores.fleschKincaidGrade
  };
}

export function analyzeText(text) {
  const cleanText = text.replace(/\s+/g, ' ').trim();
  const wordTokenizer = new natural.WordTokenizer();
  const sentenceTokenizer = new natural.SentenceTokenizer();
  const words = wordTokenizer.tokenize(cleanText);
  const sentences = sentenceTokenizer.tokenize(cleanText);
  const validWords = words.filter(word => word && /\w/.test(word));
  const syllables = validWords.reduce((count, word) => count + countSyllables(word), 0);

  const avgWordsPerSentence = validWords.length / sentences.length;
  const avgSyllablesPerWord = syllables / validWords.length;
  const fleschReadingEase = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord);
  const fleschKincaidGrade = (0.39 * avgWordsPerSentence) + (11.8 * avgSyllablesPerWord) - 15.59;
  const complexWords = validWords.filter(word => countSyllables(word) >= 3).length;
  const percentComplexWords = (complexWords / validWords.length) * 100;
  const gunningFog = 0.4 * (avgWordsPerSentence + percentComplexWords);

  return {
    stats: {
      words: validWords.length,
      sentences: sentences.length,
      syllables,
      complexWords,
      avgWordsPerSentence: Math.round(avgWordsPerSentence * 100) / 100,
      avgSyllablesPerWord: Math.round(avgSyllablesPerWord * 100) / 100,
      percentComplexWords: Math.round(percentComplexWords * 100) / 100
    },
    scores: {
      fleschReadingEase: Math.max(0, Math.min(100, Math.round(fleschReadingEase * 100) / 100)),
      fleschKincaidGrade: Math.max(0, Math.round(fleschKincaidGrade * 100) / 100),
      gunningFog: Math.max(0, Math.round(gunningFog * 100) / 100)
    }
  };
}

export function countSyllables(word) {
  if (!word || typeof word !== 'string') return 1;
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (word.length <= 3) return 1;
  word = word.replace(/(?:es|ed|e)$/, '');
  word = word.replace(/^y/, '');
  const vowelGroups = word.match(/[aeiouy]+/g);
  return Math.max(1, vowelGroups ? vowelGroups.length : 1);
}
