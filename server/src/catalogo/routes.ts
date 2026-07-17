import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { num, num0 } from '../lib/num.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';

export const catalogoRouter = Router();

const idParam = z.coerce.number().int().positive();

// ───────────────────────────── Categorías ──────────────────────────────────

/** GET /catalogo/categorias — todas (incluye inactivas) para gestión. */
catalogoRouter.get(
  '/categorias',
  requireAuth,
  asyncHandler(async (req, res) => {
    const cats = await prisma.categorias.findMany({
      where: { negocio_id: req.auth!.negocioId },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    });
    res.json(cats.map((c) => ({ id: Number(c.id), nombre: c.nombre, orden: c.orden, activo: c.activo })));
  }),
);

catalogoRouter.post(
  '/categorias',
  requireAuth,
  soloAdmin,
  asyncHandler(async (req, res) => {
    const b = z.object({ nombre: z.string().min(1), orden: z.coerce.number().int().optional() }).parse(req.body);
    const dup = await prisma.categorias.findFirst({ where: { negocio_id: req.auth!.negocioId, nombre: b.nombre.trim() } });
    if (dup) throw new HttpError(409, 'Ya existe una categoría con ese nombre');
    const c = await prisma.categorias.create({
      data: { negocio_id: req.auth!.negocioId, nombre: b.nombre.trim(), orden: b.orden ?? 0 },
    });
    res.status(201).json({ id: Number(c.id) });
  }),
);

catalogoRouter.patch(
  '/categorias/:id',
  requireAuth,
  soloAdmin,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    const b = z
      .object({ nombre: z.string().min(1).optional(), orden: z.coerce.number().int().optional(), activo: z.boolean().optional() })
      .parse(req.body);
    const cat = await prisma.categorias.findFirst({ where: { id, negocio_id: req.auth!.negocioId } });
    if (!cat) throw new HttpError(404, 'Categoría no encontrada');
    await prisma.categorias.update({ where: { id }, data: { nombre: b.nombre?.trim(), orden: b.orden, activo: b.activo } });
    res.json({ ok: true });
  }),
);

// ────────────────────────────── Unidades ───────────────────────────────────

catalogoRouter.get(
  '/unidades',
  requireAuth,
  asyncHandler(async (req, res) => {
    const us = await prisma.unidades.findMany({
      where: { negocio_id: req.auth!.negocioId },
      orderBy: { nombre: 'asc' },
    });
    res.json(us.map((u) => ({ id: Number(u.id), nombre: u.nombre, activo: u.activo })));
  }),
);

catalogoRouter.post(
  '/unidades',
  requireAuth,
  soloAdmin,
  asyncHandler(async (req, res) => {
    const b = z.object({ nombre: z.string().min(1) }).parse(req.body);
    const dup = await prisma.unidades.findFirst({ where: { negocio_id: req.auth!.negocioId, nombre: b.nombre.trim() } });
    if (dup) throw new HttpError(409, 'Ya existe una unidad con ese nombre');
    const u = await prisma.unidades.create({ data: { negocio_id: req.auth!.negocioId, nombre: b.nombre.trim() } });
    res.status(201).json({ id: Number(u.id) });
  }),
);

catalogoRouter.patch(
  '/unidades/:id',
  requireAuth,
  soloAdmin,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    const b = z.object({ nombre: z.string().min(1).optional(), activo: z.boolean().optional() }).parse(req.body);
    const u = await prisma.unidades.findFirst({ where: { id, negocio_id: req.auth!.negocioId } });
    if (!u) throw new HttpError(404, 'Unidad no encontrada');
    await prisma.unidades.update({ where: { id }, data: { nombre: b.nombre?.trim(), activo: b.activo } });
    res.json({ ok: true });
  }),
);

// ────────────────────────────── Productos ──────────────────────────────────

type ProductoConRel = NonNullable<Awaited<ReturnType<typeof findProducto>>>;
function findProducto(id: bigint, negocioId: bigint) {
  return prisma.products.findFirst({
    where: { id, negocio_id: negocioId },
    include: { categorias: true, unidad_distribucion: true, unidad_compra: true, unidad_almacen: true },
  });
}

