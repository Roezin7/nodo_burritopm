import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import type { Usuario } from './auth';

const TITULOS: Record<string, string> = {
  '/': 'Resumen',
  '/facturacion': 'Facturación',
  '/incidencias': 'Incidencias',
  '/configuracion': 'Configuración',
  '/conteos': 'Conteos',
  '/rutas': 'Rutas de entrega',
};

const PASOS: Record<string, string> = {
  compras: 'Compras', produccion: 'Producción', ventas: 'Pedidos', entregas: 'Entregas', inventario: 'Inventario', cierre: 'Cierre',
};

export function usePageTitle(usuario: Usuario | null) {
  const { pathname } = useLocation();
  useEffect(() => {
    const paso = pathname.startsWith('/semana/') ? pathname.split('/')[2] : '';
    const seccion = usuario ? TITULOS[pathname] ?? PASOS[paso] ?? 'NODO' : 'Acceso';
    const contexto = usuario?.rol === 'encargado_sucursal' && usuario.ubicaciones?.length === 1
      ? ` · ${usuario.ubicaciones[0].nombre}` : '';
    document.title = seccion === 'NODO' ? 'NODO · Burrito Parrilla' : `${seccion}${contexto} · NODO`;
  }, [pathname, usuario]);
}
