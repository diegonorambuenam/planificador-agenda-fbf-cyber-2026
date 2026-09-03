import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { AgendaRequest, WarehouseId } from '@/src/types/planning';

export const SOURCE_COLUMNS = ['creado', 'seller_id', 'seller', 'node_id', 'fecha_envio', 'estado', 'number', 'units', 'fecha_ini', 'fecha_fin'] as const;
type RawRow = Record<string, unknown>;

function text(value: unknown) {
  return value == null ? '' : String(value).trim();
}

function isoDate(value: unknown) {
  const raw = text(value);
  if (!raw) return '';
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

export function normalizeRows(rows: RawRow[]): AgendaRequest[] {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const number = text(row.number);
    if (number) counts.set(number, (counts.get(number) ?? 0) + 1);
  });

  return rows.map((row) => {
    const number = text(row.number);
    const warehouseRaw = text(row.node_id);
    const unitsRaw = text(row.units).replace(/\./g, '').replace(',', '.');
    const units = Number(unitsRaw);
    const start = isoDate(row.fecha_ini);
    const end = isoDate(row.fecha_fin);
    const shipping = isoDate(row.fecha_envio);
    const messages: string[] = [];

    if (!number) messages.push('Falta number');
    if (!warehouseRaw) messages.push('Falta warehouse');
    else if (warehouseRaw !== '9006' && warehouseRaw !== '7002') messages.push('Warehouse pendiente');
    if (!Number.isFinite(units) || units <= 0) messages.push('Unidades faltantes o inválidas');
    if (!start) messages.push('Fecha inicio inválida o faltante');
    if (!end) messages.push('Fecha fin inválida o faltante');
    if (start && end && end < start) messages.push('Fecha fin anterior a fecha inicio');
    if (counts.get(number) && counts.get(number)! > 1) messages.push('Number duplicado pendiente de revisión');
    if (shipping && (shipping < '2026-09-01' || shipping > '2026-10-31')) messages.push('Fecha de envío fuera del horizonte Cyber');

    const hardError = messages.some((message) =>
      ['Falta number', 'Falta warehouse', 'Warehouse pendiente', 'Unidades faltantes o inválidas', 'Fecha inicio inválida o faltante', 'Fecha fin inválida o faltante', 'Fecha fin anterior a fecha inicio', 'Number duplicado pendiente de revisión'].includes(message),
    );

    return {
      number,
      sellerId: text(row.seller_id),
      sellerName: text(row.seller),
      warehouse: (warehouseRaw === '9006' || warehouseRaw === '7002' ? warehouseRaw : '') as WarehouseId | '',
      units: Number.isFinite(units) ? units : 0,
      fechaCreacion: text(row.creado),
      fechaEnvioOriginal: shipping,
      fechaInicio: start,
      fechaFin: end,
      estadoFuente: text(row.estado),
      fechaDefinitiva: null,
      planningStatus: hardError ? 'Con problema' : 'Pendiente',
      priority: 'Normal',
      planningComment: '',
      validationStatus: hardError ? 'error' : messages.length ? 'warning' : 'valid',
      validationMessages: messages,
    } satisfies AgendaRequest;
  });
}

export async function parseAgendaFile(file: File): Promise<AgendaRequest[]> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'csv') {
    const csv = await file.text();
    const parsed = Papa.parse<RawRow>(csv, { header: true, skipEmptyLines: true, transformHeader: (header) => header.trim().toLowerCase() });
    if (parsed.errors.length && !parsed.data.length) throw new Error(parsed.errors[0].message);
    return normalizeRows(parsed.data);
  }
  if (extension === 'xlsx' || extension === 'xls') {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return normalizeRows(XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: '' }));
  }
  throw new Error('Formato no compatible. Usa CSV o XLSX.');
}

export async function loadBundledSample(): Promise<AgendaRequest[]> {
  const response = await fetch('sample-agenda.csv');
  if (!response.ok) throw new Error('No fue posible cargar la muestra inicial');
  const parsed = Papa.parse<RawRow>(await response.text(), { header: true, skipEmptyLines: true });
  return normalizeRows(parsed.data);
}
