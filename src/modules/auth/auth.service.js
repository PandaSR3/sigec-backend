const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../../config/db');

async function login(usuario, password, ipOrigen) {
  const { rows } = await pool.query(
    `SELECT u.id_usuario, u.id_persona, u.usuario, u.es_activo, u.id_empresa,
            c.password_hash,
            p.nombres_apellidos
       FROM usuario u
       JOIN credencial c ON c.id_usuario = u.id_usuario
       JOIN persona p ON p.id_persona = u.id_persona
      WHERE u.usuario = $1 AND u.deleted_at IS NULL`,
    [usuario]
  );

  const registrarIntento = (idUsuario, resultado) =>
    pool.query(
      `INSERT INTO login_auditoria (id_usuario, usuario_ingresado, resultado, ip_origen)
       VALUES ($1, $2, $3, $4)`,
      [idUsuario, usuario, resultado, ipOrigen]
    );

  if (rows.length === 0) {
    await registrarIntento(null, 'FALLIDO');
    const err = new Error('Usuario o contraseña incorrectos');
    err.status = 401;
    throw err;
  }

  const row = rows[0];

  if (!row.es_activo) {
    await registrarIntento(row.id_usuario, 'FALLIDO');
    const err = new Error('Usuario inactivo');
    err.status = 403;
    throw err;
  }

  const passwordOk = await bcrypt.compare(password, row.password_hash);
  if (!passwordOk) {
    await registrarIntento(row.id_usuario, 'FALLIDO');
    const err = new Error('Usuario o contraseña incorrectos');
    err.status = 401;
    throw err;
  }

  await registrarIntento(row.id_usuario, 'EXITOSO');
  await pool.query('UPDATE usuario SET ultimo_acceso = now() WHERE id_usuario = $1', [row.id_usuario]);

  const { rows: rolesRows } = await pool.query(
    `SELECT r.id_rol, r.nombre FROM rol r
       JOIN usuario_rol ur ON ur.id_rol = r.id_rol
      WHERE ur.id_usuario = $1`,
    [row.id_usuario]
  );

  const { rows: permisosRows } = await pool.query(
    `SELECT DISTINCT p.codigo FROM permiso p
       JOIN rol_permiso rp ON rp.id_permiso = p.id_permiso
       JOIN usuario_rol ur ON ur.id_rol = rp.id_rol
      WHERE ur.id_usuario = $1`,
    [row.id_usuario]
  );

  const payload = {
    idUsuario: row.id_usuario,
    idPersona: row.id_persona,
    idEmpresa: row.id_empresa,
    usuario: row.usuario,
    nombre: row.nombres_apellidos,
    roles: rolesRows.map((r) => r.nombre),
    permisos: permisosRows.map((p) => p.codigo)
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h'
  });

  return { token, usuario: payload };
}

module.exports = { login };
