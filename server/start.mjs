import { parseArgs } from 'node:util';
import { createBlog } from './blog/routes.mjs';
import { createApp } from './app.mjs';
import { createMailer } from './mail.mjs';
import { openSubscribers } from './subscribers.mjs';
import { smtpConfig } from './installation.mjs';

process.umask(0o077);
const { values } = parseArgs({ options: { port: { type: 'string', default: '4173' } } });
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid --port');
const subscribers = openSubscribers('data/subscribers.sqlite');
// Keep auth diagnostics useful without logging unbounded traffic or credentials.
let windowEnd = 0, events = 0;
const blog = createBlog({ reportMcp(stage, outcome) {
  const now = Date.now();
  if (now >= windowEnd) { windowEnd = now + 60000; events = 0; }
  if (++events <= 120) console.info(`[mcp] ${stage} ${outcome}`);
  else if (events === 121) console.info('[mcp] further events suppressed for this minute');
} });
const server = createApp({}, { store: subscribers, blog, mailSettings: () => smtpConfig(blog.store.getSystem()), mailFactory: createMailer });
const cleanup = setInterval(() => {
  try { subscribers.purgeExpired(); } catch { console.error('Subscriber expiry cleanup failed'); }
}, 12 * 60 * 60 * 1000).unref();
server.listen(port, '0.0.0.0', () => console.log(`OminiCorp listening on port ${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  clearInterval(cleanup);
  server.close(async () => {
    subscribers.close();
    try { await blog.close(); } catch { process.exitCode = 1; }
  });
});