function productoDTO(p: ProductoConRel) {
  return {
    id: Number(p.id),
    nombre: p.nombre,
    sku: p.sku,
    codigo_barras: p.codigo_barras,
    categoria_id: p.categoria_id ? Number(p.categoria_id) : null,
    categoria: p.categorias?.nombre ?? null,
    unidad_distribucion_id: Number(p.unidad_distribucion_id),
    unidad_distribucion: p.unidad_distribucion.nombre,
    unidad_compra_id: p.unidad_compra_id ? Number(p.unidad_compra_id) : null,
    unidad_almacen_id: p.unidad_almacen_id ? Number(p.unidad_almacen_id) : null,
    factor_compra_almacen: num(p.factor_compra_almacen),
    factor_almacen_distribucion: num(p.factor_almacen_distribucion),
    costo_promedio: num(p.costo_promedio),
    ultimo_costo: num(p.ultimo_costo),
    administrado_bodega: p.administrado_bodega,
    requiere_refrigeracion: p.requiere_refrigeracion,
    stock_min_bodega: num(p.stock_min_bodega),
    stock_seguridad_bodega: num(p.stock_seguridad_bodega),
    lead_time_dias: p.lead_time_dias,
    linea_operacion: p.linea_operacion,
    tipo_operativo: p.tipo_operativo,
    precio_venta_fijo: num(p.precio_venta_fijo),
    markup_caja: num0(p.markup_caja),
    peso_caja_lb: num(p.peso_caja_lb),
    orden_operativo: p.orden_operativo,
    produccion_dias: p.produccion_dias,
    activo: p.activo,
  };
}

catalogoRouter.get(
  '/productos',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ps = await prisma.products.findMany({
      where: { negocio_id: req.auth!.negocioId },
      include: { categorias: true, unidad_distribucion: true, unidad_compra: true, unidad_almacen: true },
      orderBy: [{ activo: 'desc' }, { linea_operacion: 'asc' }, { orden_operativo: 'asc' }, { nombre: 'asc' }],
    });
    res.json(ps.map(productoDTO));
  }),
);

const productoSchema = z.object({
  nombre: z.string().min(1),
  sku: z.string().min(1).max(40),
  codigo_barras: z.string().optional().nullable(),
  categoria_id: z.coerce.number().int().positive().optional().nullable(),
  unidad_distribucion_id: z.coerce.number().int().positive(),
  unidad_compra_id: z.coerce.number().int().positive().optional().nullable(),
  unidad_almacen_id: z.coerce.number().int().positive().optional().nullable(),
  factor_compra_almacen: z.coerce.number().positive().optional(),
  factor_almacen_distribucion: z.coerce.number().positive().optional(),
  ultimo_costo: z.coerce.number().nonnegative().optional().nullable(),
  costo_promedio: z.coerce.number().nonnegative().optional().nullable(),
  administrado_bodega: z.boolean().optional(),
  requiere_refrigeracion: z.boolean().optional(),
  stock_min_bodega: z.coerce.number().nonnegative().optional().nullable(),
  stock_seguridad_bodega: z.coerce.number().nonnegative().optional().nullable(),
  lead_time_dias: z.coerce.number().int().nonnegative().optional().nullable(),
  linea_operacion: z.enum(['carne', 'desechables']).optional().nullable(),
  tipo_operativo: z.enum(['desechable', 'materia_prima', 'proteina', 'precio_fijo', 'servicio']).optional().nullable(),
  precio_venta_fijo: z.coerce.number().nonnegative().optional().nullable(),
  markup_caja: z.coerce.number().nonnegative().optional(),
  peso_caja_lb: z.coerce.number().positive().optional().nullable(),
  produccion_dias: z.array(z.coerce.number().int().min(0).max(6)).max(7).optional(),
  orden_operativo: z.coerce.number().int().nonnegative().optional(),
});

