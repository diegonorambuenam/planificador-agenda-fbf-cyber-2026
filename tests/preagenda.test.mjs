import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const compile = path => ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const url=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const validationUrl=url(compile('../src/services/preagenda-validation.ts'));
const statusUrl=url(compile('../src/services/source-status.ts'));
const {parseValidations,isValidated}=await import(validationUrl);
const filterCode=compile('../src/services/agenda-filters.ts').replace("'./source-status'",JSON.stringify(statusUrl)).replace("'./preagenda-validation'",JSON.stringify(validationUrl));
const {filterAgendaRequests,displayDate}=await import(url(filterCode));
const row={number:'TEST-ONLY',kind:'fbf',approved:true,revision:'00000000-0000-4000-8000-000000000001',updated_at:'2026-09-04T12:00:00Z',updated_by:'Synthetic user'};
const filters={search:'',sourceStatus:'all',fbf:'all',commercial:'all',planned:'all'};
const requests=[{number:'TEST-ONLY',sellerId:'1',sellerName:'Test',estadoFuente:'Agenda Cyber',fechaDefinitiva:null,validationStatus:'error',warehouse:'9006'}, {number:'T2',sellerId:'2',sellerName:'Other',estadoFuente:'Probable borrador',fechaDefinitiva:'2026-09-15',warehouse:'7002'}];
test('pre-agenda validation is independent of dates and of the other kind',()=>{
  const rows=parseValidations([row]);
  assert.equal(isValidated(rows,'TEST-ONLY','fbf'),true);
  assert.equal(isValidated(rows,'TEST-ONLY','commercial'),false);
  assert.equal(filterAgendaRequests(requests,{...filters,fbf:'approved'},rows,true).length,1);
  const changed=[{...requests[0],fechaDefinitiva:'2026-09-25',warehouse:'7002',units:700}];
  assert.equal(filterAgendaRequests(changed,{...filters,fbf:'approved'},rows,true).length,1);
});
test('table includes assigned, unassigned and problem requests; combined filters work',()=>{
  const rows=parseValidations([row]);
  assert.equal(filterAgendaRequests(requests,filters,rows,true).length,2);
  assert.equal(filterAgendaRequests(requests,{...filters,planned:'pending'},rows,true)[0].validationStatus,'error');
  assert.equal(filterAgendaRequests(requests,{...filters,planned:'assigned'},rows,true)[0].number,'T2');
  assert.equal(filterAgendaRequests(requests,{...filters,fbf:'approved',commercial:'pending',sourceStatus:'status:agenda cyber'},rows,true)[0].number,'TEST-ONLY');
  assert.equal(filterAgendaRequests(requests,{...filters,fbf:'pending'},rows,false).length,0);
  assert.equal(displayDate('2026-10-15'),'15/10/2026');
});
test('malformed or duplicate approvals cannot be presented as confirmed',()=>{
  assert.throws(()=>parseValidations([row,row]));
  assert.throws(()=>parseValidations([{...row,approved:'true'}]));
  assert.throws(()=>parseValidations([{...row,kind:'unknown'}]));
});
test('unified tray and compact export have no separate problem tab',()=>{
  const board=readFileSync(new URL('../src/features/agenda/agenda-board.tsx',import.meta.url),'utf8');
  const exporter=readFileSync(new URL('../src/features/agenda/export-agendas-button.tsx',import.meta.url),'utf8');
  assert.ok(board.includes('visible.filter(request=>!request.fechaDefinitiva)'));
  assert.ok(!board.includes("setTray('problems')"));
  assert.ok(board.includes('Fecha sistema:'));
  assert.ok(!exporter.includes('Compartir detalle de agendas'));
});
test('compact validation checks keep accessible state and independent click actions',()=>{
  const component=readFileSync(new URL('../src/features/agenda/validation-context.tsx',import.meta.url),'utf8');
  assert.ok(component.includes('<Check aria-hidden="true"'));
  assert.ok(component.includes("approved?'text-green-600':'text-gray-400'"));
  assert.ok(component.includes(' /> {label}'));
  assert.ok(!component.includes("approved?' validado':' pendiente'"));
  assert.ok(component.includes('aria-pressed={approved}'));
  assert.ok(component.includes('aria-label='));
  assert.ok(component.includes('state.save(request.number,kind,!approved)'));
  assert.ok(component.includes('window.confirm('));
});
