import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync(new URL('../src/services/source-status.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { sourceStatusLabel, matchesSourceStatus, sourceStatusOptions } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const rows = [{ origin: 'sheet', estadoFuente: 'Agenda Cyber', planningStatus: 'Pendiente' }, { origin: 'sheet', estadoFuente: 'Probable borrador', planningStatus: 'Agendado' }, { origin: 'sheet', estadoFuente: '' }, { origin: 'provisional', estadoFuente: 'Provisoria' }];
test('uses original status, independent of planning state', () => {
  assert.equal(sourceStatusLabel(rows[0]), 'Agenda Cyber');
  assert.equal(sourceStatusLabel(rows[1]), 'Probable borrador');
  assert.equal(matchesSourceStatus(rows[0], 'status:agenda cyber'), true);
  assert.equal(matchesSourceStatus(rows[1], 'status:agenda cyber'), false);
  assert.equal(rows.filter(row => matchesSourceStatus(row, 'all')).length, 4);
});
test('options are dynamic and missing/provisional values stay distinct', () => {
  const options = sourceStatusOptions([...rows, { ...rows[0], estadoFuente: ' agenda   cyber ' }, { ...rows[0], estadoFuente: 'Estado nuevo' }]);
  assert.equal(options.length, 5);
  assert.ok(options.some(option => option.value === 'status:estado nuevo'));
  assert.equal(matchesSourceStatus(rows[2], 'missing'), true);
  assert.equal(matchesSourceStatus(rows[3], 'missing'), false);
  assert.equal(matchesSourceStatus(rows[3], 'provisional'), true);
});
test('card filtering does not change capacity calculations or export scope', () => {
  const board = readFileSync(new URL('../src/features/agenda/agenda-board.tsx', import.meta.url), 'utf8');
  assert.ok(board.includes('dayMetrics(requests, capacities, warehouse, date)'));
  assert.ok(board.includes('dayMetrics(requests, capacities, warehouse, day.date)'));
  assert.ok(board.includes('metrics.assigned.filter(request => matchesSourceStatus(request, sourceStatus)).map'));
  assert.ok(board.includes('<ExportAgendasButton requests={requests} />'));
  assert.ok(board.includes('sourceStatusLabel(request)'));
});
