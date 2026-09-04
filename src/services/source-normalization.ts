import type { AgendaRequest, WarehouseId } from '@/src/types/planning';

export const SOURCE_COLUMNS = ['creado', 'seller_id', 'seller', 'node_id', 'fecha_envio', 'estado', 'number', 'units', 'fecha_ini', 'fecha_fin'] as const;
export type RawRow = Record<string, unknown>;
const text = (value: unknown) => value == null ? '' : String(value).trim();

export function sourceDate(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  }
  const raw = text(value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[ T])/);
  const local = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:$|\s)/);
  if (!iso && !local) return '';
  const [year,month,day] = iso ? [+iso[1],+iso[2],+iso[3]] : [+local![3],+local![2],+local![1]];
  const date = new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year && date.getUTCMonth()===month-1 && date.getUTCDate()===day
    ? `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}` : '';
}

export function sourceUnits(value: unknown): number {
  if (typeof value === 'number') return value;
  const raw = text(value);
  if (!raw) return NaN;
  // Source sheet uses es-CL display values: dots group thousands, comma is decimal.
  if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(raw)) return NaN;
  return Number(raw.replace(/\./g,'').replace(',','.'));
}

export function normalizeRows(rows: RawRow[]): AgendaRequest[] {
  const counts = new Map<string, number>();
  for (const row of rows) { const n=text(row.number); if(n) counts.set(n,(counts.get(n)??0)+1); }
  return rows.map(row => {
    const number=text(row.number), warehouse=text(row.node_id), units=sourceUnits(row.units);
    const start=sourceDate(row.fecha_ini), end=sourceDate(row.fecha_fin), shipping=sourceDate(row.fecha_envio);
    const errors: string[] = [], warnings: string[] = [];
    if (!number) errors.push('Falta number');
    if (!warehouse) errors.push('Falta warehouse');
    else if (!['9006','7002'].includes(warehouse)) errors.push('Warehouse pendiente');
    if (!Number.isFinite(units)||units<=0) errors.push('Unidades faltantes o inválidas');
    if (!text(row.seller_id)||!text(row.seller)) errors.push('Información de seller incompleta');
    if (!start) errors.push('Fecha inicio inválida o faltante');
    if (!end) errors.push('Fecha fin inválida o faltante');
    if(start&&end&&end<start) errors.push('Fecha fin anterior a fecha inicio');
    if((counts.get(number)??0)>1) errors.push('Number duplicado pendiente de revisión');
    if(!shipping) warnings.push('Fecha de envío faltante o inválida; revisar fuente');
    else if(shipping<'2026-09-01'||shipping>'2026-10-31') warnings.push('Fecha de envío fuera del horizonte Cyber (referencia conservada)');
    return {
      number,sellerId:text(row.seller_id),sellerName:text(row.seller),
      warehouse:(['9006','7002'].includes(warehouse)?warehouse:'') as WarehouseId|'',
      units:Number.isFinite(units)&&units>0?units:0, unitsMissing:!Number.isFinite(units)||units<=0,
      fechaCreacion:text(row.creado),fechaEnvioOriginal:shipping,fechaInicio:start,fechaFin:end,
      estadoFuente:text(row.estado),fechaDefinitiva:null,planningStatus:errors.length?'Con problema':'Pendiente',
      priority:'Normal',planningComment:'',validationStatus:errors.length?'error':warnings.length?'warning':'valid',
      validationMessages:[...errors,...warnings],sourceRow:{...row},
    };
  });
}

// Exact identities from the original bundled fixture, never a broad DEMO prefix.
const bundledDemoIdentities: Record<string, [string, string]> = {
  'DEMO-9006-001': ['DEMO001', 'Seller Demo Norte'],
  'DEMO-9006-002': ['DEMO002', 'Seller Demo Centro'],
  'DEMO-9006-003': ['DEMO003', 'Seller Demo Sur'],
  'DEMO-7002-001': ['DEMO004', 'Seller Demo Hogar'],
  'DEMO-7002-002': ['DEMO005', 'Seller Demo Tecno'],
  'DEMO-7002-003': ['DEMO006', 'Seller Demo Deportes'],
  'DEMO-9006-004': ['DEMO001', 'Seller Demo Norte'],
  'DEMO-9006-005': ['DEMO007', 'Seller Demo Moda'],
  'DEMO-7002-004': ['DEMO008', 'Seller Demo Muebles'],
  'DEMO-PROBLEM-001': ['DEMO009', 'Seller Demo Accesorios'],
  'DEMO-PROBLEM-002': ['DEMO010', 'Seller Demo Outdoor'],
  'DEMO-PROBLEM-003': ['DEMO011', 'Seller Demo Kids'],
};

function isBundledDemo(row: AgendaRequest): boolean {
  const identity = bundledDemoIdentities[row.number];
  return !!identity && row.sellerId === identity[0] && row.sellerName === identity[1];
}

export function mergeSourceRequests(current: AgendaRequest[], incoming: AgendaRequest[]): AgendaRequest[] {
  const previous = new Map(current.map(row=>[row.number,row]));
  const seen = new Set<string>();
  const merged = incoming.map(row => {
    seen.add(row.number);
    const old=previous.get(row.number);
    if(!old) return row;
    return {...row,fechaDefinitiva:old.fechaDefinitiva,priority:old.priority,planningComment:old.planningComment,
      planningStatus:old.fechaDefinitiva || old.planningStatus==='Rechazado' ? old.planningStatus : row.planningStatus};
  });
  // User-approved cleanup: only known local demos absent from the source are removed.
  // All incoming rows and other absent/local records remain untouched.
  for(const old of current) if(!seen.has(old.number) && !isBundledDemo(old)) merged.push({...old,sourceAbsent:true,
    validationStatus:old.validationStatus==='error'?'error':'warning',
    validationMessages:[...new Set([...old.validationMessages,'No está en la última extracción; registro conservado'])]});
  return merged;
}
