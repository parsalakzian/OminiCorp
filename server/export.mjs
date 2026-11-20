import { openSubscribers } from './subscribers.mjs';

process.umask(0o077);
const store = openSubscribers(process.env.SUBSCRIBER_DB || 'data/subscribers.sqlite');
try {
  for (const email of store.list()) console.log(email);
} finally {
  store.close();
}
