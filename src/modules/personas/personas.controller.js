const service = require('./personas.service');
const asyncHandler = require('../../utils/asyncHandler');

const crear = asyncHandler(async (req, res) => {
  const persona = await service.crear(req.user.idEmpresa, req.body, req.user.idUsuario);
  res.status(201).json(persona);
});

const listar = asyncHandler(async (req, res) => {
  const { search, page, pageSize } = req.query;
  const personas = await service.listar(req.user.idEmpresa, {
    search,
    page: page ? Number(page) : undefined,
    pageSize: pageSize ? Number(pageSize) : undefined
  });
  res.json(personas);
});

const obtener = asyncHandler(async (req, res) => {
  const persona = await service.obtenerPorId(req.params.id);
  if (!persona) return res.status(404).json({ error: 'Persona no encontrada' });
  res.json(persona);
});

module.exports = { crear, listar, obtener };
