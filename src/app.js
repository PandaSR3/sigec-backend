const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./modules/auth/auth.routes');
const personasRoutes = require('./modules/personas/personas.routes');
const contratosRoutes = require('./modules/contratos/contratos.routes');
const pagosRoutes = require('./modules/pagos/pagos.routes');
const remesasRoutes = require('./modules/remesas/remesas.routes');
const dashboardRoutes = require('./modules/dashboard/dashboard.routes');
const creditosRoutes = require('./modules/creditos/creditos.routes');
const reembolsosRoutes = require('./modules/reembolsos/reembolsos.routes');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.json({ service: 'SIGEC API', status: 'ok' }));

app.use('/auth', authRoutes);
app.use('/personas', personasRoutes);
app.use('/contratos', contratosRoutes);
app.use('/contratos', pagosRoutes); // expone /contratos/:idContrato/pagos
app.use('/remesas', remesasRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/creditos', creditosRoutes); // incluye /creditos/:idCredito/reembolsos
app.use('/reembolsos', reembolsosRoutes);

app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
app.use(errorHandler);

module.exports = app;
