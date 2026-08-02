import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.env.APPLY_WEEK32_PAPERWARE_FIX === '1';
const IMPORT_KEY = 'client-week32-paperware-hold-v2';
const PAPERWARE_CIERRE = 249601.88;
// El libro conserva medios centavos en Billing 29 y 30. La suma subyacente de
// cartera es 258,175.36 aunque los tres renglones mostrados redondeen a .37.
const CARTERA_CIERRE = 258175.36;

const holds = [
  { producto: 'TORTA - 8X6 32oz', cantidad: 600, valor: 17250 },
  { producto: 'FOIL STD 12X1000', cantidad: 486, valor: 11639.70 },
  // Billing (hoja rectora del cierre) deja $3,204.89 de Thermal Paper dentro
  // del saldo contable. La hoja operativa de desechables contiene $3,595.50.
  { producto: 'THERMAL PAPER ROLL 3 1/8"', cantidad: 90, valor: 3204.89 },
] as const;

async function main() {
  const valorHold = holds.reduce((total, hold) => total + hold.valor, 0);
  console.log(JSON.stringify({ aplicar: APPLY, paperware: PAPERWARE_CIERRE, valor_hold: valorHold, holds }));
  if (!APPLY) return;

  await prisma.$transaction(async (tx) => {
    const negocio = await tx.negocios.findFirstOrThrow({ where: { nombre: 'Burrito Parrilla Mexicana' } });
    const yaAplicado = await tx.importaciones_sistema.findUnique({
      where: { negocio_id_clave: { negocio_id: negocio.id, clave: IMPORT_KEY } },
    });
    if (yaAplicado) {
      console.log(`Importación ${IMPORT_KEY} ya aplicada; no se hicieron cambios.`);
      return;
    }
    const [admin, bodega, semana32] = await Promise.all([
      tx.usuarios.findFirstOrThrow({ where: { negocio_id: negocio.id, rol: 'admin', activo: true }, orderBy: { id: 'asc' } }),
      tx.ubicaciones.findFirstOrThrow({ where: { negocio_id: negocio.id, codigo: 'BOD' } }),
      tx.semanas_operativas.findUniqueOrThrow({
        where: { negocio_id_anio_semana: { negocio_id: negocio.id, anio: 2026, semana: 32 } },
      }),
    ]);

    for (const hold of holds) {
      const producto = await tx.products.findFirstOrThrow({
        where: { negocio_id: negocio.id, nombre: { equals: hold.producto, mode: 'insensitive' } },
      });
      await tx.existencias.update({
        where: { ubicacion_id_product_id: { ubicacion_id: bodega.id, product_id: producto.id } },
        data: {
          cantidad_transito: hold.cantidad,
          costo_transito_promedio: hold.valor / hold.cantidad,
        },
      });
    }

    const balance = Math.round((Number(semana32.valor_carne) + Number(semana32.valor_congelado)
      + PAPERWARE_CIERRE + CARTERA_CIERRE - Number(semana32.cuentas_por_pagar)) * 100) / 100;
    await tx.semanas_operativas.update({
      where: { id: semana32.id },
      data: { valor_desechables: PAPERWARE_CIERRE, cuentas_por_cobrar: CARTERA_CIERRE, balance_neto: balance },
    });
    await tx.importaciones_sistema.create({ data: { negocio_id: negocio.id, clave: IMPORT_KEY } });
    await tx.auditoria_operativa.create({
      data: {
        negocio_id: negocio.id,
        usuario_id: admin.id,
        accion: 'corregir_paperware_apertura_semana_32',
        entidad: 'semana_operativa',
        entidad_id: semana32.id,
        datos: {
          fuente: 'Inventarios.xlsx / Inv Billing (32)!BZ5',
          valor_anterior: Number(semana32.valor_desechables),
          valor_corregido: PAPERWARE_CIERRE,
          holds,
          balance,
        },
      },
    });
  }, { timeout: 30_000 });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
