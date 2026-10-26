// Refresh online code/styles in Lightyard 79 or an exported 79 app.
// Usage: node client/build-client.mjs <base.html> <out.html> [apiBase]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const [src,out,apiBase='']=process.argv.slice(2);
if(!src||!out){console.error('usage: build-client.mjs <base.html> <out.html> [apiBase]');process.exit(2);}
let html=fs.readFileSync(src,'utf8');
if(!html.includes('data-mode="online"')||!html.includes('renderOnlinePage();')||!html.includes('function stepEditHistory('))throw new Error('Use client/lightyard-79.html (or an exported 79 app) as the base to retain Online Puzzles navigation and Undo/Redo.');
const schema=fs.readFileSync(path.join(here,'../shared/canonical.js'),'utf8').replace(/export \{[^}]+\};?/,'');
const js=fs.readFileSync(path.join(here,'online.js'),'utf8').replace(/\/\*__ONLINE_SCHEMA_START__\*\/[^]*?\/\*__ONLINE_SCHEMA_END__\*\//,'/*__ONLINE_SCHEMA_START__*/\n'+schema+'/*__ONLINE_SCHEMA_END__*/').replace("const ONLINE_API_BASE='';",`const ONLINE_API_BASE=${JSON.stringify(apiBase)};`);
const css=fs.readFileSync(path.join(here,'online.css'),'utf8');
const start=html.indexOf('/* ============================== ONLINE ============================== */');
const boot=html.indexOf('/* ============================== BOOT ============================== */',start);
const cssStart=html.indexOf('/* ---------- online ---------- */'),cssEnd=html.indexOf('</style>',cssStart);
if(start<0||boot<0||cssStart<0||cssEnd<0)throw new Error('Incomplete online build markers');
html=html.slice(0,start)+js+html.slice(boot);
html=html.slice(0,cssStart)+css+html.slice(cssEnd);
fs.writeFileSync(out,html);console.log(`wrote ${out}`);
