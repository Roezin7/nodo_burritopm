import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { transaction } = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('../db.js', () => ({ prisma: { $transaction: transaction } }));

import { transaccionSerializable } from './transaccion.js';

function errorPrisma(codigo: string) {
  return new Prisma.PrismaClientKnownRequestError('conflicto de prueba', { code: codigo, clientVersion: 'test' });
}

describe('transaccionSerializable', () => {
  beforeEach(() => transaction.mockReset());

  it('reintenta un conflicto de serialización y conserva el resultado', async () => {
    transaction.mockRejectedValueOnce(errorPrisma('P2034')).mockResolvedValueOnce({ ok: true });

    await expect(transaccionSerializable(async () => ({ ok: true }))).resolves.toEqual({ ok: true });
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('no oculta otros errores de base de datos', async () => {
    transaction.mockRejectedValueOnce(errorPrisma('P2025'));

    await expect(transaccionSerializable(async () => null)).rejects.toMatchObject({ code: 'P2025' });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('puede reintentar una colisión única cuando la llave idempotente la vuelve segura', async () => {
    transaction.mockRejectedValueOnce(errorPrisma('P2002')).mockResolvedValueOnce('repetida');

    await expect(transaccionSerializable(async () => 'creada', { reintentarUnico: true })).resolves.toBe('repetida');
    expect(transaction).toHaveBeenCalledTimes(2);
  });
});
