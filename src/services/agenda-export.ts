import * as XLSX from 'xlsx';
import type { AgendaRequest } from '@/src/types/planning';

export function sourceValue(value: unknown): string | number | boolean {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  return JSON.stringify(value);
}

export function requestOrigin(request: AgendaRequest): string {
  return request.origin === 'provisional' ? 'Provisoria' : request.origin === 'sheet' ? 'Formulario' : 'Importación local';
}

function excelDate(value: string | null): Date | string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value ?? '';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : value;
}

export function createAgendaWorkbook(requests: AgendaRequest[], exportedAt = new Date()) {
  const scheduled = requests.filter(row => row.fechaDefinitiva).slice().sort((a, b) =>
    a.fechaDefinitiva!.localeCompare(b.fechaDefinitiva!) || a.warehouse.localeCompare(b.warehouse) || a.number.localeCompare(b.number));
  if (!scheduled.length) throw new Error('No hay agendas con fecha asignada para exportar.');
  const header = ['Fecha asignada', 'Bodega', 'Number', 'Seller ID', 'Seller', 'Unidades', 'Origen', 'Estado de agenda', 'Prioridad', 'Comentario', 'Fecha de envío original', 'Inicio de ventana', 'Fin de ventana', 'Estado del formulario', 'Validación', 'Alertas', 'Ausente de última extracción'];
  const rows = scheduled.map(row => [excelDate(row.fechaDefinitiva), row.warehouse, row.number, row.sellerId, row.sellerName,
    row.unitsMissing || !Number.isFinite(row.units) ? '' : row.units, requestOrigin(row), row.planningStatus, row.priority, row.planningComment,
    excelDate(row.fechaEnvioOriginal), excelDate(row.fechaInicio), excelDate(row.fechaFin), row.estadoFuente,
    row.validationStatus === 'error' ? 'Con problema' : row.validationStatus === 'warning' ? 'Con advertencia' : 'Sin alertas',
    row.validationMessages.join('\n'), row.sourceAbsent ? 'Sí' : 'No']);
  const workbook = XLSX.utils.book_new();
  const agenda = XLSX.utils.aoa_to_sheet([header, ...rows], { dateNF: 'yyyy-mm-dd' });
  agenda['!autofilter'] = { ref: agenda['!ref']! };
  agenda['!cols'] = header.map((_, index) => ({ wch: [4, 9, 15].includes(index) ? 45 : 24 }));
  XLSX.utils.book_append_sheet(workbook, agenda, 'Agendas');

  // Preserve every original column, including fields unknown to the planner.
  // AOA strings stay text (never formulas), including identifiers and '=' prefixes.
  const columns = [...new Set(scheduled.flatMap(row => Object.keys(row.sourceRow ?? {})))];
  const source = XLSX.utils.aoa_to_sheet([
    ['Number de agenda', 'Origen de agenda', ...columns.map(key => `Origen: ${key}`)],
    ...scheduled.map(row => [row.number, requestOrigin(row), ...columns.map(key => sourceValue(row.sourceRow?.[key]))]),
  ]);
  source['!autofilter'] = { ref: source['!ref']! };
  source['!cols'] = [{ wch: 24 }, { wch: 24 }, ...columns.map(() => ({ wch: 32 }))];
  XLSX.utils.book_append_sheet(workbook, source, 'Datos de origen');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Detalle', 'Valor'],
    ['Exportado el (UTC)', exportedAt.toISOString()],
    ['Alcance', 'Todas las solicitudes con fecha asignada, ambas bodegas y todas las semanas. Incluye provisorias y solicitudes con alertas.'],
    ['Cantidad de agendas', scheduled.length],
    ['Planificación', 'Copia de lo cargado en este navegador al exportar. Las ediciones posteriores de fechas y prioridades oficiales son locales.'],
    ['Datos de origen', 'Valores de la última copia disponible, sin modificar la hoja de Google Sheets. Las provisorias no tienen fila de formulario.'],
    ['Privacidad', 'Archivo para compartir por los canales autorizados del equipo. Puede contener información de sellers.'],
  ]), 'Información');
  workbook.Sheets['Información']['!cols'] = [{ wch: 28 }, { wch: 100 }];
  return workbook;
}

export function downloadAgendas(requests: AgendaRequest[]) {
  const now = new Date();
  XLSX.writeFile(createAgendaWorkbook(requests, now), `agendas-fbf-${now.toISOString().replace(/[:.]/g, '-')}.xlsx`, { compression: true });
}
