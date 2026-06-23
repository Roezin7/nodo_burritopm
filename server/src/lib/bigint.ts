// Express/JSON.stringify no sabe serializar BigInt. Los IDs del proyecto son
// pequeños (caben en Number con seguridad), así que los emitimos como número.
// Importar este módulo una vez al arrancar el servidor.
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (this: bigint) {
  return Number(this);
};

export {};
