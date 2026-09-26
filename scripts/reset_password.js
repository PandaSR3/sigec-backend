/**
 * Restablece la contraseña de un usuario existente (no se puede "ver" la
 * actual: esta hasheada con bcrypt, de una sola via).
 * Uso: node scripts/reset_password.js usuario nueva_password
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');

async function main() {
  const [usuario, nuevaPassword] = process.argv.slice(2);

  if (!usuario || !nuevaPassword) {
    console.error('Uso: node scripts/reset_password.js usuario nueva_password');
    process.exit(1);
  }
  if (nuevaPassword.length < 8) {
    console.error('La nueva contraseña debe tener al menos 8 caracteres.');
    process.exit(1);
  }

  try {
    const { rows } = await pool.query(
      'SELECT id_usuario FROM usuario WHERE usuario = $1 AND deleted_at IS NULL',
      [usuario]
    );
    if (rows.length === 0) {
      console.error(`No existe un usuario activo con el nombre '${usuario}'.`);
      process.exit(1);
    }
    const idUsuario = rows[0].id_usuario;

    const passwordHash = await bcrypt.hash(nuevaPassword, 10);
    await pool.query(
      'UPDATE credencial SET password_hash = $1, fecha_ultimo_cambio = now() WHERE id_usuario = $2',
      [passwordHash, idUsuario]
    );

    console.log(`Contraseña actualizada para '${usuario}'.`);
  } catch (err) {
    console.error('Error al restablecer la contraseña:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
