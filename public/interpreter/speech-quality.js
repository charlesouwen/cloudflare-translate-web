const COMPACT_SPACING_LANGUAGES = new Set(["zh-Hans", "zh-Hant", "yue", "ja"]);

const SCRIPT_PATTERNS = {
  cjk: /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g,
  hangul: /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g,
  latin: /[A-Za-z\u00c0-\u024f]/g,
  cyrillic: /[\u0400-\u052f]/g,
  arabic: /[\u0600-\u06ff\u0750-\u077f]/g,
  devanagari: /[\u0900-\u097f]/g,
  bengali: /[\u0980-\u09ff]/g,
  gujarati: /[\u0a80-\u0aff]/g,
  gurmukhi: /[\u0a00-\u0a7f]/g,
  tamil: /[\u0b80-\u0bff]/g,
  telugu: /[\u0c00-\u0c7f]/g,
  kannada: /[\u0c80-\u0cff]/g,
  malayalam: /[\u0d00-\u0d7f]/g,
  thai: /[\u0e00-\u0e7f]/g,
  hebrew: /[\u0590-\u05ff]/g,
  armenian: /[\u0530-\u058f]/g,
  greek: /[\u0370-\u03ff]/g,
  khmer: /[\u1780-\u17ff]/g,
  lao: /[\u0e80-\u0eff]/g,
  myanmar: /[\u1000-\u109f]/g
};

const SCRIPT_LANGUAGES = {
  cjk: new Set(["zh-Hans", "zh-Hant", "yue", "ja"]),
  hangul: new Set(["ko"]),
  cyrillic: new Set(["bg", "kk", "mk", "ru", "sr-Cyrl", "uk"]),
  arabic: new Set(["ar", "fa", "prs", "ur"]),
  devanagari: new Set(["hi", "mr", "ne"]),
  bengali: new Set(["as", "bn"]),
  gujarati: new Set(["gu"]),
  gurmukhi: new Set(["pa"]),
  tamil: new Set(["ta"]),
  telugu: new Set(["te"]),
  kannada: new Set(["kn"]),
  malayalam: new Set(["ml"]),
  thai: new Set(["th"]),
  hebrew: new Set(["he"]),
  armenian: new Set(["hy"]),
  greek: new Set(["el"]),
  khmer: new Set(["km"]),
  lao: new Set(["lo"]),
  myanmar: new Set(["my"])
};

const ENGLISH_FUNCTION_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "because", "but", "by", "can", "could",
  "did", "do", "does", "for", "from", "had", "has", "have", "he", "how", "if", "i",
  "in", "is", "it", "me", "might", "must", "my", "no", "not", "of", "on", "or", "our",
  "should", "she", "so", "that", "the", "their", "them", "there", "they", "this", "to",
  "us", "was", "we", "were", "what", "when", "where", "which", "who", "why", "will",
  "with", "would", "you", "your"
]);

export function createRecognitionCandidate(body, context = {}) {
  const alternatives = recognitionAlternatives(body).map((alternative) => {
    const text = recognitionText(alternative);
    const confidence = finiteConfidence(alternative?.Confidence ?? body?.Confidence);
    const stability = hypothesisStability(text, context.hypothesisHistory || []);
    const scriptScore = speechScriptCompatibility(text, context.languageCode);
    const naturalness = speechSentenceNaturalness(text, context.languageCode);
    const artifactPenalty = speechArtifactPenalty(text);
    const revisionPenalty = hypothesisRevisionPenalty(text, context.hypothesisCount);
    const result = {
      text,
      confidence,
      stability,
      scriptScore,
      naturalness,
      artifactPenalty,
      revisionPenalty,
      score: 0
    };
    result.score = alternativeScore(result);
    return result;
  }).filter((alternative) => alternative.text);

  alternatives.sort((left, right) => right.score - left.score);
  const best = alternatives[0] || {
    text: "",
    confidence: null,
    stability: 0,
    scriptScore: 0.5,
    naturalness: 0.5,
    artifactPenalty: 0,
    revisionPenalty: 0
  };

  return {
    text: best.text,
    success: body?.RecognitionStatus === "Success" && Boolean(best.text),
    confidence: best.confidence,
    stability: best.stability,
    scriptScore: best.scriptScore,
    naturalness: best.naturalness,
    artifactPenalty: best.artifactPenalty,
    revisionPenalty: best.revisionPenalty,
    hypothesisCount: Number(context.hypothesisCount) || 0,
    alternativeCount: alternatives.length
  };
}

