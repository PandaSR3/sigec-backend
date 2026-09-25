const { pool } = require('../../config/db');
const { registrarAuditoria } = require('../../utils/auditoria');

const ID_ESTADO_PERSONA_PROSPECTO = 2; // ver orden de insercion en sigec_seed.sql

async function crear(idEmpresa, data, idUsuarioCreador) {
  const {
    idTipoDocumento, numeroDocumento, nombresApellidos,
    fechaNacimiento, idSexo, celular, correo, idDistrito
  } = data;

  const { rows } = await pool.query(
    `INSERT INTO persona
       (id_empresa, id_tipo_documento, numero_documento, nombres_apellidos,
        fecha_nacimiento, id_sexo, celular, correo, id_distrito,
        id_estado_persona, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [idEmpresa, idTipoDocumento, numeroDocumento, nombresApellidos,
      fechaNacimiento || null, idSexo || null, celular, correo || null, idDistrito || null,
      ID_ESTADO_PERSONA_PROSPECTO, idUsuarioCreador]
  );

  const persona = rows[0];

  await registrarAuditoria(pool, {
    idUsuario: idUsuarioCreador,
    tablaAfectada: 'persona',
    idRegistroAfectado: persona.id_persona,
    accion: 'CREAR',
    estadoNuevo: persona
  });

  return persona;
}

async function listar(idEmpresa, { search, page = 1, pageSize = 20 }) {
  const offset = (page - 1) * pageSize;
  const params = [idEmpresa];
  let where = 'id_empresa = $1 AND deleted_at IS NULL';

  if (search) {
    params.push(`%${search}%`);
    where += ` AND (nombres_apellidos ILIKE $${params.length} OR numero_documento ILIKE $${params.length})`;
  }

  params.push(pageSize, offset);
  const { rows } = await pool.query(
    `SELECT * FROM persona WHERE ${where}
     ORDER BY nombres_apellidos
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

async function obtenerPorId(idPersona) {
  const { rows } = await pool.query(
    'SELECT * FROM persona WHERE id_persona = $1 AND deleted_at IS NULL',
    [idPersona]
  );
  return rows[0] || null;
}

module.exports = { crear, listar, obtenerPorId };
