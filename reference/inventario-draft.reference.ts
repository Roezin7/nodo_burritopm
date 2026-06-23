import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { HttpError } from '../middleware/error.js';

// Fase 7 — Borrador de conteo asistido por IA.
// La IA SOLO propone: parsea un texto/foto de conteo y lo empata contra el catálogo.
// Nunca escribe en la DB; devuelve un borrador editable que el usuario confirma con
// el endpoint normal de conteo (POST /inventario/snapshots).

const MODELO = 'claude-opus-4-8';

export const draftDisponible = () => !!env.ANTHROPIC_API_KEY;

export interface LineaBorrador {
  nombre_detectado: string;
  product_id: number | null; // id del catálogo si hubo match; null si no se reconoció
  nombre_producto: string | null;
  qty_captura: number;
  confianza: 'alta' | 'media' | 'baja';
}

const HERRAMIENTA: Anthropic.Tool = {
  name: 'registrar_borrador',
  description: 'Devuelve las líneas del conteo detectadas y empatadas contra el catálogo.',
  input_schema: {
    type: 'object',
    properties: {
      lineas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            nombre_detectado: { type: 'string', description: 'El nombre tal como aparece en el texto/foto.' },
            product_id: { type: ['integer', 'null'], description: 'El id del producto del catálogo que mejor empata, o null si no hay match claro.' },
            qty_captura: { type: 'number', description: 'La cantidad contada, en número.' },
            confianza: { type: 'string', enum: ['alta', 'media', 'baja'], description: 'Qué tan seguro es el match contra el catálogo.' },
          },
          required: ['nombre_detectado', 'product_id', 'qty_captura', 'confianza'],
        },
      },
    },
    required: ['lineas'],
  },
};

interface Entrada {
  texto?: string;
  imagen_base64?: string;
  imagen_tipo?: string; // p.ej. "image/jpeg"
}

export async function borradorConteo(negocioId: bigint, entrada: Entrada) {
  if (!env.ANTHROPIC_API_KEY) {
    throw new HttpError(503, 'La IA no está configurada: falta ANTHROPIC_API_KEY en el servidor.');
  }
  if (!entrada.texto?.trim() && !entrada.imagen_base64) {
    throw new HttpError(400, 'Manda el conteo como texto o como foto.');
  }

  const productos = await prisma.products.findMany({
    where: { negocio_id: negocioId, active: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  const catalogo = productos.map((p) => `${Number(p.id)}: ${p.name}`).join('\n');
  const nombrePorId = new Map(productos.map((p) => [Number(p.id), p.name]));

  const sys = `Eres un asistente que convierte un conteo de inventario (escrito o en foto) de un bar en líneas estructuradas.
Te doy el CATÁLOGO de productos (id: nombre). Para cada renglón del conteo:
- Empátalo con el producto del catálogo cuyo nombre sea el mismo o el más parecido y pon su product_id.
- Si no hay un match razonable, pon product_id = null y confianza "baja".
- qty_captura es el número contado (acepta decimales como 2.5).
- confianza: "alta" si el nombre coincide casi exacto; "media" si es parecido; "baja" si dudoso o sin match.
NO inventes productos ni cantidades. Si un renglón no tiene cantidad clara, omítelo.
Devuelve TODO mediante la herramienta registrar_borrador.

CATÁLOGO:
${catalogo}`;

  const content: Anthropic.ContentBlockParam[] = [];
  if (entrada.imagen_base64) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: (entrada.imagen_tipo as 'image/jpeg') ?? 'image/jpeg', data: entrada.imagen_base64 },
    });
  }
  content.push({ type: 'text', text: entrada.texto?.trim() ? `Conteo:\n${entrada.texto.trim()}` : 'Extrae el conteo de la imagen.' });

  const cli = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  let resp: Anthropic.Message;
  try {
    resp = await cli.messages.create({
      model: MODELO,
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      system: sys,
      tools: [HERRAMIENTA],
      tool_choice: { type: 'tool', name: 'registrar_borrador' },
      messages: [{ role: 'user', content }],
    });
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      const msg = String((e as { message?: string }).message ?? '');
      if (/credit balance|too low|billing/i.test(msg)) throw new HttpError(402, 'La IA no tiene crédito: agrega saldo en console.anthropic.com.');
      if (e.status === 401) throw new HttpError(401, 'La API key de Anthropic es inválida.');
      throw new HttpError(502, `La API de Anthropic devolvió un error: ${msg.slice(0, 200)}`);
    }
    throw e;
  }

  const tool = resp.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  const crudas = (tool?.input as { lineas?: Array<{ nombre_detectado?: string; product_id?: number | null; qty_captura?: number; confianza?: string }> })?.lineas ?? [];

  const lineas: LineaBorrador[] = crudas
    .filter((l) => typeof l.qty_captura === 'number' && !Number.isNaN(l.qty_captura))
    .map((l) => {
      const pid = l.product_id != null && nombrePorId.has(Number(l.product_id)) ? Number(l.product_id) : null;
      return {
        nombre_detectado: String(l.nombre_detectado ?? ''),
        product_id: pid,
        nombre_producto: pid != null ? nombrePorId.get(pid)! : null,
        qty_captura: Number(l.qty_captura),
        confianza: (['alta', 'media', 'baja'].includes(l.confianza ?? '') ? l.confianza : 'baja') as 'alta' | 'media' | 'baja',
      };
    });

  return { lineas };
}
