import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../src/services/source-normalization.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { normalizeRows, mergeSourceRequests, sourceDate, sourceUnits } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const row = {creado:'03/09/2026 12:00:00',seller_id:'fixture-id',seller:'Fixture',node_id:'7002',fecha_envio:'04/12/2026',estado:'Pendiente',number:'TEST-1',units:'1.250',fecha_ini:'07/09/2026',fecha_fin:'10/09/2026'};

test('Spanish dates and units are unambiguous; invalid and missing remain invalid', () => {
  assert.equal(sourceDate('04/12/2026'), '2026-12-04');
  assert.equal(sourceDate('31/02/2026'), '');
  assert.equal(sourceDate('2026-09-07'), '2026-09-07');
  assert.equal(sourceUnits('1.250'),1250);
  assert.equal(sourceUnits('1.250,5'),1250.5);
  assert.ok(Number.isNaN(sourceUnits('')));
});
test('keeps all incomplete rows, original values and out-of-horizon reference', () => {
  const input=[row,{...row,number:'TEST-2',units:'',node_id:'',seller:''}];
  const result=normalizeRows(input);
  assert.equal(result.length,2);
  assert.equal(result[0].fechaEnvioOriginal,'2026-12-04');
  assert.equal(result[0].validationStatus,'warning');
  assert.deepEqual(result[1].sourceRow,input[1]);
  assert.equal(result[1].unitsMissing,true);
  assert.equal(result[1].validationStatus,'error');
});
test('merges changed source without losing manual decisions or absent rows', () => {
  const [old]=normalizeRows([row]);
  Object.assign(old,{fechaDefinitiva:'2026-09-09',priority:'Alta',planningComment:'Manual fixture',planningStatus:'Agendado'});
  const [absent]=normalizeRows([{...row,number:'OLD'}]);
  const fresh=normalizeRows([{...row,units:'2000'}]);
  const merged=mergeSourceRequests([old,absent],fresh);
  assert.equal(merged[0].units,2000);
  for(const field of ['fechaDefinitiva','priority','planningComment','planningStatus']) assert.equal(merged[0][field],old[field]);
  assert.equal(merged[1].sourceAbsent,true);
  assert.equal(mergeSourceRequests(merged,fresh)[1].validationMessages.length,merged[1].validationMessages.length);
  assert.equal(mergeSourceRequests(merged,normalizeRows([row,{...row,number:'OLD'}]))[1].sourceAbsent,undefined);
});

const script=readFileSync(new URL('../integrations/google-sheets/Code.gs',import.meta.url),'utf8');
function harness(options={}) {
  const calls=[]; const now=new Date();
  const props={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLIC_KEY:'public-fixture',FBF_SYNC_KEY:'a'.repeat(64),SOURCE_SHEET_ID:'1',...options.props};
  const status={getExecutionState:()=>options.running?'RUNNING':'SUCCESS',isTruncated:()=>!!options.truncated,getLastRefreshedTime:()=>options.stale?new Date(0):now};
  const table={getStatus:()=>status,getRowLimit:()=>25000,getRange:()=>({getNumRows:()=>2,getNumColumns:()=>10,getDisplayValues:()=>[Object.keys(row),...((options.rows??[row]).map(r=>Object.keys(row).map(k=>r[k])))]})};
  const properties={getProperties:()=>({...props}),setProperties:v=>Object.assign(props,v),setProperty:(k,v)=>props[k]=v};
  const ctx=vm.createContext({Date,LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},PropertiesService:{getScriptProperties:()=>properties},SpreadsheetApp:{DataExecutionState:{SUCCESS:'SUCCESS'},getActiveSpreadsheet:()=>({getSheets:()=>[{getSheetId:()=>1,getDataSourceTables:()=>[table]}]})},Utilities:{newBlob:p=>({getBytes:()=>Buffer.from(p)})},UrlFetchApp:{fetch:(url,config)=>{calls.push({url,config});return {getResponseCode:()=>options.http??200,getContentText:()=>JSON.stringify({ok:true,rows:1})};}}});
  vm.runInContext(script,ctx);
  return {run:()=>vm.runInContext('sincronizarSolicitudes()',ctx),props,calls};
}
test('script sends raw rows once and only marks successful delivery', () => {
  const h=harness();h.run();h.run();
  assert.equal(h.calls.length,1);
  assert.deepEqual(JSON.parse(h.calls[0].config.payload).p_rows,[row]);
  assert.ok(h.props.LAST_SUCCESS_AT);
  assert.equal(h.calls[0].config.followRedirects,false);
});
for(const [name,options] of Object.entries({running:{running:true},truncated:{truncated:true},stale:{stale:true},empty:{rows:[]},duplicates:{rows:[row,row]},missingKey:{props:{FBF_SYNC_KEY:''}}})) {
  test(`script rejects ${name} without transmitting`,()=>{const h=harness(options);assert.throws(h.run);assert.equal(h.calls.length,0);assert.equal(h.props.LAST_SUCCESS_AT,undefined);});
}
test('failed HTTP keeps last-success marker untouched',()=>{const h=harness({http:403});assert.throws(h.run);assert.equal(h.props.LAST_SUCCESS_AT,undefined);assert.ok(h.props.LAST_ERROR);});
