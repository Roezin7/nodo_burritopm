// Configuración (admin). Placeholder de Bloque 0; se construye por pestañas en los
// bloques siguientes: ubicaciones, usuarios/roles, categorías, unidades, catálogo y
// stock objetivo por sucursal.
export default function Configuracion() {
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Configuración</h1>
          <p className="page-sub">Ubicaciones, usuarios, catálogo y niveles objetivo.</p>
        </div>
      </header>
      <p className="muted">Próximamente: gestión de bodega y sucursales.</p>
    </div>
  );
}
