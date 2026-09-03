(function attachInterpreterPlaybackEcho(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.InterpreterPlaybackEcho = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const MAX_COMPARE_LENGTH = 240;

  function normalizeSpeechText(value) {
    let text = String(value || '').toLowerCase();
    try { text = text.normalize('NFKC'); } catch {}
    return text
      .replace(/[\s.,!?;:'"()[\]{}<>，。！？；：、“”‘’（）【】《》…—_~`@#$%^&*+=|\\/·-]+/g, '')
      .slice(0, MAX_COMPARE_LENGTH);
  }

  function languageBase(value) {
    return String(value || '').toLowerCase().split('-')[0];
  }

  function hasNegation(value) {
    const text = String(value || '').toLowerCase();
    return /(^|[^a-zÀ-ɏ])(?:no|not|never|cannot|can't|dont|don't|doesnt|doesn't|didnt|didn't|wont|won't|without|non|nunca|ne|pas|jamais|nicht|kein|keine|keinen|mai|nao|não)(?=$|[^a-zÀ-ɏ])/.test(text) ||
      /(?:不|没|别|無|无|未|勿|否|非|莫|不要|不能|不会|ない|ません|안|않|못|не|нет|لا|ليس|لن|لم|नहीं|मत)/.test(text);
  }

  function hasSemanticConflict(leftValue, rightValue) {
    const left = String(leftValue || '').toLowerCase();
    const right = String(rightValue || '').toLowerCase();
    if (hasNegation(left) !== hasNegation(right)) return true;
    const opposites = [
      [/(^|\W)on(?=$|\W)/, /(^|\W)off(?=$|\W)/],
      [/(^|\W)open(?=$|\W)/, /(^|\W)clos(?:e|ed)(?=$|\W)/],
      [/(^|\W)start(?=$|\W)/, /(^|\W)stop(?=$|\W)/],
      [/(^|\W)agree(?=$|\W)/, /(^|\W)disagree(?=$|\W)/],
      [/(^|\W)accept(?=$|\W)/, /(^|\W)reject(?=$|\W)/],
      [/(^|\W)enable(?=$|\W)/, /(^|\W)disable(?=$|\W)/],
      [/(^|\W)allow(?=$|\W)/, /(^|\W)den(?:y|ied)(?=$|\W)/],
      [/开/, /关/], [/同意/, /反对/], [/接受/, /拒绝/], [/启用/, /禁用/],
    ];
    return opposites.some(([first, second]) =>
      (first.test(left) && second.test(right)) || (second.test(left) && first.test(right)));
  }

  function levenshteinSimilarity(leftValue, rightValue) {
    const left = String(leftValue || '').slice(0, MAX_COMPARE_LENGTH);
    const right = String(rightValue || '').slice(0, MAX_COMPARE_LENGTH);
    if (left === right) return left ? 1 : 0;
    if (!left || !right) return 0;
    const previous = new Array(right.length + 1);
    const current = new Array(right.length + 1);
    for (let column = 0; column <= right.length; column += 1) previous[column] = column;
    for (let row = 1; row <= left.length; row += 1) {
      current[0] = row;
      for (let column = 1; column <= right.length; column += 1) {
        const substitution = previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1);
        current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, substitution);
      }
      for (let column = 0; column <= right.length; column += 1) previous[column] = current[column];
    }
    return 1 - previous[right.length] / Math.max(left.length, right.length);
  }

  function bigramDice(left, right) {
    if (left === right) return left ? 1 : 0;
    if (left.length < 2 || right.length < 2) return 0;
    const counts = Object.create(null);
    for (let index = 0; index < left.length - 1; index += 1) {
      const gram = left.slice(index, index + 2);
      counts[gram] = (counts[gram] || 0) + 1;
    }
    let matches = 0;
    for (let index = 0; index < right.length - 1; index += 1) {
      const gram = right.slice(index, index + 2);
      if (counts[gram]) {
        counts[gram] -= 1;
        matches += 1;
      }
    }
    return matches * 2 / (left.length + right.length - 2);
  }

  function isOrthographicNearMatch(leftValue, rightValue) {
    let left = String(leftValue || '').toLowerCase();
    let right = String(rightValue || '').toLowerCase();
    try { left = left.normalize('NFKC'); right = right.normalize('NFKC'); } catch {}
    if (/[^a-zÀ-ɏ0-9\s.,!?;:'"()[\]{}<>_-]/.test(left) ||
        /[^a-zÀ-ɏ0-9\s.,!?;:'"()[\]{}<>_-]/.test(right)) return false;
    const leftNumbers = left.match(/\d+/g) || [];
    const rightNumbers = right.match(/\d+/g) || [];
    if (leftNumbers.join('|') !== rightNumbers.join('|')) return false;
    const leftTokens = left.match(/[a-zÀ-ɏ]+|\d+/g) || [];
    const rightTokens = right.match(/[a-zÀ-ɏ]+|\d+/g) || [];
    if (!leftTokens.length || leftTokens.length !== rightTokens.length) return false;
    let changed = 0;
    for (let index = 0; index < leftTokens.length; index += 1) {
      if (leftTokens[index] === rightTokens[index]) continue;
      changed += 1;
      if (changed > 1 || /\d/.test(leftTokens[index] + rightTokens[index]) ||
          Math.min(leftTokens[index].length, rightTokens[index].length) < 4) return false;
      const longest = Math.max(leftTokens[index].length, rightTokens[index].length);
      const distance = Math.round((1 - levenshteinSimilarity(leftTokens[index], rightTokens[index])) * longest);
      if (distance !== 1) return false;
    }
    return changed === 1;
  }

  function compareText(text, referenceText) {
    const value = normalizeSpeechText(text);
    const reference = normalizeSpeechText(referenceText);
    const empty = {
      score: 0, pure: false, probableEcho: false, contaminated: false,
      containedByReference: false, containsReference: false, semanticConflict: false,
    };
    if (!value || !reference) return empty;
    if (value === reference) return { ...empty, score: 1, pure: true, probableEcho: true, contaminated: true };
    const semanticConflict = hasSemanticConflict(text, referenceText);
    const lengthRatio = Math.min(value.length, reference.length) / Math.max(value.length, reference.length);
    const compactScript = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(value + reference);
    const shortComparison = Math.min(value.length, reference.length) < 4 && !compactScript;
    if (!shortComparison && reference.includes(value)) {
      const coverage = value.length / reference.length;
      return {
        ...empty,
        score: Math.max(0.5, coverage),
        probableEcho: value.length >= 6 && coverage >= 0.86 && !semanticConflict,
        contaminated: true,
        containedByReference: true,
        semanticConflict,
      };
    }
    if (!shortComparison && value.includes(reference)) {
      return {
        ...empty,
        score: reference.length / value.length,
        contaminated: true,
        containsReference: true,
        semanticConflict,
      };
    }
    if (Math.min(value.length, reference.length) < 4) return empty;
    const score = Math.max(levenshteinSimilarity(value, reference), bigramDice(value, reference));
    return {
      ...empty,
      score,
      probableEcho: Math.min(value.length, reference.length) >= 6 && lengthRatio >= 0.86 &&
        score >= 0.9 && !semanticConflict && isOrthographicNearMatch(text, referenceText),
      contaminated: score >= 0.38,
      semanticConflict,
    };
  }

  function windowsOverlap(reference, capture, now) {
    const referenceStart = Number(reference?.startedAt) || 0;
    if (!referenceStart) return false;
    const referenceEnd = Number(reference.endedAt) || now;
    const captureStart = Number(capture?.startedAt) || now;
    const captureEnd = Number(capture?.endedAt) || captureStart;
    return captureStart <= referenceEnd + 2200 && captureEnd >= referenceStart - 180;
  }

  function classifyPlaybackEcho(text, language, references, captureWindow, nowValue) {
    const now = Number(nowValue) || Date.now();
    const detectedLanguage = languageBase(language);
    let best = { isEcho: false, probableEcho: false, contaminated: false, score: 0, reference: null };
    for (const reference of Array.isArray(references) ? references : []) {
      if (!reference || !windowsOverlap(reference, captureWindow, now)) continue;
      const compared = compareText(text, reference.text);
      const referenceLanguage = languageBase(reference.lang);
      const languageMismatch = Boolean(detectedLanguage && referenceLanguage && detectedLanguage !== referenceLanguage);
      if (languageMismatch && !compared.containsReference && !compared.containedByReference && compared.score < 0.86) continue;
      if (compared.score <= best.score) continue;
      best = {
        isEcho: compared.pure && (!languageMismatch || compared.score >= 0.9),
        probableEcho: compared.probableEcho && (!languageMismatch || compared.score >= 0.94),
        contaminated: compared.contaminated,
        containedByReference: compared.containedByReference,
        containsReference: compared.containsReference,
        semanticConflict: compared.semanticConflict,
        score: compared.score,
        reference,
      };
    }
    return best;
  }

  function normalizedCharacterMap(value) {
    let normalized = '';
    const map = [];
    let offset = 0;
    for (const character of String(value || '')) {
      let folded = character.toLowerCase();
      try { folded = folded.normalize('NFKC'); } catch {}
      for (const foldedCharacter of folded) {
        if (!/[\p{L}\p{N}]/u.test(foldedCharacter)) continue;
        normalized += foldedCharacter;
        map.push({ start: offset, end: offset + character.length });
      }
      offset += character.length;
    }
    return { normalized, map };
  }

  function removeReferenceSegment(value, referenceText) {
    const source = normalizedCharacterMap(value);
    const reference = normalizedCharacterMap(referenceText).normalized;
    const index = reference ? source.normalized.indexOf(reference) : -1;
    if (index < 0 || !source.map[index] || !source.map[index + reference.length - 1]) return String(value || '').trim();
    const start = source.map[index].start;
    const end = source.map[index + reference.length - 1].end;
    return `${String(value).slice(0, start)} ${String(value).slice(end)}`
      .replace(/^[\s,.;:!?，。！？、；：]+|[\s,.;:!?，。！？、；：]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeCaptionArtifact(value) {
    let text = String(value || '').toLowerCase();
    try { text = text.normalize('NFKC'); } catch {}
    return text.replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 500);
  }

  function classifyCaptionArtifact(value) {
    const text = normalizeCaptionArtifact(value);
    if (!text) return { isArtifact: false, strong: false, reason: '' };
    const fixed = [
      '请不吝点赞订阅转发打赏支持明镜与点点栏目',
      '请不吝点赞订阅转发打赏支持明镜与点点',
      '字幕由amaraorg社区提供',
      '字幕由amara社区提供',
      '字幕由志愿者提供',
      '字幕由志愿者制作',
    ].some((phrase) => text.includes(phrase)) ||
      /(?:subtitle|subtitles|caption|captions)(?:volunteer|providedby|createdby|translatedby|contributedby)/.test(text);
    if (fixed) return { isArtifact: true, strong: true, reason: 'fixed-caption' };

    const chineseHits = ['点赞', '點讚', '关注', '關注', '订阅', '訂閱', '转发', '轉發', '打赏', '打賞', '感谢观看']
      .filter((phrase) => text.includes(phrase)).length;
    const creatorTemplate = chineseHits >= 3 ||
      /(?:thanksforwatching|thankyouforwatching|likeandsubscribe|pleasesubscribe|dontforgettosubscribe)/.test(text) ||
      /^(?:please)?(?:rememberto|dontforgetto)?(?:like|subscribe|follow|share|comment|support)(?:(?:and)?(?:like|subscribe|follow|share|comment|support))+(?:thischannel|thechannel|us)?$/.test(text);
    return {
      isArtifact: creatorTemplate,
      strong: false,
      reason: creatorTemplate ? 'creator-boilerplate' : '',
    };
  }

  function shouldRejectFinalTranscript(result, artifact = classifyCaptionArtifact(result?.text)) {
    return Boolean(result?.accepted === false || result?.whisper_filtered_reason || artifact?.strong);
  }

  return {
    normalizeSpeechText,
    compareText,
    classifyPlaybackEcho,
    removeReferenceSegment,
    classifyCaptionArtifact,
    shouldRejectFinalTranscript,
  };
});
