import { PrismaClient } from '@prisma/client';

/**
 * Reconstruye fotografías históricas ausentes usando el snapshot posterior más
 * cercano y revirtiendo los movimientos del ledger entre ambos cierres.
 * No usa el saldo vivo ni inventa compras; deja bitácora explícita de la fuente.
 */
const prisma = new PrismaClient();
const BUSINESS_NAME = process.env.BPM_REPAIR_NEGOCIO ?? 'Burrito Parrilla Mexicana';
const APPLY = process.env.BPM_REPAIR_APPLY === '1';
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const n = (v: unknown) => Number(v ?? 0) || 0;
const targets = [
  { week: 26, source: 27 },
  { week: 30, source: 32 },
  { week: 31, source: 32 },
];

async function main() {
  if (!APPLY) throw new Error('Reparación protegida: define BPM_REPAIR_APPLY=1 de forma explícita.');
  const result = await prisma.$transaction(async (tx) => {
    const negocio = await tx.negocios.findFirstOrThrow({ where: { nombre: BUSINESS_NAME } });
    const admin = await tx.usuarios.findFirstOrThrow({ where: { negocio_id: negocio.id, rol: 'admin', activo: true }, orderBy: { id: 'asc' }, select: { id: true } });
    const cambios: Record<string, unknown>[] = [];

    for (const target of targets) {
      const key = `snapshot-reconstruido-ledger-2026-${target.week}-v1`;
      if (await tx.importaciones_sistema.findUnique({ where: { negocio_id_clave: { negocio_id: negocio.id, clave: key } } })) continue;
      const [semana, fuente] = await Promise.all([
        tx.semanas_operativas.findFirstOrThrow({ where: { negocio_id: negocio.id, anio: 2026, semana: target.week, estado: 'cerrada' }, select: { id: true, inicia_at: true, termina_at: true } }),
        tx.semanas_operativas.findFirstOrThrow({ where: { negocio_id: negocio.id, anio: 2026, semana: target.source, estado: 'cerrada' }, select: { id: true, termina_at: true } }),
      ]);
      const base = await tx.inventario_semanal.findMany({ where: { semana_id: fuente.id } });
      if (!base.length) throw new Error(`La semana fuente ${target.source} no tiene snapshot.`);
      const saldos = new Map<string, { negocio_id: bigint; ubicacion_id: bigint; product_id: bigint; disponible: number; costo: number | null; peso: number | null; costoTotal: number | null }>();
      for (const fila of base) saldos.set(`${fila.ubicacion_id}:${fila.product_id}`, { negocio_id: negocio.id, ubicacion_id: fila.ubicacion_id, product_id: fila.product_id, disponible: n(fila.cantidad_disponible) - n(fila.cantidad_faltante), costo: fila.costo_promedio == null ? null : n(fila.costo_promedio), peso: fila.peso_total_lb == null ? null : n(fila.peso_total_lb), costoTotal: fila.costo_total == null ? null : n(fila.costo_total) });

      const movimientos = await tx.movimientos_inventario.findMany({ where: { negocio_id: negocio.id, fecha: { gt: semana.termina_at, lte: fuente.termina_at } }, orderBy: [{ fecha: 'asc' }, { id: 'asc' }] });
      for (const movimiento of movimientos) {
        const cantidad = n(movimiento.cantidad);
        if (cantidad <= 0) continue;
        const keyOrigen = movimiento.ubicacion_origen_id == null ? null : `${movimiento.ubicacion_origen_id}:${movimiento.product_id}`;
        const keyDestino = movimiento.ubicacion_destino_id == null ? null : `${movimiento.ubicacion_destino_id}:${movimiento.product_id}`;
        if (keyOrigen && !saldos.has(keyOrigen)) saldos.set(keyOrigen, { negocio_id: negocio.id, ubicacion_id: movimiento.ubicacion_origen_id!, product_id: movimiento.product_id, disponible: 0, costo: movimiento.costo_unitario == null ? null : n(movimiento.costo_unitario), peso: null, costoTotal: null });
        if (keyDestino && !saldos.has(keyDestino)) saldos.set(keyDestino, { negocio_id: negocio.id, ubicacion_id: movimiento.ubicacion_destino_id!, product_id: movimiento.product_id, disponible: 0, costo: movimiento.costo_unitario == null ? null : n(movimiento.costo_unitario), peso: null, costoTotal: null });
        // Para una fotografía anterior se revierte el efecto del movimiento.
        // recepción: tránsito de bodega -> sucursal; carga directa: disponible BOD -> sucursal.
        const esRecepcion = movimiento.idempotency_key.startsWith('recepcion:');
        if (keyOrigen) {
          const saldo = saldos.get(keyOrigen)!;
          saldo.disponible = r3(saldo.disponible + cantidad);
          if (esRecepcion) saldo.disponible = r3(saldo.disponible - cantidad);
        }
        if (keyDestino) {
          const saldo = saldos.get(keyDestino)!;
          saldo.disponible = r3(saldo.disponible - cantidad);
        }
      }

      await tx.inventario_semanal.deleteMany({ where: { semana_id: semana.id } });
      await tx.inventario_semanal.createMany({ data: [...saldos.values()].map((saldo) => {
        const faltante = Math.max(0, r3(-saldo.disponible));
        const disponible = Math.max(0, r3(saldo.disponible));
        const costo = saldo.costo;
        return { semana_id: semana.id, negocio_id: negocio.id, ubicacion_id: saldo.ubicacion_id, product_id: saldo.product_id, cantidad_disponible: disponible, cantidad_faltante: faltante, cantidad_reservada: 0, cantidad_transito: 0, costo_promedio: costo, costo_transito_promedio: null, peso_total_lb: saldo.peso, costo_total: saldo.costoTotal ?? (costo == null ? null : r2(disponible * costo)) };
      }) });
      await tx.importaciones_sistema.create({ data: { negocio_id: negocio.id, clave: key } });
      cambios.push({ semana: target.week, fuente: target.source, renglones: saldos.size, movimientos_revertidos: movimientos.length });
    }
    if (cambios.length) await tx.auditoria_operativa.create({ data: { negocio_id: negocio.id, usuario_id: admin.id, accion: 'reconstruir_snapshots_historicos_desde_ledger', entidad: 'inventario_semanal', datos: { cambios, regla: 'snapshot posterior menos movimientos posteriores' } } });
    return cambios;
  }, { timeout: 120000, maxWait: 10000 });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
