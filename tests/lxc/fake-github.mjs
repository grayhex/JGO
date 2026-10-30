// A stand-in for api.github.com + github.com that serves JGO releases from a directory, over TLS.
//   node fake-github.mjs <releases-dir> <tls-dir> [port]
// <releases-dir>/<tag>/<assets...>, and <releases-dir>/latest holding the tag of the latest release.
// The container resolves api.github.com / github.com to this host and trusts the test CA, so the real
// fetch_and_deploy_gh_release / check_for_gh_release helpers and `jgo update` talk to it unmodified.
import { createServer } from 'node:https';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const [dir, tls, port = '443'] = process.argv.slice(2);
const REPO = 'grayhex/JGO';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const tags = () => readdirSync(dir).filter((f) => statSync(path.join(dir, f)).isDirectory());
const latestTag = () => (existsSync(path.join(dir, 'latest')) ? readFileSync(path.join(dir, 'latest'), 'utf8').trim() : tags().sort().at(-1));
let assetId = 1000;
const release = (tag) => {
  const d = path.join(dir, tag);
  return {
    url: `https://api.github.com/repos/${REPO}/releases/${tag}`,
    html_url: `https://github.com/${REPO}/releases/tag/${tag}`,
    id: 1,
    tag_name: tag,
    name: tag,
    target_commitish: 'main',
    draft: false,
    prerelease: false,
    created_at: new Date(statSync(d).mtimeMs).toISOString(),
    published_at: new Date(statSync(d).mtimeMs).toISOString(),
    tarball_url: `https://api.github.com/repos/${REPO}/tarball/${tag}`,
    zipball_url: `https://api.github.com/repos/${REPO}/zipball/${tag}`,
    body: '',
    assets: readdirSync(d).map((name) => ({
      id: ++assetId,
      name,
      size: statSync(path.join(d, name)).size,
      content_type: 'application/octet-stream',
      state: 'uploaded',
      url: `https://api.github.com/repos/${REPO}/releases/assets/${assetId}`,
      browser_download_url: `https://github.com/${REPO}/releases/download/${tag}/${name}`,
    })),
  };
};

createServer({ key: readFileSync(path.join(tls, 'server.key')), cert: readFileSync(path.join(tls, 'server.crt')) }, (req, res) => {
  const host = (req.headers.host ?? '').split(':')[0];
  const url = new URL(req.url, 'https://x');
  const json = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  log(req.method, host + url.pathname);
  let m;
  if (host === 'api.github.com') {
    if (url.pathname === `/repos/${REPO}/releases/latest`) return latestTag() ? json(200, release(latestTag())) : json(404, { message: 'Not Found' });
    if (url.pathname === `/repos/${REPO}/releases`) return json(200, tags().sort().reverse().map(release));
    if ((m = url.pathname.match(`^/repos/${REPO}/releases/tags/(.+)$`))) return tags().includes(m[1]) ? json(200, release(m[1])) : json(404, { message: 'Not Found' });
    if (url.pathname === `/repos/${REPO}`) return json(200, { full_name: REPO, default_branch: 'main' });
    if (url.pathname === '/rate_limit') return json(200, { resources: { core: { limit: 5000, remaining: 4999 } } });
  } else if (host === 'github.com' && (m = url.pathname.match(`^/${REPO}/releases/download/([^/]+)/([^/]+)$`))) {
    const f = path.join(dir, m[1], m[2]);
    if (!existsSync(f)) return json(404, { message: 'Not Found' });
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': statSync(f).size });
    return createReadStream(f).pipe(res);
  }
  json(404, { message: 'Not Found', path: url.pathname, host });
}).listen(Number(port), '0.0.0.0', () => log(`fake GitHub on :${port}, releases in ${dir}`));
