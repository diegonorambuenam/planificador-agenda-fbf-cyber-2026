'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AgendaRequest } from '@/src/types/planning';
import { downloadAgendas } from '@/src/services/agenda-export';

export function ExportAgendasButton({ requests }: { requests: AgendaRequest[] }) {
  const [error, setError] = useState('');
  const count = requests.filter(row => row.fechaDefinitiva).length;
  return <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#d7e0da] bg-white px-4 py-3">
    <div><p className="text-sm font-semibold">Compartir detalle de agendas</p><p className="text-xs text-[#607168]">{count} con fecha asignada · ambas bodegas · todas las semanas · incluye provisorias</p><p className="text-xs text-[#607168]">Exporta la planificación de este navegador y los datos originales. Compártelo solo por canales autorizados.</p>{error && <p role="alert" className="mt-1 text-sm text-red-700">{error}</p>}</div>
    <Button disabled={!count} onClick={() => { setError(''); try { downloadAgendas(requests); } catch { setError('No se pudo generar el Excel. Intenta nuevamente.'); } }}><Download /> Exportar agendas</Button>
  </div>;
}
