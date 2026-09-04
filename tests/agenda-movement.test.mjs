import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/services/agenda-movement.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { canMoveRequest, movementAlerts } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const request = { number: 'TEST-ONLY', origin: 'sheet', validationStatus: 'error', planningStatus: 'Con problema', validationMessages: ['Fecha de origen incompleta'], unitsMissing: true };

test('problem requests can move without clearing their alerts', () => {
  const original = structuredClone(request);
  assert.equal(canMoveRequest(request), true);
  assert.ok(movementAlerts(request).includes('Fecha de origen incompleta'));
  assert.ok(movementAlerts(request).some(message => message.includes('ocupación')));
  assert.deepEqual(request, original);
  assert.equal(canMoveRequest({ ...request, fechaDefinitiva: '2026-09-15', planningStatus: 'Agendado' }), true);
});
test('absent source is an alert, not a movement block', () => {
  const absent = { ...request, sourceAbsent: true };
  assert.equal(canMoveRequest(absent), true);
  assert.ok(movementAlerts(absent).some(message => message.includes('última actualización')));
});
test('provisional and unidentified requests keep their safety guard', () => {
  assert.equal(canMoveRequest({ ...request, origin: 'provisional' }), false);
  assert.equal(canMoveRequest({ ...request, number: '' }), false);
});
test('both drag entry points use the movement policy and keep confirmation', () => {
  const board = readFileSync(new URL('../src/features/agenda/agenda-board.tsx', import.meta.url), 'utf8');
  assert.equal(board.match(/!canMoveRequest\(request\)/g)?.length, 2);
  assert.ok(board.includes('const warnings = movementAlerts(request)'));
  assert.ok(board.includes('window.confirm'));
  assert.ok(board.includes("compact ? 'scheduled' : 'number'"));
  assert.ok(board.includes("request.validationStatus === 'error' || request.sourceAbsent || request.planningStatus === 'Con problema' ? 'problem'"));
});
