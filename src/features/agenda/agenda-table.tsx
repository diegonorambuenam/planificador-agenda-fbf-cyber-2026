'use client';
import { useState } from 'react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import type { AgendaRequest } from '@/src/types/planning';
import { sourceStatusLabel } from '@/src/services/source-status';
import { displayDate } from '@/src/services/agenda-filters';
import { ValidationChecks } from './validation-context';
import { RequestDetails } from './request-details';

export function AgendaTable({requests}: {requests:AgendaRequest[]}) {
  const [page,setPage]=useState(0);
  const last=Math.max(0,Math.ceil(requests.length/50)-1);
  const current=Math.min(page,last);
  const visible=requests.slice(current*50,current*50+50);
  return <section className="overflow-hidden rounded-xl border border-[#d7e0da] bg-white">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3 text-sm"><p>{requests.length} solicitudes · incluye con y sin fecha planificada</p><div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={current===0} onClick={()=>setPage(current-1)}>Anterior</Button><span>{current+1} / {last+1}</span><Button size="sm" variant="outline" disabled={current===last} onClick={()=>setPage(current+1)}>Siguiente</Button></div></div>
    <Table><TableHeader><TableRow>{['Number','Seller','Bodega','Unidades','Validación FBF','Validación comercial','Estado sistema','Fecha sistema','Fecha planificada FBF','Detalle'].map(title=><TableHead key={title}>{title}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{visible.map((request,index)=><TableRow key={`${request.number}-${index}`} className={request.validationMessages.length || request.sourceAbsent?'bg-amber-50/50':''}>
        <TableCell className="font-bold">{request.number||'Sin number'}{request.origin==='provisional'&&<p className="text-xs font-normal text-amber-800">Provisoria</p>}</TableCell>
        <TableCell className="max-w-56 whitespace-normal break-words">{request.sellerName||'Sin seller'}<p className="text-xs text-[#607168]">{request.sellerId}</p></TableCell>
        <TableCell>{request.warehouse||'Sin bodega'}</TableCell><TableCell>{request.unitsMissing?'Sin informar':request.units.toLocaleString('es-CL')}</TableCell>
        <TableCell><ValidationChecks request={request} only="fbf"/></TableCell><TableCell><ValidationChecks request={request} only="commercial"/></TableCell><TableCell className="max-w-44 whitespace-normal">{sourceStatusLabel(request)}</TableCell>
        <TableCell>{displayDate(request.fechaEnvioOriginal)}</TableCell><TableCell>{request.fechaDefinitiva?displayDate(request.fechaDefinitiva):'Sin asignar'}</TableCell>
        <TableCell className="max-w-64 whitespace-normal">{request.validationMessages.length>0&&<p className="text-xs text-amber-800">⚠ {request.validationMessages[0]}</p>}<RequestDetails request={request}/></TableCell>
      </TableRow>)}{!visible.length&&<TableRow><TableCell colSpan={10} className="py-10 text-center">No hay solicitudes con estos filtros.</TableCell></TableRow>}</TableBody>
    </Table>
  </section>;
}
