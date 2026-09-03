const assert = require('assert');
const {
  classifyPlaybackEcho,
  compareText,
  removeReferenceSegment,
} = require('../public/js/interpreter-echo');

const reference = {
  text: 'Hello, how are you today?',
  lang: 'en',
  startedAt: 1000,
  endedAt: 3200,
  expiresAt: 5400,
};

assert.strictEqual(classifyPlaybackEcho(
  'hello how are you today', 'en', [reference], { startedAt: 1200, endedAt: 3000 }, 3000,
).isEcho, true, 'an exact playback transcript must be filtered');

assert.strictEqual(classifyPlaybackEcho(
  'please open the window', 'en', [reference], { startedAt: 1200, endedAt: 3000 }, 3000,
).isEcho, false, 'unrelated speech during playback must remain');

assert.strictEqual(compareText('turn off the light', 'turn on the light').probableEcho, false,
  'opposite user intent must not be treated as playback');
assert.strictEqual(compareText('the meeting starts at 4pm', 'the meeting starts at 3pm').probableEcho, false,
  'number changes must not be treated as harmless ASR differences');

assert.strictEqual(
  removeReferenceSegment('Hello how are you today, I need an interpreter.', reference.text),
  'I need an interpreter',
  'mixed speech must retain the user portion even when punctuation differs',
);
assert.strictEqual(
  removeReferenceSegment('您好请问需要什么帮助，我要咨询签证', '您好，请问需要什么帮助？'),
  '我要咨询签证',
  'mixed Chinese speech must retain the user portion',
);

process.stdout.write('web interpreter echo filter tests passed\n');
