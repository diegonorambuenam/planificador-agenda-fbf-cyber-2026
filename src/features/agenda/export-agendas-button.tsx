'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AgendaRequest } from '@/src/types/planning';
import { downloadAgendas } from '@/src/services/agenda-export';
import { useValidations } from './validation-context';

export function ExportAgendasButton({ requests }: { requests: AgendaRequest[] }) {
  const [error, setError] = useState('');
  const validations = useValidations();
  const count = requests.filter(row => row.fechaDefinitiva).length;
  return <div className="relative shrink-0">
    <Button title={`${count} agendas · todas las semanas y bodegas, sin aplicar filtros. Incluye datos originales: compartir solo por canales autorizados.`} disabled={!count} onClick={() => { setError(''); try { downloadAgendas(requests, validations.ready ? validations.rows : undefined); } catch { setError('No se pudo generar el Excel. Intenta nuevamente.'); } }}><Download /> Exportar agendas</Button>
    {error && <p role="alert" className="absolute right-0 top-full z-10 mt-1 w-64 rounded border bg-white p-2 text-sm text-red-700">{error}</p>}
  </div>;
}
