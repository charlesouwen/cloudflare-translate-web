import test from "node:test";
import assert from "node:assert/strict";

import {
  appendSpeechSegment,
  chooseCrossScriptCandidate,
  chooseRecognitionCandidate,
  createRecognitionCandidate,
  estimateSpeechCommitDelay,
  mergeSpeechHypothesis,
  safeSpeechCorrection,
  speechScriptCompatibility,
  speechSentenceNaturalness,
  speechTranslationQuality
} from "../public/interpreter/speech-quality.js";

function candidate(overrides = {}) {
  return {
    speaker: "a",
    text: "今天我们继续测试",
    success: true,
    confidence: 0.7,
    stability: 0.8,
    scriptScore: 1,
    artifactPenalty: 0,
    revisionPenalty: 0,
    hypothesisCount: 5,
    ...overrides
  };
}

test("selects a language-compatible NBest alternative", () => {
  const result = createRecognitionCandidate({
    RecognitionStatus: "Success",
    NBest: [
      { Confidence: 0.54, Display: "gene tear one test" },
      { Confidence: 0.46, Display: "今天我们继续测试" }
    ]
  }, {
    languageCode: "zh-Hans",
    hypothesisCount: 4,
    hypothesisHistory: ["今天我们测试", "今天我们继续测试"]
  });

  assert.equal(result.text, "今天我们继续测试");
  assert.equal(result.alternativeCount, 2);
  assert.equal(result.scriptScore, 1);
});

test("keeps an ambiguous bilingual result unresolved", () => {
  const chinese = candidate({ speaker: "a", text: "今天测试" });
  const english = candidate({
    speaker: "b",
    text: "test today",
    confidence: 0.7,
    stability: 0.8,
    scriptScore: 1
  });

  assert.equal(chooseRecognitionCandidate([chinese, english], { strict: true }), null);
});

test("uses speaker continuity for close continuation segments", () => {
  const chinese = candidate({ speaker: "a", text: "继续测试" });
  const english = candidate({
    speaker: "b",
    text: "continue testing",
    confidence: 0.72,
    stability: 0.82,
    scriptScore: 1
  });

  const selected = chooseRecognitionCandidate([chinese, english], {
    strict: true,
    pendingSpeaker: "a"
  });
  assert.equal(selected, chinese);
});

test("rejects a lone very-low-confidence automatic result", () => {
  const weak = candidate({ confidence: 0.1, stability: 0.3 });
  assert.equal(chooseRecognitionCandidate([weak], { strict: true }), null);
});

test("preserves a simple-mode result without detailed confidence", () => {
  const simple = candidate({ confidence: null, stability: 0 });
  assert.equal(chooseRecognitionCandidate([simple], { strict: false }), simple);
});

test("removes overlap when reconnecting Chinese and English segments", () => {
  assert.equal(appendSpeechSegment("今天我们继续测试", "继续测试这个功能", "zh-Hans"), "今天我们继续测试这个功能");
  assert.equal(
    appendSpeechSegment("we need to test this feature", "this feature again today", "en"),
    "we need to test this feature again today"
  );
});

test("uses language-specific script compatibility", () => {
  assert.equal(speechScriptCompatibility("这是一个包含英文品牌名称的中文识别内容 Cloudflare", "zh-Hans") > 0.5, true);
  assert.equal(speechScriptCompatibility("this is an English sentence 中文", "en") > 0.5, true);
  assert.equal(speechScriptCompatibility("안녕하세요", "ko"), 1);
});

test("rejects a high-confidence phonetic hallucination from the wrong language model", () => {
  const chinese = {
    speaker: "a",
    ...createRecognitionCandidate({
      RecognitionStatus: "Success",
      NBest: [{
        Confidence: 0.95561886,
        Display: "今天我们正在测试同声传译的语音识别准确度并且会在中间稍微停顿一下"
      }]
    }, {
      languageCode: "zh-Hans",
      hypothesisCount: 13,
      hypothesisHistory: [
        "今天我们正在测试同声传译的语音识别准确度并且会在中间稍微停顿",
        "今天我们正在测试同声传译的语音识别准确度并且会在中间稍微停顿一下"
      ]
    })
  };
  const englishHallucination = {
    speaker: "b",
    ...createRecognitionCandidate({
      RecognitionStatus: "Success",
      NBest: [{
        Confidence: 0.9850239,
        Display: "teen teen woman jones at hershey thompson chinese union shipyard ranchito painting who is i don't even show eating tanisha"
      }]
    }, {
      languageCode: "en",
      hypothesisCount: 39,
      hypothesisHistory: [
        "teen teen woman jones at hershey torsion chinese union shipyard ranchito painting who is actually",
        "teen teen woman jones at hershey torsion chinese union shipyard ranchito painting who is i don't even show eating"
      ]
    })
  };

  const selected = chooseRecognitionCandidate([chinese, englishHallucination], { strict: true });
  assert.equal(selected, chinese);
  assert.equal(englishHallucination.revisionPenalty > chinese.revisionPenalty, true);
});

