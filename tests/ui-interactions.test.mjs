import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function uiFunction(name, context) {
  const start = html.indexOf(`    function ${name}(`);
  assert.notEqual(start, -1);
  const end = start + html.slice(start).search(/\n    (?:(?:async )?function |const |let |document\.|Object\.)/);
  runInNewContext(html.slice(start, end), context);
  return context[name];
}

test('case changes restore each in-memory text and image draft and move focus to the case heading', () => {
  const firstImages = [{ url: 'blob:first', file: { name: 'first.png' } }];
  const answer = { value: 'First unsent answer' };
  const heading = { focus() { this.focused = true; } };
  const context = {
    selectedDiagnosisId: 'first', diagnosisBusy: false,
    diagnosisDraftImages: { answerImages: firstImages }, answerDrafts: new Map(),
    DIAGNOSIS_STATUS_LABELS: { active: 'AI 诊断中' }, formatDate: () => 'date',
    document: { querySelector: selector => selector === '#diagnosisAnswer' ? answer : heading },
    node: () => ({ append() {}, setAttribute() {}, addEventListener(type, callback) { this[type] = callback; } }),
    renderDraftImages() {}, showMessage() {}, renderDiagnoses() {}, scrollToElement() {}, diagnosisWorkspace: {}
  };
  const button = uiFunction('diagnosisCaseButton', context);
  button({ id: 'second', name: 'Second', status: 'active' }).click();
  assert.equal(answer.value, '');
  assert.equal(context.answerDrafts.get('first').text, 'First unsent answer');
  assert.equal(context.answerDrafts.get('first').images, firstImages);
  answer.value = 'Second unsent answer';
  button({ id: 'first', name: 'First', status: 'active' }).click();
  assert.equal(answer.value, 'First unsent answer');
  assert.equal(context.diagnosisDraftImages.answerImages, firstImages);
  assert.equal(context.answerDrafts.get('second').text, 'Second unsent answer');
  assert.equal(heading.focused, true);
  context.diagnosisBusy = true;
  button({ id: 'second', name: 'Second', status: 'active' }).click();
  assert.equal(context.selectedDiagnosisId, 'first');
});

test('AI submission locks navigation and inputs, then restores their prior disabled states', () => {
  const controls = [{ disabled: false }, { disabled: true }, { disabled: false }];
  const attrs = new Map();
  const form = { setAttribute: (key, value) => attrs.set(key, value), removeAttribute: key => attrs.delete(key) };
  const context = { diagnosisBusy: false, diagnosisAnswerForm: form,
    document: { querySelector: () => form, querySelectorAll: () => controls } };
  const unlock = uiFunction('lockDiagnosis', context)();
  assert.equal(context.diagnosisBusy, true);
  assert.equal(attrs.get('aria-busy'), 'true');
  assert.ok(controls.every(control => control.disabled));
  unlock();
  unlock();
  assert.equal(context.diagnosisBusy, false);
  assert.equal(attrs.has('aria-busy'), false);
  assert.deepEqual(controls.map(control => control.disabled), [false, true, false]);
});

test('reduced motion skips JS entry animation and smooth scrolling', () => {
  const element = { animations: 0, animate() { this.animations++; }, scrollIntoView(options) { this.scroll = options; } };
  const context = { reducedMotion: { matches: true } };
  uiFunction('reveal', context)(element);
  uiFunction('scrollToElement', context)(element);
  assert.equal(element.animations, 0);
  assert.equal(element.scroll.behavior, 'instant');
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important; transition: none !important/);
});
