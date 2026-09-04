'use client';

import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { AgendaRequest } from '@/src/types/planning';
import { requestOrigin, sourceValue } from '@/src/services/agenda-export';

export function RequestDetails({ request }: { request: AgendaRequest }) {
  const fields = Object.entries(request.sourceRow ?? {});
  const summary = [
    ['Origen', requestOrigin(request)], ['Bodega', request.warehouse || 'Sin bodega'],
    ['Seller', request.sellerName || 'Sin nombre'], ['Fecha asignada', request.fechaDefinitiva || 'Sin asignar'],
    ['Unidades', request.unitsMissing ? 'Sin informar' : String(request.units)], ['Prioridad', request.priority],
    ['Estado de agenda', request.planningStatus], ['Comentario', request.planningComment || 'Sin comentario'],
  ];
  return <div onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="sm" className="mt-2 h-auto w-full whitespace-normal py-1 text-[#356548]" />}>
        <Info size={14} /> Más información
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Solicitud {request.number || 'sin number'}</DialogTitle>
          <DialogDescription>Planificación actual y datos de la última copia recibida. Información de solo lectura.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-1 gap-3 rounded-xl bg-[#f0f5f1] p-4 sm:grid-cols-2">
          {summary.map(([label, value]) => <div key={label}><dt className="text-xs font-bold text-[#607168]">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{value}</dd></div>)}
        </dl>
        {(request.validationMessages.length > 0 || request.sourceAbsent) && <section className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <h3 className="font-bold">Alertas</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5">{request.validationMessages.map((message, index) => <li key={index}>{message}</li>)}{request.sourceAbsent && <li>No está presente en la última extracción. Se muestra la copia conservada.</li>}</ul>
        </section>}
        <section>
          <h3 className="mb-2 font-bold">{request.origin === 'sheet' ? 'Datos originales de Google Sheets' : 'Datos originales'}</h3>
          {fields.length ? <Table className="table-fixed">
            <TableHeader><TableRow><TableHead className="w-1/3">Campo original</TableHead><TableHead>Valor</TableHead></TableRow></TableHeader>
            <TableBody>{fields.map(([key, value]) => <TableRow key={key}>
              <TableCell className="whitespace-normal break-words align-top font-semibold">{key}</TableCell>
              <TableCell className="whitespace-pre-wrap break-words align-top">{value == null || value === '' ? <span className="text-[#65756c]">Sin dato</span> : String(sourceValue(value))}</TableCell>
            </TableRow>)}</TableBody>
          </Table> : <p className="text-sm text-[#607168]">{request.origin === 'provisional' ? 'Esta es una agenda provisoria: todavía no tiene datos del formulario.' : 'Esta solicitud no tiene una fila de origen disponible.'}</p>}
        </section>
        <DialogClose render={<Button variant="outline" className="justify-self-end" />}>Cerrar</DialogClose>
      </DialogContent>
    </Dialog>
  </div>;
}