test("waits longer when an automatic segment ends with an incomplete connector", () => {
  const complete = estimateSpeechCommitDelay("我今天已经到家了。", "zh-Hans", "auto");
  const incomplete = estimateSpeechCommitDelay("我今天已经到了", "zh-Hans", "auto");
  assert.equal(complete >= 1800 && complete <= 2400, true);
  assert.equal(incomplete > complete, true);
  assert.equal(incomplete <= 4800, true);
});

test("honors an explicit sentence-end strategy", () => {
  assert.equal(estimateSpeechCommitDelay("a long sentence", "en", "1600"), 1600);
  assert.equal(estimateSpeechCommitDelay("a long sentence", "en", "3800"), 3800);
});

test("accepts only conservative speech correction", () => {
  assert.equal(safeSpeechCorrection("this is teh test", "this is the test", "en"), "this is the test");
  assert.equal(safeSpeechCorrection("今天吃饭", "完全不同的一句话", "zh-Hans"), "今天吃饭");
});

test("prefers Chinese script over a slightly higher-confidence English hallucination", () => {
  const chinese = candidate({
    speaker: "a",
    language: { code: "zh-Hans" },
    text: "今天我们正在测试同声传译",
    confidence: 0.956
  });
  const english = candidate({
    speaker: "b",
    language: { code: "en" },
    text: "teen teen woman jones at hershey chinese union",
    confidence: 0.985
  });

  assert.equal(chooseCrossScriptCandidate([chinese, english]), chinese);
});

test("keeps stable Chinese when the wrong English model invents a fluent sentence", () => {
  const chinese = candidate({
    speaker: "a",
    language: { code: "zh-Hans" },
    text: "今天天气怎么样我正在吃披萨",
    confidence: 0.93,
    naturalness: 0.86,
    revisionPenalty: 0.3
  });
  const english = candidate({
    speaker: "b",
    language: { code: "en" },
    text: "How is the weather today? I am eating pizza.",
    confidence: 0.99,
    naturalness: 0.84,
    revisionPenalty: 0
  });

  assert.equal(chooseCrossScriptCandidate([chinese, english]), chinese);
});

test("prefers a strong English candidate when the Chinese model is clearly weaker", () => {
  const chinese = candidate({
    speaker: "a",
    language: { code: "zh-Hans" },
    text: "这是一段错误的中文候选",
    confidence: 0.925,
    revisionPenalty: 0.8
  });
  const english = candidate({
    speaker: "b",
    language: { code: "en" },
    text: "this is a clear English sentence",
    confidence: 0.992
  });

  assert.equal(chooseCrossScriptCandidate([chinese, english]), english);
});

test("rejects an English word chain that is not a natural sentence", () => {
  const hallucination = createRecognitionCandidate({
    RecognitionStatus: "Success",
    NBest: [{ Confidence: 0.99, Display: "how does the weather song cry eating pizza" }]
  }, {
    languageCode: "en",
    hypothesisCount: 3,
    hypothesisHistory: ["how does the weather song cry eating pizza"]
  });

  assert.equal(speechSentenceNaturalness(hallucination.text, "en") < 0.5, true);
  assert.equal(chooseRecognitionCandidate([{
    speaker: "b",
    language: { code: "en" },
    ...hallucination
  }], { strict: true }), null);
});

test("compares source and translation quality before accepting a phrase", () => {
  const noisy = speechTranslationQuality(
    "how does the weather song cry eating pizza",
    "天气歌《吃披萨时哭泣》",
    "en",
    "zh-Hans"
  );
  const natural = speechTranslationQuality(
    "How is the weather today? I am eating pizza.",
    "今天天气怎么样？我正在吃披萨。",
    "en",
    "zh-Hans"
  );

  assert.equal(natural - noisy >= 0.2, true);
});

test("keeps the stable prefix when Bing returns only the latest speech suffix", () => {
  assert.equal(
    mergeSpeechHypothesis("今天我们正在测试语音识别", "识别最后几个字", "zh-Hans"),
    "今天我们正在测试语音识别最后几个字"
  );
  assert.equal(
    mergeSpeechHypothesis("we are testing live speech", "live speech recognition", "en"),
    "we are testing live speech recognition"
  );
});

test("uses a newer cumulative hypothesis without duplicating the prefix", () => {
  assert.equal(
    mergeSpeechHypothesis("今天我们正在测试", "今天我们正在测试完整句子", "zh-Hans"),
    "今天我们正在测试完整句子"
  );
});
