import jwt from 'jsonwebtoken';
import { env } from '../env.js';

export type Rol = 'admin' | 'encargado_bodega' | 'encargado_sucursal';

export interface JwtPayload {
  sub: string; // usuario_id (string porque viene de BigInt)
  negocio_id: string;
  rol: Rol;
  nombre: string;
}

const EXPIRA_EN = '30d'; // sesión larga: es una tablet/dispositivo dedicado

export function firmarToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: EXPIRA_EN });
}

export function verificarToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}
