import { normalizeRows, SOURCE_COLUMNS, sourceDate, type RawRow } from './source-normalization';
import type { AgendaRequest, Priority, WarehouseId } from '@/src/types/planning';

export interface ProvisionalRow {
  number: string; seller_id: string; seller: string; warehouse: WarehouseId;
  units: number; planned_date: string; priority: Priority; comment: string;
  revision: string; created_at: string; official: boolean;
}
interface SourceSnapshot {
  source_refreshed_at: string; received_at: string; row_count: number;
  rows: { source: RawRow; present: boolean }[];
}

export function parsePlannerSnapshot(data: unknown) {
  const value = data as {source: SourceSnapshot|null; provisionals: ProvisionalRow[]};
  if (!value || !('source' in value) || !Array.isArray(value.provisionals)) throw new Error('Invalid snapshot');
  const source=value.source;
  if (source && (!Array.isArray(source.rows) || !Number.isInteger(source.row_count) || source.row_count<1 ||
    !Number.isFinite(Date.parse(source.source_refreshed_at)) || !Number.isFinite(Date.parse(source.received_at)) ||
    source.rows.some(r=>!r || typeof r.present!=='boolean' || !r.source || typeof r.source!=='object' || SOURCE_COLUMNS.some(k=>!(k in r.source)) || typeof r.source.number!=='string' || !r.source.number.trim()) ||
    source.rows.filter(r=>r.present).length!==source.row_count || new Set(source.rows.map(r=>String(r.source.number).trim())).size!==source.rows.length)) throw new Error('Invalid source snapshot');
  const provisionals=value.provisionals;
  if(provisionals.some(p=>!p || typeof p.number!=='string' || !p.number.trim() || typeof p.seller!=='string' || !p.seller.trim() || typeof p.seller_id!=='string' ||
    !['7002','9006'].includes(p.warehouse) || !Number.isInteger(p.units) || p.units<=0 || p.units>1e9 ||
    typeof p.planned_date!=='string' || sourceDate(p.planned_date)!==p.planned_date || !['Normal','Media','Alta'].includes(p.priority) || typeof p.comment!=='string' ||
    typeof p.revision!=='string' || !/^[a-f0-9-]{36}$/i.test(p.revision) || typeof p.official!=='boolean') ||
    new Set(provisionals.map(p=>p.number)).size!==provisionals.length) throw new Error('Invalid provisional snapshot');
  const reservations=new Map(provisionals.map(p=>[p.number,p]));
  const requests=normalizeRows(source?.rows.map(r=>r.source)??[]);
  const officialNumbers=new Set(requests.map(r=>r.number));
  if(provisionals.some(p=>p.official!==officialNumbers.has(p.number))) throw new Error('Inconsistent snapshot');
  requests.forEach((request,index)=>{
    request.origin='sheet';
    const reservation=reservations.get(request.number);
    if(reservation) {
      request.fechaDefinitiva=reservation.planned_date;
      request.priority=reservation.priority;
      request.planningComment=reservation.comment;
      request.planningStatus='Agendado';
      request.promotedFromProvisional=true;
    }
    if(!source!.rows[index].present) {
      request.sourceAbsent=true;
      if(request.validationStatus!=='error') request.validationStatus='warning';
      request.validationMessages.push('No está en la última extracción; registro conservado');
    }
  });
  for(const p of provisionals) if(!p.official) requests.push({
    origin:'provisional',provisionalRevision:p.revision,number:p.number,sellerId:p.seller_id,sellerName:p.seller,
    warehouse:p.warehouse,units:p.units,fechaCreacion:p.created_at,fechaEnvioOriginal:'',fechaInicio:p.planned_date,fechaFin:p.planned_date,
    estadoFuente:'Provisoria',fechaDefinitiva:p.planned_date,planningStatus:'Agendado',priority:p.priority,planningComment:p.comment,
    validationStatus:'valid',validationMessages:[],
  } satisfies AgendaRequest);
  return {requests,source};
}
