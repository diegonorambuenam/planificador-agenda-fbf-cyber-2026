import type { AgendaRequest } from '@/src/types/planning';
import { sourceDate } from './source-normalization';
import { isValidated, type ValidationMap } from './preagenda-validation';
export type TableSort = 'number'|'sellerName'|'warehouse'|'units'|'priority'|'fbf'|'commercial'|'estadoFuente'|'fechaEnvioOriginal'|'fechaDefinitiva'|'fechaCreacion'|'planningUpdatedAt'|'planningUpdatedBy';
export interface TableFilters {priority:string;createdFrom:string;createdTo:string;plannedFrom:string;plannedTo:string}
export const emptyTableFilters:TableFilters={priority:'all',createdFrom:'',createdTo:'',plannedFrom:'',plannedTo:''};
// Source wall-clock time, without interpreting DD/MM as MM/DD.
export function sourceDateTimeKey(value:string):string {
  const day=sourceDate(value);
  if(!day) return '';
  const time=value.match(/[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if(!time) return day;
  if(+time[1]>23||+time[2]>59||+(time[3]??0)>59) return '';
  return `${day}T${time[1]}:${time[2]}:${time[3]??'00'}`;
}
export function filterTableRequests(rows:AgendaRequest[], filters:TableFilters) {
  return rows.filter(row=>{
    if(filters.priority!=='all'&&row.priority!==filters.priority) return false;
    const created=row.origin==='provisional'?'':sourceDate(row.fechaCreacion);
    if((filters.createdFrom||filters.createdTo)&&!created) return false;
    if(filters.createdFrom&&created<filters.createdFrom||filters.createdTo&&created>filters.createdTo) return false;
    const planned=row.fechaDefinitiva;
    if((filters.plannedFrom||filters.plannedTo)&&!planned) return false;
    if(planned && ((filters.plannedFrom && planned<filters.plannedFrom) || (filters.plannedTo && planned>filters.plannedTo))) return false;
    return true;
  });
}
export function sortTableRequests(rows:AgendaRequest[], key:TableSort, descending:boolean, validations:ValidationMap, ready:boolean) {
  const collator=new Intl.Collator('es',{numeric:true,sensitivity:'base'});
  function value(row:AgendaRequest):string|number|null {
    if(key==='fbf'||key==='commercial') return ready?Number(isValidated(validations,row.number,key)):null;
    if(key==='units') return row.unitsMissing?null:row.units;
    if(key==='priority') return {Normal:0,Media:1,Alta:2}[row.priority];
    if(key==='fechaCreacion') return row.origin==='provisional'?null:sourceDateTimeKey(row.fechaCreacion)||null;
    if(key==='planningUpdatedAt') return row.planningUpdatedAt?Date.parse(row.planningUpdatedAt):null;
    return row[key]||null;
  }
  return rows.slice().sort((a,b)=>{
    const av=value(a),bv=value(b);
    if(av===null||bv===null) return av===bv?collator.compare(a.number,b.number):av===null?1:-1;
    const result=typeof av==='number'&&typeof bv==='number'?av-bv:collator.compare(String(av),String(bv));
    return (descending?-result:result)||collator.compare(a.number,b.number);
  });
}
