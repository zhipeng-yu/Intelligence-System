import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function uiFunction(name, context) {
  const start = html.search(new RegExp(`    (?:async )?function ${name}\\(`));
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

test('binding terminal states revoke the displayed image and key; halted queues stop polling', async () => {
  for (const [status, halted] of [['ready', false], ['expired', false], ['blocked', false], ['waiting', true], ['queued', true], ['ready', true], ['expired', true]]) {
    const image = { hidden: false, removeAttribute() { this.removed = true; } };
    const label = { textContent: '' };
    const revoked = [];
    const context = {
      bindingRequest: 'synthetic', bindingKey: {}, bindingImage: 'blob:synthetic',
      bindingImageRequest: 'synthetic', bindingExpiry: 1, bindingTimer: 2,
      apiFetch: async () => ({ json: async () => ({ halted, binding: { status, request_id: 'synthetic' } }) }),
      document: { querySelector: selector => selector === '#bindingQr' ? image : label },
      URL: { revokeObjectURL: value => revoked.push(value) },
      clearTimeout() {}, setTimeout() { assert.fail('Terminal state must stop polling'); }
    };
    uiFunction('clearBindingImage', context);
    await uiFunction('refreshBinding', context)();
    assert.equal(image.hidden, true);
    assert.equal(image.removed, true);
    assert.equal(context.bindingKey, null);
    assert.deepEqual(revoked, ['blob:synthetic']);
    if (halted || status === 'blocked') assert.match(label.textContent, /勿反复扫码/);
  }
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
