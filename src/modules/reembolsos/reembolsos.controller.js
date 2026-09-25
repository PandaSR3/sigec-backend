const service = require('./reembolsos.service');
const asyncHandler = require('../../utils/asyncHandler');

const solicitar = asyncHandler(async (req, res) => {
  const { monto, motivo } = req.body;
  const reembolso = await service.solicitar(req.params.idCredito, { monto, motivo }, req.user.idUsuario, req.user.idUsuario);
  res.status(201).json(reembolso);
});

const aprobar = asyncHandler(async (req, res) => {
  const reembolso = await service.aprobar(req.params.id, req.user.idUsuario);
  res.json(reembolso);
});

const rechazar = asyncHandler(async (req, res) => {
  const reembolso = await service.rechazar(req.params.id, req.user.idUsuario, req.body.motivo);
  res.json(reembolso);
});

const pagar = asyncHandler(async (req, res) => {
  const resultado = await service.pagar(req.params.id, req.user.idUsuario);
  res.json(resultado);
});

const obtener = asyncHandler(async (req, res) => {
  const reembolso = await service.obtener(req.params.id);
  if (!reembolso) return res.status(404).json({ error: 'Reembolso no encontrado' });
  res.json(reembolso);
});

const listarPorCredito = asyncHandler(async (req, res) => {
  const reembolsos = await service.listarPorCredito(req.params.idCredito);
  res.json(reembolsos);
});

module.exports = { solicitar, aprobar, rechazar, pagar, obtener, listarPorCredito };
