/**
 * Crea la primera persona + usuario + credencial con rol Super Administrador.
 * Uso: node scripts/create_admin.js "Nombre Apellido" dni_o_doc usuario password
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');

async function main() {
  const [nombresApellidos, numeroDocumento, usuario, password] = process.argv.slice(2);

  if (!nombresApellidos || !numeroDocumento || !usuario || !password) {
    console.error('Uso: node scripts/create_admin.js "Nombre Apellido" numero_documento usuario password');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: empresaRows } = await client.query(
      "SELECT id_empresa FROM empresa WHERE ruc = '00000000000'"
    );
    if (empresaRows.length === 0) {
      throw new Error('No se encontro la empresa base. ¿Corriste sigec_seed.sql?');
    }
    const idEmpresa = empresaRows[0].id_empresa;

    const { rows: rolRows } = await client.query(
      'SELECT id_rol FROM rol WHERE id_empresa = $1 AND nombre = $2',
      [idEmpresa, 'Super Administrador']
    );
    if (rolRows.length === 0) {
      throw new Error('No se encontro el rol Super Administrador. ¿Corriste sigec_seed.sql?');
    }
    const idRol = rolRows[0].id_rol;

    const { rows: tipoDocRows } = await client.query(
      "SELECT id_tipo_documento FROM tipo_documento WHERE nombre = 'DNI'"
    );
    const idTipoDocumento = tipoDocRows[0].id_tipo_documento;

    const { rows: estadoPersonaRows } = await client.query(
      "SELECT id_estado_persona FROM estado_persona WHERE nombre = 'Cliente'"
    );
    const idEstadoPersona = estadoPersonaRows[0].id_estado_persona;

    const { rows: personaRows } = await client.query(
      `INSERT INTO persona (id_empresa, id_tipo_documento, numero_documento, nombres_apellidos, celular, id_estado_persona)
       VALUES ($1,$2,$3,$4,'000000000',$5) RETURNING id_persona`,
      [idEmpresa, idTipoDocumento, numeroDocumento, nombresApellidos, idEstadoPersona]
    );
    const idPersona = personaRows[0].id_persona;

    const { rows: usuarioRows } = await client.query(
      `INSERT INTO usuario (id_persona, id_empresa, usuario)
       VALUES ($1,$2,$3) RETURNING id_usuario`,
      [idPersona, idEmpresa, usuario]
    );
    const idUsuario = usuarioRows[0].id_usuario;

    const passwordHash = await bcrypt.hash(password, 10);
    await client.query(
      'INSERT INTO credencial (id_usuario, password_hash) VALUES ($1,$2)',
      [idUsuario, passwordHash]
    );

    await client.query(
      'INSERT INTO usuario_rol (id_usuario, id_rol) VALUES ($1,$2)',
      [idUsuario, idRol]
    );

    await client.query('COMMIT');
    console.log(`Usuario Super Administrador creado: ${usuario} (id_usuario=${idUsuario})`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creando el administrador:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
