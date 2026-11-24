import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
if(!process.argv[2])throw new Error('Usage: npm run demo:prepare -- /absolute/path/to/site-checkout');
const target=path.resolve(process.argv[2]);
if(target===root||target.startsWith(root+path.sep))throw new Error('Use an independent directory outside product-app so the original Git remote is preserved.');
const manifest=JSON.parse(await readFile(new URL('.openai/hosting.json',import.meta.url),'utf8'));
try{const previous=JSON.parse(await readFile(path.join(target,'.openai/hosting.json'),'utf8'));if(previous.project_id!==manifest.project_id)throw new Error('Destination belongs to a different Site.');}catch(e){if(e.code!=='ENOENT')throw e;}
for(const folder of ['components/passport-demo','lib/passport-demo','demo-host']){
 const dest=path.join(target,'product-app',folder);await mkdir(dest,{recursive:true});
 for(const entry of await readdir(path.join(root,folder),{withFileTypes:true}))if(entry.isFile())await copyFile(path.join(root,folder,entry.name),path.join(dest,entry.name));
}
await mkdir(path.join(target,'.openai'),{recursive:true});
await writeFile(path.join(target,'.openai/hosting.json'),JSON.stringify(manifest,null,2)+'\n');
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const dependencies=Object.fromEntries(['react','react-dom','zod','mediabunny','fflate'].map(name=>[name,pkg.dependencies[name]]));
await writeFile(path.join(target,'package.json'),JSON.stringify({name:'creative-passport-demo',version:'0.1.0',private:true,type:'module',scripts:{build:'node scripts/build.mjs'},dependencies,devDependencies:{esbuild:pkg.devDependencies.esbuild}},null,2)+'\n');
await mkdir(path.join(target,'scripts'),{recursive:true});
await writeFile(path.join(target,'scripts/build.mjs'),`import {spawnSync} from 'node:child_process';
import {mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
const dist=path.resolve('dist');
const result=spawnSync(process.execPath,['product-app/demo-host/build.mjs'],{env:{...process.env,PASSPORT_DEMO_OUTPUT:dist},stdio:'inherit'});
if(result.status!==0)process.exit(result.status??1);
await mkdir(path.join(dist,'.openai'),{recursive:true});
await copyFile('.openai/hosting.json',path.join(dist,'.openai/hosting.json'));
`);
await writeFile(path.join(target,'.gitignore'),'node_modules/\ndist/\nproduct-app/demo-host/.generated/\nproduct-app/demo-dist/\n.sites-runtime/\n.env*\n!.env.example\n.passport-demo/\n');
await copyFile(path.join(root,'docs/DEMO_V1.md'),path.join(target,'README.md'));
console.log('Prepared shared frontend/backend source at '+target+'; no env files, runtime records or credentials copied.');
