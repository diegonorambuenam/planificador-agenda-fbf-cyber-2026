import { addDays, format, startOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import type { AgendaRequest, WarehouseId } from '@/src/types/planning';
import { capacityKey } from '@/src/store/planning-store';

export const numberFormat = new Intl.NumberFormat('es-CL');
export const percentageFormat = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });

export function weekDays(anchor: Date, includeWeekend = false) {
  const monday = startOfWeek(anchor, { weekStartsOn: 1 });
  return Array.from({ length: includeWeekend ? 7 : 5 }, (_, index) => {
    const date = addDays(monday, index);
    return { date: format(date, 'yyyy-MM-dd'), day: format(date, 'EEE', { locale: es }).replace('.', ''), label: format(date, 'd MMM', { locale: es }) };
  });
}

export function isWithinWindow(request: AgendaRequest, date: string) {
  return Boolean(request.fechaInicio && request.fechaFin && date >= request.fechaInicio && date <= request.fechaFin);
}

export function selectedRequests(requests: AgendaRequest[], warehouse: WarehouseId) {
  return requests.filter((request) => request.warehouse === warehouse);
}

export function usedOnDate(requests: AgendaRequest[], warehouse: WarehouseId, date: string) {
  return requests.filter((request) => request.warehouse === warehouse && request.fechaDefinitiva === date).reduce((sum, request) => sum + request.units, 0);
}

export function dayMetrics(requests: AgendaRequest[], capacities: Record<string, number>, warehouse: WarehouseId, date: string) {
  const assigned = requests.filter((request) => request.warehouse === warehouse && request.fechaDefinitiva === date);
  const used = assigned.reduce((sum, request) => sum + request.units, 0);
  const capacity = capacities[capacityKey(warehouse, date)] ?? null;
  return {
    assigned,
    used,
    capacity,
    available: capacity == null ? null : capacity - used,
    utilization: capacity == null || capacity === 0 ? null : (used / capacity) * 100,
    sellers: new Set(assigned.map((request) => request.sellerId)).size,
  };
}
