require('dotenv').config();
const app = require('./app');

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`SIGEC backend escuchando en http://localhost:${port}`);
});
