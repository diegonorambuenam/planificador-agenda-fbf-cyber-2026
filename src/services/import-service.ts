import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { AgendaRequest } from '@/src/types/planning';

import { normalizeRows, type RawRow } from './source-normalization';
export { normalizeRows, SOURCE_COLUMNS } from './source-normalization';

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
