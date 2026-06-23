import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// PIN inicial del admin sembrado. Cámbialo luego desde la app.
const PIN_INICIAL = process.env.SEED_ADMIN_PIN ?? '1234';

async function main() {
  // 1) Organización Burrito Parrilla Mexicana (idempotente por nombre).
  let org = await prisma.negocios.findFirst({ where: { nombre: 'Burrito Parrilla Mexicana' } });
  if (!org) {
    org = await prisma.negocios.create({
      data: { nombre: 'Burrito Parrilla Mexicana', tipo: 'restaurante', zona_horaria: 'America/Chicago' },
    });
  }
  console.log(`Organización: ${org.nombre} (id ${org.id})`);

  // 2) Usuario administrador general (idempotente por nombre).
  const existe = await prisma.usuarios.findFirst({ where: { negocio_id: org.id, nombre: 'Admin' } });
  if (!existe) {
    await prisma.usuarios.create({
      data: { negocio_id: org.id, nombre: 'Admin', rol: 'admin', pin_hash: await bcrypt.hash(PIN_INICIAL, 10) },
    });
    console.log(`  + usuario admin "Admin" (PIN inicial: ${PIN_INICIAL})`);
  }

  console.log('\n✅ Seed completo. Cambia el PIN inicial desde la app cuanto antes.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
