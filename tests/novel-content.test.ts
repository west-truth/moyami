import assert from 'node:assert/strict';
import test from 'node:test';
import { novelHtmlText } from '../server/runtime/novel-content.js';

test('turns novel fragments into text and removes executable markup', () => {
  const text = novelHtmlText('<article><h1>제목</h1><p>첫 문단<br>둘째 줄</p><script>bad()</script><iframe src="x"></iframe></article>');
  assert.match(text, /제목/);
  assert.match(text, /첫 문단\n둘째 줄/);
  assert.doesNotMatch(text, /bad|iframe/);
});
