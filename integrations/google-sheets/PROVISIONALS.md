# Provisorias compartidas

Aplicar `004_provisional_requests.sql` después de 003, antes de publicar el frontend.
No requiere cambiar Apps Script, claves ni activadores.

- El equipo autenticado crea reservas por `number` único, seller, warehouse, unidades y fecha; ID seller es opcional.
- Solo los RPC de provisorias pueden escribir su tabla. Cada llamada valida la pertenencia activa al equipo. No hay acceso directo de anon/authenticated a las tablas de provisorias o solicitudes.
- La fecha, prioridad y comentario de una provisoria son compartidos. Se editan desde la vista Provisorias; arrastrar tarjetas, herramientas locales y reiniciar planificación no modifican estas reservas.
- Los borrados son lógicos (`deleted_at`): dejan de ocupar capacidad y desaparecen de todos los clientes tras consultar la copia. Un administrador puede recuperar datos desde Supabase. Nunca se elimina una fila de `source_requests`.
- Crear/editar/borrar utiliza el mismo bloqueo transaccional de evento que la ingesta de Sheets. Si el number ya figura en el historial de la fuente, incluso `source_present=false`, no admite operaciones de provisoria.
- Una revisión UUID impide sobrescribir cambios de otro integrante y también detecta borrado seguido de recreación. Los errores de red no se presentan como éxito; consultar antes de reintentar.
- El snapshot combina ambas fuentes sin duplicar numbers. Cuando llega una solicitud oficial, los datos de Sheets prevalecen y la reserva compartida se usa como fecha/prioridad/comentario inicial. Desde entonces no se puede borrar como provisoria.
- Las ediciones posteriores de la agenda oficial siguen siendo locales, como antes. No se anuncia disponibilidad global de agendas oficiales; la advertencia de capacidad suma las reservas compartidas y la agenda local visible, permite sobrecupo con confirmación, y no es un límite global obligatorio.
- El cliente consulta cada 15 segundos y tras operaciones. Ante fallo no elimina la última copia. La promoción y eliminación se confirman en servidor antes de reflejarse.

Pruebas: `node --test tests/source-integration.test.mjs tests/provisional-requests.test.mjs`.
Validar también permisos y CRUD/promotion en PostgreSQL antes de publicar; las pruebas de cliente no sustituyen la prueba de servidor.
