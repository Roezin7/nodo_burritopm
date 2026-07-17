import ExcelJS from 'exceljs';
import { prisma } from '../db.js';
import { num0 } from '../lib/num.js';
import { HttpError } from '../middleware/error.js';

export type TipoExcel = 'weekly-order' | 'disposables' | 'production' | 'billing' | 'lbt' | 'aurora';
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dinero = '$#,##0.00';

function preparar(ws: ExcelJS.Worksheet, titulo: string, subtitulo: string) {
  ws.views = [{ state: 'frozen', ySplit: 3 }];
  ws.mergeCells('A1:H1');
  ws.getCell('A1').value = titulo;
  ws.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF29292E' } };
  ws.getCell('A2').value = subtitulo;
  ws.getRow(3).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F8EF1' } };
  ws.properties.defaultRowHeight = 19;
}

function ajustar(ws: ExcelJS.Worksheet) {
  ws.columns.forEach((c) => {
    let max = 10;
    c.eachCell?.({ includeEmpty: false }, (cell) => { max = Math.min(42, Math.max(max, String(cell.value ?? '').length + 2)); });
    c.width = max;
  });
  ws.eachRow((row, n) => {
    if (n > 3 && n % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F5F7' } };
  });
}

async function datos(negocioId: bigint, semanaId: bigint) {
  const semana = await prisma.semanas_operativas.findFirst({
    where: { id: semanaId, negocio_id: negocioId },
    include: { facturas: { where: { estado: { not: 'anulada' } }, include: { empresa: true, ubicacion: true, lineas: true } } },
  });
  if (!semana) throw new HttpError(404, 'Semana no encontrada');
  const [pedidos, compras, producciones, existencias] = await Promise.all([
    prisma.pedidos_operativos.findMany({
      where: { negocio_id: negocioId, fecha_entrega: { gte: semana.inicia_at, lte: semana.termina_at }, estado: { not: 'cancelado' } },
      include: { ubicacion: true, lineas: { include: { producto: true } } }, orderBy: [{ fecha_entrega: 'asc' }, { ubicacion: { nombre: 'asc' } }],
    }),
    prisma.compras.findMany({ where: { negocio_id: negocioId, fecha: { gte: semana.inicia_at, lte: semana.termina_at } }, include: { proveedor: true, lineas: { include: { producto: true } } }, orderBy: { fecha: 'asc' } }),
    prisma.producciones.findMany({ where: { negocio_id: negocioId, fecha: { gte: semana.inicia_at, lte: semana.termina_at } }, include: { materia_prima: true, salidas: { include: { producto: true } } }, orderBy: { fecha: 'asc' } }),
    prisma.existencias.findMany({ where: { negocio_id: negocioId }, include: { products: true, ubicaciones: true } }),
  ]);
  return { semana, pedidos, compras, producciones, existencias };
}

function hojaFactura(wb: ExcelJS.Workbook, factura: Awaited<ReturnType<typeof datos>>['semana']['facturas'][number]) {
  const nombre = factura.ubicacion.nombre.replace(/[\\/*?:[\]]/g, '').slice(0, 28) || 'Factura';
  const ws = wb.addWorksheet(nombre);
  ws.mergeCells('A1:E1');
  ws.getCell('A1').value = 'M&G Management and Logistics Inc.';
  ws.getCell('A1').font = { size: 16, bold: true };
  ws.getCell('A2').value = factura.empresa.nombre;
  ws.getCell('A3').value = factura.ubicacion.nombre;
  ws.getCell('D1').value = 'Statement Date:';
  ws.getCell('E1').value = iso(factura.emitida_at);
  ws.getCell('D2').value = 'Due Date:';
  ws.getCell('E2').value = iso(factura.vence_at);
  ws.getCell('D3').value = 'Invoice #';
  ws.getCell('E3').value = factura.numero;
  ws.addRow([]);
  const head = ws.addRow(['DATE', 'DESCRIPTION', 'UNIT PRICE', 'QUANTITY', 'AMOUNT']);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF29292E' } };
  for (const l of factura.lineas) {
    const row = ws.addRow([iso(factura.emitida_at), l.descripcion, num0(l.precio_unitario), num0(l.cantidad), num0(l.importe)]);
    row.getCell(3).numFmt = dinero; row.getCell(5).numFmt = dinero;
  }
  const total = ws.addRow(['', 'Invoice Total', '', '', num0(factura.total)]);
  total.font = { bold: true }; total.getCell(5).numFmt = dinero;
  ws.columns = [{ width: 14 }, { width: 34 }, { width: 14 }, { width: 12 }, { width: 15 }];
  ws.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1, paperSize: 9 };
}

export async function generarExcel(negocioId: bigint, semanaId: bigint, tipo: TipoExcel) {
  const d = await datos(negocioId, semanaId);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NODO · Burrito Parrilla Mexicana';
  wb.created = new Date();
  const etiqueta = `Week (${d.semana.semana}) · ${iso(d.semana.inicia_at)} a ${iso(d.semana.termina_at)}`;

  if (tipo === 'weekly-order') {
    const ws = wb.addWorksheet(`Meat Order (${d.semana.semana})`);
    preparar(ws, 'M&G · WEEKLY MEAT ORDER', etiqueta);
    ws.getRow(3).values = ['DELIVERY DATE', 'LOCATION', 'PRODUCT', 'QTY', 'UNIT PRICE', 'AMOUNT', 'STATUS', 'PHYSICAL DROP'];
    for (const p of d.pedidos.filter((x) => x.linea_operacion === 'carne')) {
      for (const l of p.lineas) {
        const row = ws.addRow([iso(p.fecha_entrega), p.ubicacion.nombre, l.producto.nombre, num0(l.cantidad), num0(l.precio_unitario), num0(l.cantidad) * num0(l.precio_unitario), p.estado, p.ubicacion.entrega_en_ubicacion_id ? 'Aurora' : p.ubicacion.nombre]);
        row.getCell(5).numFmt = dinero; row.getCell(6).numFmt = dinero;
      }
    }
    ajustar(ws);
  } else if (tipo === 'disposables') {
    const ws = wb.addWorksheet(`Week (${d.semana.semana})`);
    preparar(ws, 'DISPOSABLES', etiqueta);
    ws.getRow(3).values = ['DESCRIPTION', 'COST', 'SELLING PRICE', 'LOCATION', 'ORDER', 'EXTENDED', 'FINAL INVENTORY', 'INVENTORY COST'];
    const pedidos = d.pedidos.filter((x) => x.linea_operacion === 'desechables');
    for (const p of pedidos) for (const l of p.lineas) {
      const ex = d.existencias.find((e) => e.product_id === l.product_id && e.products.linea_operacion === 'desechables');
      const costo = Number(l.producto.ultimo_costo ?? l.producto.costo_promedio ?? 0);
      const precio = Number(l.producto.precio_venta_fijo ?? l.precio_unitario ?? 0);
      const row = ws.addRow([l.producto.nombre, costo, precio, p.ubicacion.nombre, num0(l.cantidad), num0(l.cantidad) * precio, num0(ex?.cantidad_disponible), num0(ex?.cantidad_disponible) * num0(ex?.costo_promedio)]);
      [2, 3, 6, 8].forEach((c) => { row.getCell(c).numFmt = dinero; });
    }
    ajustar(ws);
  } else if (tipo === 'production') {
    const ws = wb.addWorksheet(`Production (${d.semana.semana})`);
    preparar(ws, 'M&G · PRODUCTION', etiqueta);
    ws.getRow(3).values = ['DATE', 'RAW MATERIAL', 'INPUT CASES', 'INPUT WEIGHT', 'INPUT COST', 'OUTPUT', 'OUTPUT CASES', 'CASE COST', 'SELLING PRICE', 'YIELD', 'WASTE LB'];
    for (const p of d.producciones) for (const s of p.salidas) {
      const row = ws.addRow([iso(p.fecha), p.materia_prima.nombre, num0(p.cajas_materia_prima), num0(p.peso_entrada_lb), num0(p.costo_entrada), s.producto.nombre, num0(s.cajas), num0(s.costo_caja), num0(s.precio_venta_caja), num0(p.yield_porcentaje) / 100, num0(p.desperdicio_lb)]);
      [5, 8, 9].forEach((c) => { row.getCell(c).numFmt = dinero; }); row.getCell(10).numFmt = '0.00%';
    }
    ws.addRow([]); ws.addRow(['PURCHASES']);
    for (const c of d.compras) for (const l of c.lineas) ws.addRow([iso(c.fecha), l.producto.nombre, num0(l.cajas), num0(l.peso_total_lb), num0(l.costo_total), c.proveedor.nombre, l.congelado ? 'FROZEN' : 'FRESH', c.estado]);
    ajustar(ws);
  } else if (tipo === 'billing') {
    const ws = wb.addWorksheet(`Billing (${d.semana.semana})`);
    preparar(ws, 'M&G · BILLING', etiqueta);
    ws.getRow(3).values = ['COMPANY', 'LOCATION', 'LINE', 'INVOICE', 'PRODUCT', 'QTY', 'UNIT PRICE', 'AMOUNT'];
    for (const f of d.semana.facturas) for (const l of f.lineas) {
      const row = ws.addRow([f.empresa.nombre, f.ubicacion.nombre, f.linea_operacion, f.numero, l.descripcion, num0(l.cantidad), num0(l.precio_unitario), num0(l.importe)]);
      row.getCell(7).numFmt = dinero; row.getCell(8).numFmt = dinero;
    }
    ws.addRow([]); ws.addRow(['FRESH MEAT INVENTORY', num0(d.semana.valor_carne)]).getCell(2).numFmt = dinero;
    ws.addRow(['FROZEN INVENTORY', num0(d.semana.valor_congelado)]).getCell(2).numFmt = dinero;
    ws.addRow(['PAPERWARE INVENTORY', num0(d.semana.valor_desechables)]).getCell(2).numFmt = dinero;
    ws.addRow(['ACCOUNTS RECEIVABLE', num0(d.semana.cuentas_por_cobrar)]).getCell(2).numFmt = dinero;
    ws.addRow(['ACCOUNTS PAYABLE', -num0(d.semana.cuentas_por_pagar)]).getCell(2).numFmt = dinero;
    ws.addRow(['CLOSING BALANCE', num0(d.semana.balance_neto)]).getCell(2).numFmt = dinero;
    ajustar(ws);
  } else {
    const empresaCodigo = tipo === 'lbt' ? 'LBT' : 'AURORA';
    const facturas = d.semana.facturas.filter((f) => f.empresa.codigo === empresaCodigo);
    if (!facturas.length) {
      const ws = wb.addWorksheet(`Week (${d.semana.semana})`);
      ws.addRow([`No invoices for ${empresaCodigo} in this week`]);
    } else facturas.forEach((f) => hojaFactura(wb, f));
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