export function chooseRecognitionCandidate(candidates, options = {}) {
  const strict = Boolean(options.strict);
  const usable = candidates.filter((candidate) => candidate?.success && candidate.text);
  if (!usable.length) return null;

  const ranked = usable
    .map((candidate) => ({
      candidate,
      score: recognitionCandidateScore(candidate, options.pendingSpeaker)
    }))
    .filter(({ candidate }) => !strict || isReliableCandidate(candidate))
    .sort((left, right) => right.score - left.score);

  if (!ranked.length) return null;
  if (ranked.length === 1) return ranked[0].candidate;

  const [best, second] = ranked;
  const scoreLead = best.score - second.score;
  const confidenceLead = comparableConfidence(best.candidate) - comparableConfidence(second.candidate);
  const scriptLead = best.candidate.scriptScore - second.candidate.scriptScore;
  const stabilityLead = best.candidate.stability - second.candidate.stability;

  if (options.pendingSpeaker
      && best.candidate.speaker === options.pendingSpeaker
      && second.candidate.speaker !== options.pendingSpeaker
      && scoreLead >= 0.35) return best.candidate;
  if (scoreLead >= 1.05) return best.candidate;
  if (confidenceLead >= 0.05 && scoreLead >= 0.25) return best.candidate;
  if (scriptLead >= 0.28 && scoreLead > 0) return best.candidate;
  if (stabilityLead >= 0.35 && scoreLead >= 0.45) return best.candidate;
  return null;
}

export function recognitionCandidateScore(candidate, pendingSpeaker = "") {
  const confidence = comparableConfidence(candidate);
  const lengthSignal = Math.min(normalizeComparableText(candidate.text).length, 60) / 60;
  const hypothesisSignal = Math.min(candidate.hypothesisCount || 0, 10) / 10;
  const continuity = pendingSpeaker && candidate.speaker === pendingSpeaker ? 1.25 : 0;
  const naturalnessPenalty = Number.isFinite(candidate.naturalness)
    ? Math.max(0, 0.68 - candidate.naturalness) * 2.2
    : 0;
  return confidence * 10
    + candidate.scriptScore * 5
    + candidate.stability * 2
    + lengthSignal * 0.45
    + hypothesisSignal * 0.45
    + continuity
    - candidate.artifactPenalty
    - (candidate.revisionPenalty || 0)
    - naturalnessPenalty;
}

export function speechScriptCompatibility(text, languageCode) {
  const expectedScript = languageScript(languageCode);
  if (!expectedScript) return 0.5;
  const counts = Object.fromEntries(Object.entries(SCRIPT_PATTERNS).map(([name, pattern]) => [
    name,
    (String(text || "").match(pattern) || []).length
  ]));
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (!total) return 0.5;
  return (counts[expectedScript] || 0) / total;
}

export function appendSpeechSegment(existing, segment, languageCode) {
  const left = String(existing || "").trimEnd();
  const right = String(segment || "").trim();
  if (!left) return right;
  if (!right || left === right) return left;

  if (COMPACT_SPACING_LANGUAGES.has(languageCode)) {
    const overlap = characterOverlap(left, right);
    return `${left}${right.slice(overlap)}`;
  }

  const leftWords = left.split(/\s+/);
  const rightWords = right.split(/\s+/);
  const overlap = wordOverlap(leftWords, rightWords);
  return `${left} ${rightWords.slice(overlap).join(" ")}`.trimEnd();
}

export function mergeSpeechHypothesis(existing, incoming, languageCode) {
  const left = String(existing || "").trim();
  const right = String(incoming || "").trim();
  if (!left) return right;
  if (!right || left === right) return left;

  const leftComparable = normalizeComparableText(left);
  const rightComparable = normalizeComparableText(right);
  if (!leftComparable) return right;
  if (!rightComparable) return left;
  if (rightComparable.startsWith(leftComparable)) return right;
  if (leftComparable.endsWith(rightComparable)) return left;

  if (COMPACT_SPACING_LANGUAGES.has(languageCode)) {
    if (characterOverlap(left, right) >= 2) return appendSpeechSegment(left, right, languageCode);
  } else {
    if (wordOverlap(left.split(/\s+/), right.split(/\s+/)) >= 2) {
      return appendSpeechSegment(left, right, languageCode);
    }
  }

  const similarity = textSimilarity(left, right);
  if (similarity >= 0.48 && rightComparable.length >= leftComparable.length * 0.72) return right;
  if (rightComparable.length >= leftComparable.length * 0.78) return right;
  return appendSpeechSegment(left, right, languageCode);
}

