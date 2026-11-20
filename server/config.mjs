export function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[a-z\d.!#$%&'*+/=?^_`{|}~-]+@[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+$/i.test(value);
}

export function readConfig(env = process.env) {
  const port = Number(env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const database = env.SUBSCRIBER_DB || 'data/subscribers.sqlite';
  if (!env.SMTP_HOST) return { port, database, smtp: null };

  const required = ['SMTP_FROM', 'SMTP_TO', 'PUBLIC_SITE_URL'];
  if (required.some((key) => !env[key])) throw new Error('SMTP requires SMTP_FROM, SMTP_TO and PUBLIC_SITE_URL');
  if (!validEmail(env.SMTP_FROM) || !validEmail(env.SMTP_TO)) throw new Error('Invalid SMTP_FROM or SMTP_TO');
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASS)) throw new Error('Configure both SMTP_USER and SMTP_PASS, or neither');
  const mode = env.SMTP_SECURITY || 'starttls';
  if (!['starttls', 'tls', 'none'].includes(mode)) throw new Error('Invalid SMTP_SECURITY');
  if (mode === 'none' && (env.SMTP_USER || !['localhost', '127.0.0.1', '::1'].includes(env.SMTP_HOST))) {
    throw new Error('Insecure SMTP is allowed only on loopback without authentication');
  }
  const smtpPort = Number(env.SMTP_PORT || (mode === 'tls' ? 465 : 587));
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) throw new Error('Invalid SMTP_PORT');
  const publicUrl = new URL(env.PUBLIC_SITE_URL);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname);
  if (publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash || publicUrl.pathname !== '/' ||
    !(publicUrl.protocol === 'https:' || (publicUrl.protocol === 'http:' && loopback))) {
    throw new Error('PUBLIC_SITE_URL must be an HTTPS origin (HTTP is allowed on loopback)');
  }
  return {
    port, database, origin: publicUrl.origin,
    smtp: {
      host: env.SMTP_HOST, port: smtpPort, from: env.SMTP_FROM, to: env.SMTP_TO, mode,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    },
  };
}
