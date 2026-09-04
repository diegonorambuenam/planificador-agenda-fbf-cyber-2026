import type { AgendaRequest } from '@/src/types/planning';
import { matchesSourceStatus } from './source-status';
import { isValidated, type ValidationMap } from './preagenda-validation';
export interface AgendaFilters { search: string; sourceStatus: string; fbf: string; commercial: string; planned: string }
export function filterAgendaRequests(requests: AgendaRequest[], filters: AgendaFilters, validations: ValidationMap, ready: boolean) {
  const query = filters.search.trim().toLocaleLowerCase('es');
  return requests.filter(request => {
    if (!matchesSourceStatus(request, filters.sourceStatus)) return false;
    if (query && ![request.number, request.sellerId, request.sellerName].some(value => value.toLocaleLowerCase('es').includes(query))) return false;
    if (filters.planned === 'assigned' && !request.fechaDefinitiva) return false;
    if (filters.planned === 'pending' && request.fechaDefinitiva) return false;
    for (const kind of ['fbf','commercial'] as const) {
      if (filters[kind] === 'all') continue;
      if (!ready || isValidated(validations, request.number, kind) !== (filters[kind] === 'approved')) return false;
    }
    return true;
  });
}
export const displayDate = (date: string | null | undefined) => date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.split('-').reverse().join('/') : date || 'Sin fecha';