/** Valida que categoría y unidades referidas pertenezcan al negocio. */
async function validarRefs(negocioId: bigint, b: z.infer<typeof productoSchema>) {
  const unidadIds = [b.unidad_distribucion_id, b.unidad_compra_id, b.unidad_almacen_id].filter(
    (x): x is number => typeof x === 'number',
  );
  const us = await prisma.unidades.findMany({
    where: { id: { in: unidadIds.map((n) => BigInt(n)) }, negocio_id: negocioId },
    select: { id: true },
  });
  if (us.length !== new Set(unidadIds).size) throw new HttpError(400, 'Alguna unidad no pertenece al negocio');
  if (b.categoria_id != null) {
    const c = await prisma.categorias.findFirst({ where: { id: BigInt(b.categoria_id), negocio_id: negocioId } });
    if (!c) throw new HttpError(400, 'La categoría no pertenece al negocio');
  }
}

catalogoRouter.post(
  '/productos',
  requireAuth,
  soloAdmin,
  asyncHandler(async (req, res) => {
    const b = productoSchema.parse(req.body);
    await validarRefs(req.auth!.negocioId, b);
    const sku = b.sku.trim().toUpperCase();
    const dup = await prisma.products.findFirst({
      where: { negocio_id: req.auth!.negocioId, OR: [{ sku }, { nombre: b.nombre.trim() }] },
    });
    if (dup) throw new HttpError(409, 'Ya existe un producto con ese nombre o SKU');
    const p = await prisma.products.create({
      data: {
        negocio_id: req.auth!.negocioId,
        nombre: b.nombre.trim(),
        sku,
        codigo_barras: b.codigo_barras?.trim() || null,
        categoria_id: b.categoria_id ? BigInt(b.categoria_id) : null,
        unidad_distribucion_id: BigInt(b.unidad_distribucion_id),
        unidad_compra_id: b.unidad_compra_id ? BigInt(b.unidad_compra_id) : null,
        unidad_almacen_id: b.unidad_almacen_id ? BigInt(b.unidad_almacen_id) : null,
        factor_compra_almacen: b.factor_compra_almacen ?? 1,
        factor_almacen_distribucion: b.factor_almacen_distribucion ?? 1,
        ultimo_costo: b.ultimo_costo ?? null,
        costo_promedio: b.costo_promedio ?? b.ultimo_costo ?? null,
        administrado_bodega: b.administrado_bodega ?? true,
        requiere_refrigeracion: b.requiere_refrigeracion ?? false,
        stock_min_bodega: b.stock_min_bodega ?? null,
        stock_seguridad_bodega: b.stock_seguridad_bodega ?? null,
        lead_time_dias: b.lead_time_dias ?? null,
        linea_operacion: b.linea_operacion ?? null,
        tipo_operativo: b.tipo_operativo ?? null,
        precio_venta_fijo: b.precio_venta_fijo ?? null,
        markup_caja: b.markup_caja ?? 0,
        peso_caja_lb: b.peso_caja_lb ?? null,
        produccion_dias: [...new Set(b.produccion_dias ?? [])],
        orden_operativo: b.orden_operativo ?? 999,
      },
    });
    res.status(201).json({ id: Number(p.id) });
  }),
);

