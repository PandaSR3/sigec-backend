const { Router } = require('express');
const controller = require('./cronogramas.controller');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');

const router = Router();

router.use(authenticate);

router.post('/:idContrato/reprogramar', authorize('CRONOGRAMA_REPROGRAMAR'), controller.reprogramar);
router.get('/:idContrato/cronogramas', authorize(['CONTRATO_VER_TODOS', 'CONTRATO_VER_PROPIO']), controller.historial);

module.exports = router;
