// eslint-disable-next-line no-unused-vars
module.exports = (err, req, res, next) => {
  console.error(err);

  if (err.code === '23505') { // unique_violation de Postgres
    return res.status(409).json({ error: 'Ya existe un registro con esos datos', detalle: err.detail });
  }
  if (err.code === '23503') { // foreign_key_violation
    return res.status(400).json({ error: 'Referencia invalida', detalle: err.detail });
  }
  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }

  res.status(500).json({ error: 'Error interno del servidor' });
};
