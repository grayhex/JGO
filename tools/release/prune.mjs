// Applied only to a staged runtime tree, never to the source checkout.
import { existsSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(process.argv[2] || '');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
if(root===repo || !process.argv[2] || existsSync(path.join(root,'.git')))throw Error('Pass a staged runtime app directory');
const manifests=['package.json','apps/api/package.json','apps/web/package.json','packages/protocol/package.json'];
for(const rel of manifests)if(!existsSync(path.join(root,rel)))throw Error('Not a staged JGO runtime: '+rel);
if(JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).name!=='j2me-web')throw Error('Not a JGO runtime');
for(const p of ['apps/api/src','apps/web/src','apps/web/public','packages/protocol/src','apps/api/dist/lab','apps/api/dist/dev','apps/api/dist/testing.js','apps/api/dist/fakeMoby.js','tests','design','tools','.git'])rmSync(path.join(root,p),{recursive:true,force:true});
function clean(dir){for(const f of readdirSync(dir,{withFileTypes:true})){if(f.name==='node_modules')continue;const p=path.join(dir,f.name);if(f.isDirectory())clean(p);else if(/\.test\.|\.map$|reference-manifest\.json$|references\.md$|\.d\.ts$/.test(f.name))rmSync(p);}}
clean(root);
// Installed dependencies are already production-only. Drop developer commands/requirements from app manifests.
for(const rel of manifests){
 const file=path.join(root,rel);const pkg=JSON.parse(readFileSync(file,'utf8'));
 delete pkg.devDependencies;
 pkg.scripts=rel==='package.json'?{start:'node apps/api/dist/server.js'}:{};
 writeFileSync(file,JSON.stringify(pkg,null,2)+'\n');
}
