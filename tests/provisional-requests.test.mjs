import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function compile(path) {
  return ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
}
const url=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const normalizationUrl=url(compile('../src/services/source-normalization.ts'));
const {mergeSourceRequests}=await import(normalizationUrl);
const snapshotCode=compile('../src/services/planner-snapshot.ts').replace("'./source-normalization'",JSON.stringify(normalizationUrl)).replace('"./source-normalization"',JSON.stringify(normalizationUrl));
const {parsePlannerSnapshot}=await import(url(snapshotCode));
const provisional={number:'TEST-PROVISIONAL',seller_id:'',seller:'Fixture seller',warehouse:'7002',units:80,planned_date:'2026-09-14',priority:'Alta',comment:'Fixture only',revision:'00000000-0000-4000-8000-000000000001',created_at:'2026-09-03T12:00:00Z',official:false};
const raw={creado:'03/09/2026',seller_id:'fixture-id',seller:'Fixture official',node_id:'7002',fecha_envio:'15/09/2026',estado:'Recibido',number:provisional.number,units:'100',fecha_ini:'14/09/2026',fecha_fin:'18/09/2026'};
const source={source_refreshed_at:'2026-09-03T12:00:00Z',received_at:'2026-09-03T12:01:00Z',row_count:1,rows:[{source:raw,present:true}]};

test('provisional works without first Sheets snapshot and consumes reserved capacity',()=>{
  const {requests}=parsePlannerSnapshot({source:null,provisionals:[provisional]});
  assert.equal(requests.length,1);
  assert.equal(requests[0].origin,'provisional');
  assert.equal(requests[0].fechaDefinitiva,'2026-09-14');
  assert.equal(requests.filter(r=>r.warehouse==='7002'&&r.fechaDefinitiva==='2026-09-14').reduce((sum,r)=>sum+r.units,0),80);
});
test('shared updates replace stale local provisional dates and units',()=>{
  const old=parsePlannerSnapshot({source:null,provisionals:[provisional]}).requests;
  const fresh=parsePlannerSnapshot({source:null,provisionals:[{...provisional,planned_date:'2026-09-16',units:120}]}).requests;
  const merged=mergeSourceRequests(old,fresh);
  assert.equal(merged[0].fechaDefinitiva,'2026-09-16');assert.equal(merged[0].units,120);
});
test('deletion removes cached provisional without retaining a phantom reservation',()=>{
  const old=parsePlannerSnapshot({source:null,provisionals:[provisional]}).requests;
  const fresh=parsePlannerSnapshot({source:null,provisionals:[]}).requests;
  assert.equal(mergeSourceRequests(old,fresh).length,0);
});
test('promotion yields one official row, original source values, preserved reservation date',()=>{
  const old=parsePlannerSnapshot({source:null,provisionals:[provisional]}).requests;
  const incoming=parsePlannerSnapshot({source,provisionals:[{...provisional,official:true}]}).requests;
  const merged=mergeSourceRequests(old,incoming);
  assert.equal(merged.length,1);assert.equal(merged[0].origin,'sheet');
  assert.equal(merged[0].units,100);assert.equal(merged[0].sellerName,'Fixture official');
  assert.equal(merged[0].fechaDefinitiva,provisional.planned_date);
  assert.equal(merged[0].priority,'Alta');assert.equal(merged[0].planningComment,provisional.comment);
  assert.deepEqual(merged[0].sourceRow,raw);
  assert.equal(merged[0].provisionalRevision,undefined);
  assert.equal(merged[0].promotedFromProvisional,true);
  assert.deepEqual(mergeSourceRequests(merged,incoming),merged);
});
test('subsequent official local rescheduling survives polling',()=>{
  const incoming=parsePlannerSnapshot({source,provisionals:[{...provisional,official:true}]}).requests;
  const old=[{...incoming[0],fechaDefinitiva:'2026-09-17',priority:'Media'}];
  const merged=mergeSourceRequests(old,incoming);
  assert.equal(merged[0].fechaDefinitiva,'2026-09-17');assert.equal(merged[0].priority,'Media');
});
test('never removes official/local records absent from a later snapshot',()=>{
  const old=parsePlannerSnapshot({source,provisionals:[]}).requests;
  assert.equal(mergeSourceRequests(old,[]).length,1);
  assert.equal(mergeSourceRequests(old,[])[0].sourceAbsent,true);
});
test('inconsistent conversion, duplicate and invalid provisional snapshots are rejected',()=>{
  assert.throws(()=>parsePlannerSnapshot({source,provisionals:[provisional]}));
  assert.throws(()=>parsePlannerSnapshot({source:null,provisionals:[{...provisional,official:true}]}));
  assert.throws(()=>parsePlannerSnapshot({source:null,provisionals:[provisional,provisional]}));
  assert.throws(()=>parsePlannerSnapshot({source:null,provisionals:[{...provisional,units:-1}]}));
  assert.throws(()=>parsePlannerSnapshot({source:null,provisionals:[{...provisional,planned_date:'2026-02-31'}]}));
  assert.throws(()=>parsePlannerSnapshot({source:null}));
});
