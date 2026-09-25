const service = require('./creditos.service');
const asyncHandler = require('../../utils/asyncHandler');

const listarPorPersona = asyncHandler(async (req, res) => {
  const creditos = await service.listarPorPersona(req.params.idPersona);
  res.json(creditos);
});

const obtener = asyncHandler(async (req, res) => {
  const credito = await service.obtener(req.params.id);
  if (!credito) return res.status(404).json({ error: 'Credito no encontrado' });
  res.json(credito);
});

const aplicar = asyncHandler(async (req, res) => {
  const { idContratoDestino, monto } = req.body;
  const resultado = await service.aplicar(req.params.id, idContratoDestino, monto, req.user.idUsuario);
  res.status(201).json(resultado);
});

module.exports = { listarPorPersona, obtener, aplicar };
