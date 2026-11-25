import { createBlog } from './blog/routes.mjs';
import { createApp } from './app.mjs';
import { readConfig } from './config.mjs';
import { createMailer } from './mail.mjs';
import { openSubscribers } from './subscribers.mjs';

process.umask(0o077);
const config = readConfig();
const store = config.smtp ? openSubscribers(config.database) : undefined;
const send = config.smtp ? createMailer(config.smtp) : undefined;
const blog = createBlog();
const server = createApp(config, { store, send, blog });
const cleanup = store && setInterval(() => {
  try { store.purgeExpired(); } catch { console.error('Subscriber expiry cleanup failed'); }
}, 12 * 60 * 60 * 1000).unref();
server.listen(config.port, '0.0.0.0', () => console.log(`OminiCorp listening on port ${config.port} (mail ${send ? 'configured' : 'disabled'})`));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  clearInterval(cleanup);
  server.close(async () => {
    store?.close();
    try { await blog.close(); } catch { process.exitCode = 1; }
  });
});
