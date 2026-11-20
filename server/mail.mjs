import nodemailer from 'nodemailer';

export function createMailer(config) {
  const transport = nodemailer.createTransport({
    host: config.host, port: config.port, auth: config.auth,
    secure: config.mode === 'tls', requireTLS: config.mode === 'starttls', ignoreTLS: config.mode === 'none',
    connectionTimeout: 6000, greetingTimeout: 6000, socketTimeout: 10000, dnsTimeout: 6000,
    disableFileAccess: true, disableUrlAccess: true,
  });
  return async (message) => {
    const info = await transport.sendMail({ ...message, from: config.from });
    if (!info.accepted?.length) throw new Error('SMTP rejected recipient');
  };
}
