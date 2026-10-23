// G13: an explicit local no-match must not become a component association.
// node tests/correlation-attribution.test.mjs — no browser data or network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const sandbox = { window: {}, console, Date };
vm.createContext(sandbox);
for (const f of ['js/data.js', 'js/diet.js', 'js/diary.js']) {
  vm.runInContext(readFileSync(new URL('../' + f, import.meta.url), 'utf8'), sandbox);
}
const Diary = sandbox.window.IntolDiary;
const Diet = sandbox.window.IntolDiet;
const H = 3600e3;
const at = Date.UTC(2026, 9, 22, 12);
const meal = (id, mins) => ({ id, createdAt: at - mins * 60e3, ingredients: [{ id: 'lactosa', source: 'manual' }], description: 'Yogur' });
const entry = (id, time = at) => ({ id, at: time, text: 'gases', level: 2, symptoms: ['gases'] });
const analyze = (e, meals) => ({ ...e, analysis: { source: 'local', ...Diary.localAnalyze(e, meals, []) } });
// Exercise the real UI stats function without booting the entire DOM application.
const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const statsCode = app.slice(app.indexOf('  function stats() {'), app.indexOf('  function renderSummary() {'));
const stats = (meals, entries) => {
  sandbox.intakes = () => meals;
  sandbox.feels = () => Diary.feelings(meals, entries);
  return vm.runInContext(statsCode + '\nstats()', sandbox);
};
let n = 0;
function test(name, fn) { fn(); console.log('PASS ' + name); n++; }
test('1 minute is outside lactose local timing; Timeline context remains', () => {
  const meals = [meal('m', 1)], e = analyze(entry('e'), meals);
  assert.equal(e.analysis.causes.length, 0);
  assert.equal(Diary.linkedMeals(e, meals).length, 1);
  assert.equal(Diary.entriesForMeal(meals[0], meals, [e]).length, 1);
});
test('an explicit local no-match stays as one unassigned symptom record', () => {
  const meals = [meal('m', 1)], e = analyze(entry('e'), meals);
  const recs = Diary.feelings(meals, [e]);
  assert.equal(recs.length, 1); assert.equal(recs[0].mealId, null);
  assert.equal(recs[0].feeling, 2); assert.equal(recs[0].entryId, 'e');
  assert.equal(stats(meals, [e]).length, 0);
  assert.equal(Diet.buildSignals(meals, recs).baseline, 2);
});
test('three immediate diary entries do not produce a 3/3 lactose suggestion', () => {
  const meals = [0, 1, 2].map(i => ({ ...meal('m' + i, 1), createdAt: at - i * 48 * H - 60e3 }));
  const entries = meals.map((m, i) => analyze(entry('e' + i, m.createdAt + 60e3), meals));
  assert.equal(stats(meals, entries).length, 0);
  assert.equal(Diet.buildSignals(meals, Diary.feelings(meals, entries)).avoid.length, 0);
});
test('one no-match symptom does not multiply into three meal observations', () => {
  const meals = [meal('a', 1), meal('b', 2), meal('c', 3)];
  const e = analyze(entry('e'), meals);
  assert.equal(Diary.feelings(meals, [e]).length, 1);
  assert.equal(stats(meals, [e]).length, 0);
});
test('15-minute near-window and 30/120-minute typical matches still count', () => {
  for (const minutes of [15, 30, 120]) {
    const meals = [meal('m', minutes)], e = analyze(entry('e'), meals);
    assert.equal(e.analysis.causes.length, 1);
    assert.equal(stats(meals, [e])[0].bad, 1);
  }
});
test('beyond extended local timing does not count as a match', () => {
  const meals = [meal('m', 241)], e = analyze(entry('e'), meals);
  assert.equal(e.analysis.causes.length, 0); assert.equal(stats(meals, [e]).length, 0);
});
test('positive entries, pending analysis, explicit legacy links and AI behavior preserved', () => {
  const meals = [meal('m', 1)];
  const positive = { ...entry('positive'), level: 5, symptoms: [], analysis: { source: 'local', causes: [] } };
  assert.equal(Diary.feelings(meals, [positive])[0].mealId, 'm');
  assert.equal(Diary.feelings(meals, [entry('pending')])[0].mealId, 'm');
  const legacy = { ...entry('legacy'), mealId: 'm', legacy: {}, analysis: null };
  assert.equal(Diary.feelings(meals, [legacy])[0].mealId, 'm');
  const ai = { ...entry('ai'), analysis: { source: 'ia', causes: [] } };
  assert.equal(Diary.feelings(meals, [ai])[0].mealId, 'm');
});
console.log(`${n}/${n} regression groups passed`);