catalogoRouter.patch(
  '/productos/:id',
  requireAuth,
  soloAdmin,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    const b = productoSchema.partial().extend({ activo: z.boolean().optional() }).parse(req.body);
    const actual = await prisma.products.findFirst({ where: { id, negocio_id: req.auth!.negocioId } });
    if (!actual) throw new HttpError(404, 'Producto no encontrado');

    // Validar refs solo si vienen.
    if (b.unidad_distribucion_id || b.categoria_id || b.unidad_compra_id || b.unidad_almacen_id) {
      await validarRefs(req.auth!.negocioId, {
        ...b,
        unidad_distribucion_id: b.unidad_distribucion_id ?? Number(actual.unidad_distribucion_id),
      } as z.infer<typeof productoSchema>);
    }
    const sku = b.sku ? b.sku.trim().toUpperCase() : undefined;
    if (sku || b.nombre) {
      const dup = await prisma.products.findFirst({
        where: {
          negocio_id: req.auth!.negocioId,
          id: { not: id },
          OR: [...(sku ? [{ sku }] : []), ...(b.nombre ? [{ nombre: b.nombre.trim() }] : [])],
        },
      });
      if (dup) throw new HttpError(409, 'Ya existe un producto con ese nombre o SKU');
    }

    await prisma.products.update({
      where: { id },
      data: {
        nombre: b.nombre?.trim(),
        sku,
        codigo_barras: b.codigo_barras === undefined ? undefined : b.codigo_barras?.trim() || null,
        categoria_id: b.categoria_id === undefined ? undefined : b.categoria_id ? BigInt(b.categoria_id) : null,
        unidad_distribucion_id: b.unidad_distribucion_id ? BigInt(b.unidad_distribucion_id) : undefined,
        unidad_compra_id: b.unidad_compra_id === undefined ? undefined : b.unidad_compra_id ? BigInt(b.unidad_compra_id) : null,
        unidad_almacen_id: b.unidad_almacen_id === undefined ? undefined : b.unidad_almacen_id ? BigInt(b.unidad_almacen_id) : null,
        factor_compra_almacen: b.factor_compra_almacen,
        factor_almacen_distribucion: b.factor_almacen_distribucion,
        ultimo_costo: b.ultimo_costo === undefined ? undefined : b.ultimo_costo,
        costo_promedio: b.costo_promedio === undefined ? undefined : b.costo_promedio,
        administrado_bodega: b.administrado_bodega,
        requiere_refrigeracion: b.requiere_refrigeracion,
        stock_min_bodega: b.stock_min_bodega === undefined ? undefined : b.stock_min_bodega,
        stock_seguridad_bodega: b.stock_seguridad_bodega === undefined ? undefined : b.stock_seguridad_bodega,
        lead_time_dias: b.lead_time_dias === undefined ? undefined : b.lead_time_dias,
        linea_operacion: b.linea_operacion === undefined ? undefined : b.linea_operacion,
        tipo_operativo: b.tipo_operativo === undefined ? undefined : b.tipo_operativo,
        precio_venta_fijo: b.precio_venta_fijo === undefined ? undefined : b.precio_venta_fijo,
        markup_caja: b.markup_caja,
        peso_caja_lb: b.peso_caja_lb === undefined ? undefined : b.peso_caja_lb,
        produccion_dias: b.produccion_dias === undefined ? undefined : [...new Set(b.produccion_dias)],
        orden_operativo: b.orden_operativo,
        activo: b.activo,
      },
    });
    res.json({ ok: true });
  }),
);

// ──────────────────── Stock objetivo por (producto, ubicación) ──────────────

/** GET /catalogo/producto-ubicacion?ubicacion=ID — parámetros par de cada producto activo
 *  en esa ubicación (con defaults si aún no se configuró). */
catalogoRouter.get(
  '/producto-ubicacion',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ubicacionId = BigInt(z.coerce.number().int().positive().parse(req.query.ubicacion));
    const ubic = await prisma.ubicaciones.findFirst({ where: { id: ubicacionId, negocio_id: req.auth!.negocioId } });
    if (!ubic) throw new HttpError(404, 'Ubicación no encontrada');

    const [productos, params] = await Promise.all([
      prisma.products.findMany({
        where: { negocio_id: req.auth!.negocioId, activo: true },
        include: { categorias: true, unidad_distribucion: true },
        orderBy: [{ linea_operacion: 'asc' }, { orden_operativo: 'asc' }, { nombre: 'asc' }],
      }),
      prisma.producto_ubicacion.findMany({ where: { ubicacion_id: ubicacionId } }),
    ]);
    const porProducto = new Map(params.map((p) => [p.product_id.toString(), p]));

    res.json({
      ubicacion: { id: Number(ubic.id), nombre: ubic.nombre, tipo: ubic.tipo },
      items: productos.map((p) => {
        const pu = porProducto.get(p.id.toString());
        return {
          product_id: Number(p.id),
          nombre: p.nombre,
          sku: p.sku,
          categoria: p.categorias?.nombre ?? null,
          unidad_distribucion: p.unidad_distribucion.nombre,
          configurado: !!pu,
          habilitado: pu?.habilitado ?? false,
          stock_objetivo: num(pu?.stock_objetivo) ?? 0,
          stock_min: num(pu?.stock_min) ?? 0,
          stock_max: num(pu?.stock_max),
          stock_seguridad: num(pu?.stock_seguridad) ?? 0,
          multiplo_distribucion: num(pu?.multiplo_distribucion) ?? 1,
          minimo_envio: num(pu?.minimo_envio) ?? 0,
        };
      }),
    });
  }),
);

