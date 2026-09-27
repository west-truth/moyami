import { createApplication } from './app.js';

const app = createApplication({ serverless: true });
export default app.handle;
