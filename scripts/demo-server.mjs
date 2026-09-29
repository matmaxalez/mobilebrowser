// Serves the "what does the site see?" page on http://127.0.0.1:8787/detect
// so you can check the extension by hand. Usage: npm run demo
import { startServer } from '../test/helpers.js';

const { url } = await startServer(Number(process.env.PORT) || 8787);
console.log(`Strona testowa: ${url.replace('/probe', '/detect')}`);