export function speechTextSimilarity(left, right) {
  return textSimilarity(left, right);
}

export function estimateSpeechCommitDelay(text, languageCode, strategy = "auto", continuationCount = 0) {
  const fixedDelay = Number(strategy);
  if (Number.isFinite(fixedDelay) && fixedDelay > 0) {
    return Math.max(1400, Math.min(5000, fixedDelay));
  }

  const value = String(text || "").trim();
  const comparableLength = normalizeComparableText(value).length;
  if (!comparableLength) return 2800;

  const compactLanguage = COMPACT_SPACING_LANGUAGES.has(languageCode);
  const terminal = /[。！？!?…]["'”’）)]?$/.test(value);
  const softEnding = /[，、,：:；;—-]$/.test(value);
  const compactIncomplete = /(?:因为|所以|但是|如果|虽然|然后|而且|以及|或者|就是|比如|关于|请问|我想|我觉得|希望|需要|可以|应该|可能|对于|为了|通过|根据|当|在|把|被|和|跟|与|向|从|对)$/.test(value);
  const latinIncomplete = /\b(?:and|or|but|because|if|when|while|although|that|which|who|to|for|with|about|from|of|in|on|at|is|are|was|were|have|has|had|do|does|did|can|could|would|will|should|may|might)\s*[,.]?$/.test(value.toLocaleLowerCase());
  const incomplete = softEnding || (compactLanguage ? compactIncomplete : latinIncomplete);

  let delay = 2400;
  if (terminal) delay = 1800;
  if (comparableLength <= (compactLanguage ? 4 : 8)) delay = Math.max(delay, 3000);
  if (incomplete) delay = 4600;
  if (!terminal && comparableLength >= 45) delay = Math.max(delay, 2850);
  if (continuationCount > 0 && !terminal) delay += Math.min(400, continuationCount * 120);
  return Math.max(1800, Math.min(4800, delay));
}

export function safeSpeechCorrection(original, corrected, languageCode) {
  const source = String(original || "").trim();
  const candidate = String(corrected || "").trim();
  if (!source || !candidate || source === candidate) return source;

  const sourceComparable = normalizeComparableText(source);
  const candidateComparable = normalizeComparableText(candidate);
  if (!sourceComparable || !candidateComparable) return source;

  const lengthRatio = candidateComparable.length / sourceComparable.length;
  if (lengthRatio < 0.68 || lengthRatio > 1.42) return source;
  if (speechScriptCompatibility(candidate, languageCode)
      + 0.2 < speechScriptCompatibility(source, languageCode)) return source;

  const maximumLength = Math.max(sourceComparable.length, candidateComparable.length);
  const editRatio = boundedEditDistance(sourceComparable, candidateComparable) / maximumLength;
  return editRatio <= 0.34 ? candidate : source;
}

export function speechSentenceNaturalness(text, languageCode) {
  const value = String(text || "").trim();
  if (!value) return 0;

  const scriptScore = speechScriptCompatibility(value, languageCode);
  if (scriptScore < 0.35) return Math.max(0.1, scriptScore);

  const language = String(languageCode || "");
  if (COMPACT_SPACING_LANGUAGES.has(language)) {
    const units = (value.match(SCRIPT_PATTERNS.cjk) || []).length;
    return units >= 3 ? 0.86 : units ? 0.68 : 0.42;
  }

  if (language !== "en" && !language.startsWith("en-")) return 0.72;

  const words = value.toLocaleLowerCase().match(/[a-z\u00c0-\u024f]+/g) || [];
  if (!words.length) return 0.25;
  if (words.length <= 2) return scriptScore >= 0.8 ? 0.84 : 0.58;

  let longestContentRun = 0;
  let contentRun = 0;
  for (const word of words) {
    if (ENGLISH_FUNCTION_WORDS.has(word)) {
      contentRun = 0;
    } else {
      contentRun += 1;
      longestContentRun = Math.max(longestContentRun, contentRun);
    }
  }

  let score = 0.84;
  if (longestContentRun >= 3) score -= Math.min(0.28, (longestContentRun - 2) * 0.1);
  if (longestContentRun >= 5) score -= 0.12;
  if (/\b(?:cry|laugh|sing|dance|talk|say|watch|hear)\s+(?:eating|drinking|sleeping|running|crying|laughing)\b/i.test(value)) {
    score -= 0.18;
  }
  if (words.length >= 7 && words.every((word) => !ENGLISH_FUNCTION_WORDS.has(word))) score -= 0.24;
  if (speechArtifactPenalty(value) > 0.8) score -= 0.16;
  return Math.max(0.1, Math.min(1, score));
}

export function speechTranslationQuality(source, translation, sourceLanguage, targetLanguage) {
  const original = String(source || "").trim();
  const translated = String(translation || "").trim();
  if (!original || !translated) return 0;

  const targetScript = speechScriptCompatibility(translated, targetLanguage);
  const sourceNaturalness = speechSentenceNaturalness(original, sourceLanguage);
  const targetNaturalness = speechSentenceNaturalness(translated, targetLanguage);
  let score = sourceNaturalness * 0.55 + targetScript * 0.25 + targetNaturalness * 0.2;
  if (sourceLanguage !== targetLanguage
      && normalizeComparableText(original) === normalizeComparableText(translated)) {
    score -= 0.25;
  }
  if (!/[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff]/u.test(original)
      && /[《》]/u.test(translated)) {
    score -= 0.16;
  }
  return Math.max(0, Math.min(1, score));
}

export function chooseCrossScriptCandidate(candidates) {
  const usable = candidates.filter((candidate) => candidate?.text && candidate?.language?.code);
  const cjk = usable.find((candidate) => isCjkLanguage(candidate.language.code));
  const nonCjk = usable.find((candidate) => !isCjkLanguage(candidate.language.code));
  if (!cjk || !nonCjk) return null;

  const cjkRatio = scriptRatio(cjk.text, "cjk");
  const latinRatio = scriptRatio(nonCjk.text, "latin");
  const cjkConfidence = comparableCandidateConfidence(cjk);
  const latinConfidence = comparableCandidateConfidence(nonCjk);
  const cjkNaturalness = Number.isFinite(cjk.naturalness)
    ? cjk.naturalness
    : speechSentenceNaturalness(cjk.text, cjk.language.code);
  const latinNaturalness = Number.isFinite(nonCjk.naturalness)
    ? nonCjk.naturalness
    : speechSentenceNaturalness(nonCjk.text, nonCjk.language.code);
  const cjkHasText = cjkRatio >= 0.35;
  const latinHasText = latinRatio >= 0.35;

  if (cjkHasText && scriptRatio(nonCjk.text, "cjk") <= 0.15) {
    if (cjkNaturalness - latinNaturalness >= 0.18) return cjk;
    if (latinNaturalness - cjkNaturalness >= 0.18) return nonCjk;
    const latinHasAcousticLead = latinConfidence - cjkConfidence >= 0.055
      && (cjk.revisionPenalty || 0) - (nonCjk.revisionPenalty || 0) >= 0.38
      && latinNaturalness + 0.18 >= cjkNaturalness;
    return latinHasAcousticLead ? nonCjk : cjk;
  }
  if (latinHasText && scriptRatio(cjk.text, "latin") <= 0.15) {
    if (latinNaturalness - cjkNaturalness >= 0.18) return nonCjk;
    if (cjkNaturalness - latinNaturalness >= 0.18) return cjk;
    if (latinConfidence + 0.05 >= cjkConfidence
        || (nonCjk.revisionPenalty || 0) <= (cjk.revisionPenalty || 0) + 0.25) {
      return nonCjk;
    }
    return cjk;
  }
  return null;
}

function recognitionAlternatives(body) {
  if (Array.isArray(body?.NBest) && body.NBest.length) return body.NBest.slice(0, 5);
  return [body || {}];
}

function recognitionText(alternative) {
  return String(
    alternative?.DisplayText
    || alternative?.Text
    || alternative?.Display
    || alternative?.ITN
    || alternative?.MaskedITN
    || alternative?.Lexical
    || ""
  ).trim();
}

function alternativeScore(alternative) {
  const confidence = alternative.confidence === null ? 0.45 : alternative.confidence;
  const lengthSignal = Math.min(normalizeComparableText(alternative.text).length, 40) / 40;
  return confidence * 9
    + alternative.scriptScore * 5
    + alternative.stability * 1.5
    + lengthSignal * 0.35
    - alternative.artifactPenalty
    - alternative.revisionPenalty
    - (Number.isFinite(alternative.naturalness)
      ? Math.max(0, 0.68 - alternative.naturalness) * 2.2
      : 0);
}

function isReliableCandidate(candidate) {
  if (candidate.scriptScore < 0.2) return false;
  if (Number.isFinite(candidate.naturalness) && candidate.naturalness < 0.48) return false;
  if (candidate.confidence === null) return true;
  if (candidate.confidence >= 0.22) return true;
  return candidate.scriptScore >= 0.85 && candidate.stability >= 0.75;
}

function comparableConfidence(candidate) {
  return candidate.confidence === null ? 0.45 : candidate.confidence;
}

function finiteConfidence(value) {
  const confidence = Number(value);
  return Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null;
}

function hypothesisStability(text, history) {
  if (!text || !history.length) return 0;
  return Math.max(...history.slice(-6).map((hypothesis) => textSimilarity(text, hypothesis)));
}

function textSimilarity(left, right) {
  const a = normalizeComparableText(left);
  const b = normalizeComparableText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (longer.includes(shorter)) return shorter.length / longer.length;
  if (a.length < 2 || b.length < 2) return 0;

  const counts = new Map();
  for (let index = 0; index < a.length - 1; index += 1) {
    const pair = a.slice(index, index + 2);
    counts.set(pair, (counts.get(pair) || 0) + 1);
  }
  let intersection = 0;
  for (let index = 0; index < b.length - 1; index += 1) {
    const pair = b.slice(index, index + 2);
    const count = counts.get(pair) || 0;
    if (!count) continue;
    intersection += 1;
    counts.set(pair, count - 1);
  }
  return (2 * intersection) / (a.length + b.length - 2);
}

function normalizeComparableText(text) {
  return String(text || "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function boundedEditDistance(left, right) {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function isCjkLanguage(languageCode) {
  return ["zh-Hans", "zh-Hant", "yue", "ja", "ko"].includes(languageCode);
}

function scriptRatio(text, type) {
  const value = String(text || "");
  const counts = {
    cjk: (value.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g) || []).length,
    latin: (value.match(/[A-Za-z\u00c0-\u024f]/g) || []).length
  };
  const total = counts.cjk + counts.latin;
  return total ? (counts[type] || 0) / total : 0;
}

function comparableCandidateConfidence(candidate) {
  const confidence = Number(candidate?.confidence);
  return Number.isFinite(confidence) ? confidence : 0.45;
}

function speechArtifactPenalty(text) {
  const value = String(text || "");
  if (!normalizeComparableText(value)) return 4;
  let penalty = 0;
  if (/\ufffd/.test(value)) penalty += 2;
  if (/([^\s])\1{5,}/u.test(value)) penalty += 1;
  if (/([!?.,，。！？])\1{3,}/u.test(value)) penalty += 0.8;
  const words = value.toLocaleLowerCase().match(/[a-z\u00c0-\u024f]+/g) || [];
  for (let index = 1; index < words.length; index += 1) {
    if (words[index] === words[index - 1]) penalty += 0.45;
  }
  return penalty;
}

function hypothesisRevisionPenalty(text, hypothesisCount) {
  const revisions = Number(hypothesisCount) || 0;
  if (!revisions) return 0;
  const value = String(text || "");
  const cjkUnits = (value.match(SCRIPT_PATTERNS.cjk) || []).length;
  const wordUnits = (value.match(/[A-Za-z\u00c0-\u024f]+/g) || []).length;
  const units = cjkUnits >= wordUnits ? cjkUnits : wordUnits;
  if (!units) return 0;
  const excessRevisions = Math.max(0, revisions - units * 1.35 - 2);
  return Math.min(2.5, excessRevisions * 0.12);
}

function languageScript(languageCode) {
  for (const [script, languages] of Object.entries(SCRIPT_LANGUAGES)) {
    if (languages.has(languageCode)) return script;
  }
  return languageCode && languageCode !== "auto-detect" ? "latin" : "";
}

function characterOverlap(left, right) {
  const max = Math.min(16, left.length, right.length);
  for (let size = max; size >= 2; size -= 1) {
    if (left.slice(-size) === right.slice(0, size)) return size;
  }
  return 0;
}

function wordOverlap(leftWords, rightWords) {
  const max = Math.min(6, leftWords.length, rightWords.length);
  for (let size = max; size >= 2; size -= 1) {
    const left = leftWords.slice(-size).join(" ").toLocaleLowerCase();
    const right = rightWords.slice(0, size).join(" ").toLocaleLowerCase();
    if (left === right) return size;
  }
  return 0;
}
