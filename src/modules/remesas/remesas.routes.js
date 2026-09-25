const { Router } = require('express');
const controller = require('./remesas.controller');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');

const router = Router();

router.use(authenticate);
router.use(authorize('REMESA_GESTIONAR'));

router.post('/', controller.generar);              // { periodo: 'YYYY-MM' }
router.get('/', controller.listar);
router.get('/:id', controller.obtener);
router.post('/:id/refrescar', controller.refrescar); // reevalua exclusiones antes de enviar
router.post('/:id/enviar', controller.enviar);
router.post('/:id/observar', controller.observar);
router.post('/:id/rechazar', controller.rechazar);
router.post('/:id/procesar', controller.procesar);   // aplica los pagos reales

module.exports = router;
