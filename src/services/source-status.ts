import type { AgendaRequest } from '@/src/types/planning';

export function sourceStatusLabel(request: AgendaRequest): string {
  if (request.origin === 'provisional') return 'Provisoria (sin formulario)';
  return request.estadoFuente.trim() || 'Sin estado';
}

export function sourceStatusKey(request: AgendaRequest): string {
  if (request.origin === 'provisional') return 'provisional';
  const status = request.estadoFuente.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
  return status ? `status:${status}` : 'missing';
}

export function matchesSourceStatus(request: AgendaRequest, selected: string): boolean {
  return selected === 'all' || sourceStatusKey(request) === selected;
}

export function sourceStatusOptions(requests: AgendaRequest[]) {
  const options = new Map<string, string>();
  for (const request of requests) options.set(sourceStatusKey(request), sourceStatusLabel(request));
  return [...options].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'es'));
}
