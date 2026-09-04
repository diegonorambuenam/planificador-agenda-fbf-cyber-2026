import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import * as XLSX from 'xlsx';

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL('../src/services/agenda-export.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace("'xlsx'", JSON.stringify(pathToFileURL(require.resolve('xlsx')).href));
const { createAgendaWorkbook, sourceValue } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const fixture = { number: '0000123', sellerId: '00004', sellerName: '=UNTRUSTED()', warehouse: '9006', units: 12,
  origin: 'sheet', fechaDefinitiva: '2026-09-16', fechaEnvioOriginal: '2026-09-15', fechaInicio: '', fechaFin: '',
  planningStatus: 'Reprogramado', priority: 'Normal', planningComment: 'Fixture', estadoFuente: 'Recibido',
  validationStatus: 'error', validationMessages: ['Fecha incompleta'], sourceRow: { number: '0000123', extra: '=1+1', empty: '', zero: 0, bool: false } };

test('export covers all scheduled warehouses and weeks, excludes pending, preserves input', () => {
  const requests = [fixture, { ...fixture, number: 'P-TEST', origin: 'provisional', warehouse: '7002', fechaDefinitiva: '2026-09-14', sourceRow: undefined, unitsMissing: true }, { ...fixture, number: 'PENDING', fechaDefinitiva: null }];
  const before = structuredClone(requests);
  const workbook = createAgendaWorkbook(requests, new Date('2026-09-04T12:00:00Z'));
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const saved = XLSX.read(bytes, { type: 'buffer', cellDates: true });
  assert.deepEqual(saved.SheetNames, ['Agendas', 'Datos de origen', 'Información']);
  const rows = XLSX.utils.sheet_to_json(saved.Sheets.Agendas, { defval: '' });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].Number, 'P-TEST');
  assert.equal(rows[0].Unidades, '');
  assert.equal(rows[0].Origen, 'Provisoria');
  assert.equal(rows[1].Number, '0000123');
  assert.equal(rows[1]['Seller ID'], '00004');
  assert.equal(rows[1].Unidades, 12);
  assert.equal(rows[1].Alertas, 'Fecha incompleta');
  assert.equal(rows[1]['Fecha asignada'].toISOString().slice(0, 10), '2026-09-16');
  assert.equal(saved.Sheets.Agendas.E3.t, 's');
  assert.equal(saved.Sheets.Agendas.E3.f, undefined);
  const raw = XLSX.utils.sheet_to_json(saved.Sheets['Datos de origen'], { defval: '' });
  assert.equal(raw[1]['Origen: extra'], '=1+1');
  assert.equal(raw[1]['Origen: zero'], 0);
  assert.equal(raw[1]['Origen: bool'], false);
  assert.equal(saved.Sheets['Datos de origen'].D3.f, undefined);
  assert.deepEqual(requests, before);
});
test('empty export is explicit and complex original values remain readable', () => {
  assert.throws(() => createAgendaWorkbook([]), /No hay agendas/);
  assert.equal(sourceValue(null), '');
  assert.equal(sourceValue(false), false);
  assert.equal(sourceValue({ detail: ['a', 'b'] }), '{"detail":["a","b"]}');
});
test('details are available on real cards with pointer isolation and original columns', () => {
  const board = readFileSync(new URL('../src/features/agenda/agenda-board.tsx', import.meta.url), 'utf8');
  const details = readFileSync(new URL('../src/features/agenda/request-details.tsx', import.meta.url), 'utf8');
  assert.ok(board.includes('!overlay && <RequestDetails request={request} />'));
  assert.ok(board.includes('<ExportAgendasButton requests={requests} />'));
  assert.ok(details.includes('event.stopPropagation()'));
  assert.ok(details.includes('Object.entries(request.sourceRow ?? {})'));
  assert.ok(details.includes('DialogClose'));
});
