import { createApp } from '../../server/app.mjs';
import { createBlog } from '../../server/blog/routes.mjs';
import { openBlog } from '../../server/blog/store.mjs';
import { tokenHash } from '../../server/installation.mjs';

const store = openBlog(':memory:');
store.setSystem({ siteUrl: 'http://127.0.0.1:4317' });
store.issueSetup(tokenHash('z'.repeat(43)), Date.now() + 900000);
createApp({}, { blog: createBlog({ store, timer: false }) }).listen(4317, '127.0.0.1');
