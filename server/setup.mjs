import { openBlog } from './blog/store.mjs';
import { makeKey, tokenHash } from './installation.mjs';

process.umask(0o077);
const store = openBlog('data/blog.sqlite');
try {
  const code = makeKey();
  if (!store.issueSetup(tokenHash(code), Date.now() + 15 * 60 * 1000)) {
    console.error('An owner already exists. To change the password, sign in and open /admin/system.');
    process.exitCode = 1;
  } else {
    console.log(`Open /admin/setup, then enter this one-time code (expires in 15 minutes):\n${code}`);
  }
} finally { store.close(); }
