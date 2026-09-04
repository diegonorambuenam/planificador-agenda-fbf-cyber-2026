import type { AgendaRequest } from '@/src/types/planning';

export function canMoveRequest(request: AgendaRequest): boolean {
  // A stable number is required to update exactly one request.
  return Boolean(request.number.trim()) && request.origin !== 'provisional';
}

export function movementAlerts(request: AgendaRequest): string[] {
  const alerts = [...request.validationMessages];
  if (request.validationStatus === 'error' && !alerts.length) alerts.push('Esta solicitud tiene problemas en sus datos de origen.');
  if (request.sourceAbsent) alerts.push('Esta solicitud no está presente en la última actualización del formulario.');
  if (request.unitsMissing) alerts.push('Las unidades no están informadas: la ocupación calculada puede quedar incompleta.');
  return [...new Set(alerts)];
}
