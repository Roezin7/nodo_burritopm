import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.env.APPLY_RECEIVABLE_RESTORE === '1';
const IMPORT_KEY = 'client-week32-three-week-receivables-v2';
const BILLING_29_Y_ANTERIORES = 91410.01;

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

const saldos = [
  { semana: 30, inicia: '2026-07-19', termina: '2026-07-25', total: 76885.52 },
  { semana: 31, inicia: '2026-07-26', termina: '2026-08-01', total: 89879.84 },
] as const;

async function main() {
  const negocio = await prisma.negocios.findFirstOrThrow({ where: { nombre: 'Burrito Parrilla Mexicana' } });
  const admin = await prisma.usuarios.findFirstOrThrow({
    where: { negocio_id: negocio.id, rol: 'admin', activo: true },
    orderBy: { id: 'asc' },
  });
  const empresa = await prisma.empresas_clientes.findFirstOrThrow({
    where: { negocio_id: negocio.id, codigo: 'BPM' },
  });
  const ubicacion = await prisma.ubicaciones.findFirstOrThrow({
    where: { negocio_id: negocio.id, codigo: 'LOMBA' },
  });

  console.log(JSON.stringify({ aplicar: APPLY, saldos, total: saldos.reduce((a, x) => a + x.total, 0) }));
  if (!APPLY) return;

  await prisma.$transaction(async (tx) => {
    const yaAplicado = await tx.importaciones_sistema.findUnique({
      where: { negocio_id_clave: { negocio_id: negocio.id, clave: IMPORT_KEY } },
    });
    if (yaAplicado) {
      console.log(`Importación ${IMPORT_KEY} ya aplicada; no se hicieron cambios.`);
      return;
    }

    for (const saldo of saldos) {
      // Se recupera solamente el documento financiero. La operación eliminada de
      // semanas 30 y 31 (pedidos, producción, compras y despachos) permanece vacía.
      const semana = await tx.semanas_operativas.upsert({
        where: { negocio_id_anio_semana: { negocio_id: negocio.id, anio: 2026, semana: saldo.semana } },
        update: { inicia_at: date(saldo.inicia), termina_at: date(saldo.termina), estado: 'cerrada' },
        create: {
          negocio_id: negocio.id,
          anio: 2026,
          semana: saldo.semana,
          inicia_at: date(saldo.inicia),
          termina_at: date(saldo.termina),
          estado: 'cerrada',
          cerrado_por: admin.id,
          cerrado_at: date(saldo.termina),
        },
      });
      const numero = `2026-${saldo.semana}-BPM-SALDO-OPEN`;
      const factura = await tx.facturas.upsert({
        where: { negocio_id_numero_version: { negocio_id: negocio.id, numero, version: 1 } },
        update: {
          semana_id: semana.id,
          empresa_cliente_id: empresa.id,
          ubicacion_id: ubicacion.id,
          linea_operacion: 'carne',
          emitida_at: date(saldo.termina),
          vence_at: date(saldo.termina),
          estado: 'emitida',
          subtotal: saldo.total,
          total: saldo.total,
        },
        create: {
          negocio_id: negocio.id,
          semana_id: semana.id,
          empresa_cliente_id: empresa.id,
          ubicacion_id: ubicacion.id,
          linea_operacion: 'carne',
          numero,
          emitida_at: date(saldo.termina),
          vence_at: date(saldo.termina),
          estado: 'emitida',
          subtotal: saldo.total,
          total: saldo.total,
        },
      });
      await tx.factura_lineas.deleteMany({ where: { factura_id: factura.id } });
      await tx.factura_lineas.create({
        data: {
          factura_id: factura.id,
          descripcion: `Saldo abierto de Billing ${saldo.semana} importado del cierre del cliente`,
          cantidad: 1,
          precio_unitario: saldo.total,
          importe: saldo.total,
        },
      });
    }

    const semana29 = await tx.semanas_operativas.findUniqueOrThrow({
      where: { negocio_id_anio_semana: { negocio_id: negocio.id, anio: 2026, semana: 29 } },
    });
    const documentos29 = await tx.facturas.findMany({
      where: { negocio_id: negocio.id, semana_id: semana29.id, estado: { in: ['emitida', 'pagada'] } },
      select: { total: true },
    });
    const facturado29 = documentos29.reduce((total, factura) => total + Number(factura.total), 0);
    const arrastre = Math.round((BILLING_29_Y_ANTERIORES - facturado29) * 100) / 100;
    if (arrastre < 0) throw new Error(`Billing 29 existente excede el libro del cliente por ${Math.abs(arrastre).toFixed(2)}`);
    if (arrastre > 0) {
      const numero = '2026-29-BPM-ARRASTRE-OPEN';
      const factura = await tx.facturas.upsert({
        where: { negocio_id_numero_version: { negocio_id: negocio.id, numero, version: 1 } },
        update: { subtotal: arrastre, total: arrastre, estado: 'emitida' },
        create: {
          negocio_id: negocio.id,
          semana_id: semana29.id,
          empresa_cliente_id: empresa.id,
          ubicacion_id: ubicacion.id,
          linea_operacion: 'carne',
          numero,
          emitida_at: date('2026-07-18'),
          vence_at: date('2026-08-01'),
          estado: 'emitida',
          subtotal: arrastre,
          total: arrastre,
        },
      });
      await tx.factura_lineas.deleteMany({ where: { factura_id: factura.id } });
      await tx.factura_lineas.create({
        data: { factura_id: factura.id, descripcion: 'Saldo anterior incluido en Billing 29', cantidad: 1, precio_unitario: arrastre, importe: arrastre },
      });
    }

    const carteraInicial = Math.round((BILLING_29_Y_ANTERIORES + saldos.reduce((a, x) => a + x.total, 0)) * 100) / 100;
    const semana32 = await tx.semanas_operativas.findUniqueOrThrow({
      where: { negocio_id_anio_semana: { negocio_id: negocio.id, anio: 2026, semana: 32 } },
    });
    const balance = Math.round((Number(semana32.valor_carne) + Number(semana32.valor_congelado)
      + Number(semana32.valor_desechables) + carteraInicial - Number(semana32.cuentas_por_pagar)) * 100) / 100;
    await tx.semanas_operativas.update({
      where: { id: semana32.id },
      data: { cuentas_por_cobrar: carteraInicial, balance_neto: balance },
    });

    await tx.importaciones_sistema.create({ data: { negocio_id: negocio.id, clave: IMPORT_KEY } });
    await tx.auditoria_operativa.create({
      data: {
        negocio_id: negocio.id,
        usuario_id: admin.id,
        accion: 'restaurar_cartera_tres_semanas',
        entidad: 'facturas',
        datos: { fuente: 'Inventarios.xlsx / Inv Billing (32)', billing_29_y_anteriores: BILLING_29_Y_ANTERIORES, saldos },
      },
    });
  }, { timeout: 30_000 });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