const puItemSchema = z.object({
  product_id: z.coerce.number().int().positive(),
  habilitado: z.boolean().optional(),
  stock_objetivo: z.coerce.number().nonnegative().optional(),
  stock_min: z.coerce.number().nonnegative().optional(),
  stock_max: z.coerce.number().nonnegative().optional().nullable(),
  stock_seguridad: z.coerce.number().nonnegative().optional(),
  multiplo_distribucion: z.coerce.number().positive().optional(),
  minimo_envio: z.coerce.number().nonnegative().optional(),
  // Procedencia del cálculo (al aplicar sugerencias del motor de stock objetivo).
  origen_calculo: z.enum(['manual', 'historico', 'automatico']).optional(),
  consumo_promedio: z.coerce.number().nonnegative().optional(),
  dias_cobertura: z.coerce.number().int().nonnegative().optional(),
});

/** PUT /catalogo/producto-ubicacion { ubicacion_id, items[] } — upsert masivo de niveles par. */
catalogoRouter.put(
  '/producto-ubicacion',
  requireAuth,
  soloAdmin,
  asyncHandler(async (req, res) => {
    const b = z
      .object({ ubicacion_id: z.coerce.number().int().positive(), items: z.array(puItemSchema) })
      .parse(req.body);
    const ubicacionId = BigInt(b.ubicacion_id);
    const ubic = await prisma.ubicaciones.findFirst({ where: { id: ubicacionId, negocio_id: req.auth!.negocioId } });
    if (!ubic) throw new HttpError(404, 'Ubicación no encontrada');

    const productIds = b.items.map((i) => BigInt(i.product_id));
    const ok = await prisma.products.findMany({
      where: { id: { in: productIds }, negocio_id: req.auth!.negocioId },
      select: { id: true },
    });
    if (ok.length !== new Set(productIds.map(String)).size) {
      throw new HttpError(400, 'Algún producto no pertenece al negocio');
    }

    await prisma.$transaction(
      b.items.map((i) =>
        prisma.producto_ubicacion.upsert({
          where: { ubicacion_id_product_id: { ubicacion_id: ubicacionId, product_id: BigInt(i.product_id) } },
          create: {
            negocio_id: req.auth!.negocioId,
            ubicacion_id: ubicacionId,
            product_id: BigInt(i.product_id),
            habilitado: i.habilitado ?? false,
            stock_objetivo: i.stock_objetivo ?? 0,
            stock_min: i.stock_min ?? 0,
            stock_max: i.stock_max ?? null,
            stock_seguridad: i.stock_seguridad ?? 0,
            multiplo_distribucion: i.multiplo_distribucion ?? 1,
            minimo_envio: i.minimo_envio ?? 0,
            origen_calculo: i.origen_calculo ?? 'manual',
            consumo_promedio: i.consumo_promedio,
            dias_cobertura: i.dias_cobertura,
            actualizado_por: req.auth!.usuarioId,
          },
          update: {
            habilitado: i.habilitado,
            stock_objetivo: i.stock_objetivo,
            stock_min: i.stock_min,
            stock_max: i.stock_max === undefined ? undefined : i.stock_max,
            stock_seguridad: i.stock_seguridad,
            multiplo_distribucion: i.multiplo_distribucion,
            minimo_envio: i.minimo_envio,
            origen_calculo: i.origen_calculo,
            consumo_promedio: i.consumo_promedio,
            dias_cobertura: i.dias_cobertura,
            actualizado_por: req.auth!.usuarioId,
          },
        }),
      ),
    );
    res.json({ ok: true, guardados: b.items.length });
  }),
);
