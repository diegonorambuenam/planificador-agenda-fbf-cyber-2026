export type WarehouseId = '9006' | '7002';
export type PlanningStatus = 'Pendiente' | 'Agendado' | 'Reprogramado' | 'Rechazado' | 'Con problema';
export type Priority = 'Normal' | 'Media' | 'Alta';

export interface AgendaRequest {
  number: string;
  sellerId: string;
  sellerName: string;
  warehouse: WarehouseId | '';
  units: number;
  unitsMissing?: boolean;
  sourceRow?: Record<string, unknown>;
  sourceAbsent?: boolean;
  fechaCreacion: string;
  fechaEnvioOriginal: string;
  fechaInicio: string;
  fechaFin: string;
  estadoFuente: string;
  fechaDefinitiva: string | null;
  planningStatus: PlanningStatus;
  priority: Priority;
  planningComment: string;
  validationStatus: 'valid' | 'warning' | 'error';
  validationMessages: string[];
}

export interface DailyCapacity {
  warehouse: WarehouseId;
  date: string;
  capacity: number | null;
  scheduledUnits: number;
  availableUnits: number | null;
  utilization: number | null;
}

export interface ScheduleAssignment {
  number: string;
  warehouse: WarehouseId;
  originalDate: string;
  assignedDate: string;
  units: number;
  timestamp: string;
}

export interface ChangeLog {
  timestamp: string;
  number: string;
  action: string;
  previousValue: string | null;
  newValue: string | null;
}

export interface EventConfig {
  name: string;
  cyberStart: string;
  cyberEnd: string;
  planningStart: string;
  planningEnd: string;
}

export const WAREHOUSES: Record<WarehouseId, string> = {
  '9006': 'Mini Ticket',
  '7002': 'Big Ticket',
};
