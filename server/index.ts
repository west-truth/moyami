import { createServer } from 'node:http';
import { createApplication } from './app.js';

const app = createApplication();
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 4173);
const server = createServer((req, res) => { app.handle(req, res).catch(() => res.destroy()); });
server.listen(port, host, () => console.log(`moya-source-lite listening on http://${host}:${port}`));
function close() { server.close(); app.close(); }
process.once('SIGINT', close);
process.once('SIGTERM', close);
