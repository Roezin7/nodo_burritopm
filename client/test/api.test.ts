import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/offline', () => ({ encolar: vi.fn() }));
const response = (n: number) => new Response(JSON.stringify({ saldo: n }), { status: 200 });

describe('inventario: lecturas frescas tras una captura', () => {
  beforeEach(() => { vi.resetModules(); vi.stubGlobal('localStorage', { getItem: () => null }); vi.stubGlobal('window', new EventTarget()); });
  afterEach(() => vi.unstubAllGlobals());

  it('relee una respuesta que empezó antes de guardar y nunca muestra su saldo viejo', async () => {
    let resolver!: (r: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(r => { resolver = r; }))
      .mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(response(5));
    vi.stubGlobal('fetch', fetch);
    const { api } = await import('../src/api');
    const vieja = api('/inventario');
    await api('/conteo', { method: 'PUT', body: { cantidad: 5 } });
    resolver(response(0));
    expect(await vieja).toEqual({ saldo: 5 });
    expect(await api('/inventario')).toEqual({ saldo: 5 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('una actualización explícita no reutiliza una lectura en curso ni deja que sobrescriba la caché', async () => {
    let resolver!: (r: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(r => { resolver = r; })).mockResolvedValueOnce(response(5));
    vi.stubGlobal('fetch', fetch);
    const { api } = await import('../src/api');
    const vieja = api('/inventario');
    expect(await api('/inventario', { fresh: true })).toEqual({ saldo: 5 });
    resolver(response(0)); await vieja;
    expect(await api('/inventario')).toEqual({ saldo: 5 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
