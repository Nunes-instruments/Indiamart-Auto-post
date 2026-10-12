// ==UserScript==
// @name         NUNES IndiaMART Scanner V7 + Live Audit Dashboard
// @namespace    https://www.nunesinstruments.com/
// @version      7.0.0
// @description  Read-only SF/image scanner with live NUNES dashboard sync, CSV export and diagnostics.
// @match        https://seller.indiamart.com/*
// @match        https://www.seller.indiamart.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
 'use strict';
 // The wide @match above handles trailing slashes, query parameters and changed IndiaMART routing.
 // Never run on unrelated seller pages.
 if (!/\/product\/manageproducts\b/i.test(location.pathname)) return;
 if (document.getElementById('nunes-scanner-v62')) return;

 const ACCOUNTS = [
  'Krishna Moorthi — Instrumentation',
  'Mohammed Khan — Nunes Instrumentation',
  'SF Nunes — Nunes Instruments'
 ];
 const DATA_KEY='NUNES_IM_SCANNER_V62_DATA', RUN_KEY='NUNES_IM_SCANNER_V62_SESSION';
 const SF_RE=/\bSF[\s_-]*\d{4,}\b/gi;
 const tidy=s=>String(s??'').replace(/\s+/g,' ').trim();
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const visible=el=>!!(el?.isConnected && el.getClientRects().length);
 const get=(k,d)=>{try{const v=GM_getValue(k);if(v!==undefined)return v;}catch{}try{return JSON.parse(localStorage.getItem(k))??d;}catch{return d;}};
 const put=(k,d)=>{try{GM_setValue(k,d);return true;}catch{}try{localStorage.setItem(k,JSON.stringify(d));return true;}catch{return false;}};
 const getSession=()=>{try{return JSON.parse(sessionStorage.getItem(RUN_KEY))||{};}catch{return {};}};
 let db=get(DATA_KEY,{});
 if(!db || typeof db!=='object' || Array.isArray(db))db={};
 const run=Object.assign({account:'',phase:'Active',page:1,running:false,paused:false,includeInactive:true,rule:null},getSession());
 if(!ACCOUNTS.includes(run.account)){run.account='';run.running=false;run.rule=null;}
 let iteration=0, picking=false, settleTimer=null, currentError='';
 const records=()=>db[run.account] ||= {};
 const persist=()=>{const ok=put(DATA_KEY,db);try{sessionStorage.setItem(RUN_KEY,JSON.stringify(run));}catch{}return ok;};

 const host=document.createElement('div');
 host.id='nunes-scanner-v62';
 host.style.cssText='position:fixed;right:12px;bottom:12px;z-index:2147483647;pointer-events:auto';
 document.body.appendChild(host);
 const root=host.attachShadow({mode:'open'});
 root.innerHTML=`<style>
  *{box-sizing:border-box} .panel{background:#fff;color:#17283c;border:1px solid #bfcedf;border-radius:12px;box-shadow:0 10px 35px #17283c55;font:12px/1.4 Arial,sans-serif;width:min(430px,calc(100vw - 20px));overflow:hidden}
  .head{background:#14345b;color:white;padding:11px 12px;display:flex;justify-content:space-between;gap:10px;align-items:center}.head strong{font-size:15px}.body{padding:10px 12px}.hidden .body{display:none}
  button,select,input{font:inherit;border:1px solid #b6c8de;border-radius:6px;color:#163052;background:#f5f8fc;padding:7px;max-width:100%}button{cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}.head button{padding:3px 9px}
  select{width:100%;margin:5px 0}.buttons{display:flex;gap:5px;flex-wrap:wrap;margin:10px 0}.buttons button{font-weight:bold}.primary{background:#087c5c;color:#fff;border-color:#087c5c}.danger{background:#fff0d8}
  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:8px 0}.stats div{background:#f2f6fa;border:1px solid #e2eaf1;border-radius:7px;text-align:center;padding:6px 2px}.stats b{font-size:19px;display:block}.stats small{font-size:10px}
  #status{background:#edf4fc;white-space:pre-wrap;max-height:95px;overflow:auto;padding:8px;border-radius:6px;font-size:11px}.detail{font-size:11px;margin:5px 0;color:#54677c}
  table{width:100%;border-collapse:collapse;font-size:11px}th,td{border-bottom:1px solid #e4ecf5;padding:5px;text-align:left;vertical-align:top}th{background:#eef3f9;position:sticky;top:0}.table{max-height:160px;overflow:auto;border:1px solid #e2ebf5;border-radius:6px}
  .check{display:flex;align-items:center;gap:4px;margin:6px 0}.check input{margin:0}.small{font-size:10px;color:#64788d}.filter{display:flex;gap:6px}.filter select{width:41%}.filter input{flex:1;width:55%;min-width:0}
  </style><div class="panel" id="panel"><div class="head"><strong>NUNES ⚡ Scanner V7 LIVE</strong><button id="min">−</button></div><div class="body">
   <div>Select the seller account currently logged in:</div><select id="account"><option value="">— Select account —</option>${ACCOUNTS.map(a=>`<option value="${escape(a)}">${escape(a)}</option>`).join('')}</select>
   <label class="check"><input type="checkbox" id="inactive" checked> Also scan Inactive listings</label>
   <div class="stats"><div><b id="total">0</b><small>Scanned products</small></div><div><b id="sf">0</b><small>With SF</small></div><div><b id="plain">0</b><small>Name only</small></div><div><b id="withImage">0</b><small>With image</small></div><div><b id="withoutImage">0</b><small>No image detected</small></div><div><b id="imageTotal">0</b><small>Card images</small></div></div>
   <div class="buttons"><button id="start" class="primary">▶ Start Auto</button><button id="stop" class="danger">■ Stop</button><button id="pick">⌖ Pick Title</button><button id="csv">↓ CSV</button><button id="csvall">↓ All CSV</button><button id="copy">Copy CSV</button><button id="diagnose">Check Page</button><button id="reset">Reset</button></div>
   <div id="status">Choose account. Read-only: will NOT edit prices, names, or images.</div><div class="detail" id="details"></div><div class="detail" id="allTotals"></div>
   <div class="filter"><select id="filter"><option value="all">All products</option><option value="sf">With SF</option><option value="plain">Name only</option><option value="noimage">No image detected</option></select><input id="query" placeholder="Search names / SF code"></div>
   <div class="table"><table><thead><tr><th>Product name</th><th>SF</th><th>Image</th></tr></thead><tbody id="rows"></tbody></table></div>
   <div class="small">Live figures count detected list cards only. A zero-image result means no recognizable listing thumbnail, not proof the product has no gallery photos. Scan all pages for a final total.</div>
  </div></div>`;
 const $=id=>root.getElementById(id);
 $('account').value=run.account;
 $('inactive').checked=run.includeInactive;
 const say=s=>{$('status').textContent=s;};
 function stats(){const rows=Object.values(run.account?records():{});return {total:rows.length,sf:rows.filter(r=>!!r.sf).length,plain:rows.filter(r=>!r.sf).length,withImage:rows.filter(r=>r.images.length>0).length,withoutImage:rows.filter(r=>!r.images.length).length,imageTotal:rows.reduce((n,r)=>n+r.images.length,0)};}
 function render(){const s=stats();for(const [key,val] of Object.entries(s))$(key).textContent=val.toLocaleString('en-IN');$('start').disabled=run.running||!run.account;$('stop').disabled=!run.running;
  $('details').textContent=`${run.phase}, page ${run.page} · ${run.running?'SCANNING':run.paused?'PAUSED':'READY'} · ${Object.keys(db).filter(k=>Object.keys(db[k]||{}).length).length} account(s) with data`;
  $('allTotals').textContent=ACCOUNTS.map(a=>a.split(' — ')[0]+': '+Object.keys(db[a]||{}).length).join('  ·  ');
  const q=tidy($('query').value).toLowerCase(),filter=$('filter').value;
  const rows=Object.values(run.account?records():{}).filter(r=>(!q||[r.name,r.sf,r.clean].some(v=>String(v).toLowerCase().includes(q)))&&(filter==='all'||filter==='sf'&&r.sf||filter==='plain'&&!r.sf||filter==='noimage'&&!r.images.length)).sort((a,b)=>b.at-a.at).slice(0,80);
  $('rows').innerHTML=rows.map(r=>`<tr><td>${escape(r.name)}</td><td>${escape(r.sf||'—')}</td><td>${r.images.length?'✓':'—'}</td></tr>`).join('')||'<tr><td colspan="3">No products recorded</td></tr>';
 }
 function textOf(el){return tidy(el?.innerText||el?.textContent||el?.getAttribute?.('title')||'');}
 function isName(text){return text.length>=4&&text.length<=220&&!/^(edit|save|delete|product name|manage products|category|group|score|add product|view more|next|inactive|active|image|add|price)$/i.test(text)&&!/^[₹$€0-9\s.,/-]+$/.test(text);}
 function tagPath(ancestor,element){const parts=[];let el=element;
  while(el&&el!==ancestor&&parts.length<11){const sib=[...el.parentElement.children].filter(x=>x.tagName===el.tagName);parts.unshift(el.tagName.toLowerCase()+(sib.length>1?`:nth-of-type(${sib.indexOf(el)+1})`:''));el=el.parentElement;}
  return el===ancestor?parts.join(' > '):null;
 }
 function selectorOf(el){const tag=el.tagName.toLowerCase();const cls=[...el.classList].filter(c=>/^[a-zA-Z_][a-zA-Z_0-9-]{2,60}$/.test(c)&&!/(^active$|^selected$|^hover$)/i.test(c));
  // Use actual class names found in the page, not invented IndiaMART selectors.
  return tag+(cls.length?'.'+CSS.escape(cls[0])+(cls.length>1?'.'+CSS.escape(cls[1]):''):'');
 }
 function isInHost(el){return host===el||host.contains(el);}
 function candidateCard(titleEl){const proposed=[];
  for(let p=titleEl.parentElement,depth=0;p&&p!==document.body&&depth<10;p=p.parentElement,depth++){
   if(isInHost(p))continue;
   const path=tagPath(p,titleEl);if(!path)continue;
   const name=textOf(titleEl);const size=textOf(p).length;
   if(size<name.length+5||size>5500)continue; // Reject name-only wrappers and full-page containers.
   const sel=selectorOf(p);
   let matches=[];try{matches=[...document.querySelectorAll(sel)].filter(x=>!isInHost(x)&&x.querySelector(path)&&isName(textOf(x.querySelector(path))));}catch{continue;}
   if(!matches.length||matches.length>350)continue;
   const withMedia=matches.filter(x=>x.querySelector('img,picture,video,[style*="background-image" i]')).length;
   const withMeta=matches.filter(x=>/\b(category|group|score|price|specification)\b|₹/i.test(textOf(x))||x.querySelector('button,[role="button"]')).length;
   const repeat=matches.length>=2?25:0;
   const score=repeat+(withMedia?18:0)+(withMeta?12:0)+(/product|card|listing|item/i.test(sel)?15:0)+Math.min(matches.length,25)-depth*2-(size>2400?25:0);
   proposed.push({selector:sel,path,score,seen:matches.length,cardSize:size,withMedia,withMeta});
  }
  proposed.sort((a,b)=>b.score-a.score);
  const winner=proposed.find(x=>(x.seen>=2&&(x.withMedia||x.withMeta))||(x.seen===1&&x.withMedia&&x.withMeta));
  return winner||null;
 }
 function pickTitleNode(target){let el=target.nodeType===1?target:target.parentElement;
  for(let d=0;el&&d<5;el=el.parentElement,d++){
   if(el.matches?.('a, [class*="name" i], [class*="title" i],h3,h4,h5')&&isName(textOf(el)))return el;
   if(d===0&&isName(textOf(el)))return el;
  }return null;
 }
 function titlePairs(){if(!run.rule)return [];
  try{return [...document.querySelectorAll(run.rule.selector)].filter(el=>!isInHost(el)).map(card=>({card,title:card.querySelector(run.rule.path)})).filter(({title})=>title&&isName(textOf(title)));}catch{return [];}
 }
 function autoDetect(){if(run.rule&&titlePairs().length)return true;
  const queries=['[data-testid*="product-name" i]','[data-testid*="product-title" i]','[class*="productName" i]','[class*="product-name" i]','[class*="product_title" i]','[class*="productTitle" i]','[class*="prodName" i]','[class*="item-name" i]','[class*="title" i]','a[title]','h3','h4','h5','a[href]','strong' ];
  let best=null;
  for(const q of queries){let matches=[];try{matches=[...document.querySelectorAll(q)].filter(el=>!isInHost(el)&&visible(el)&&isName(textOf(el))).slice(0,85);}catch{}
   matches.sort((a,b)=>Number(/\bSF[\s_-]*\d{4,}\b/i.test(textOf(b)))-Number(/\bSF[\s_-]*\d{4,}\b/i.test(textOf(a))));
   for(const el of matches.slice(0,14)){const r=candidateCard(el);if(r&&(!best||r.score>best.score))best=r;}
  }
  if(best){run.rule={selector:best.selector,path:best.path};persist();return titlePairs().length>0;}
  return false;
 }
 function pick(e){if(!picking||isInHost(e.target))return;
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();picking=false;document.removeEventListener('click',pick,true);
  const original=pickTitleNode(e.target);
  const tryNodes=[];for(let el=original,i=0;el&&i<3;el=el.parentElement,i++)if(isName(textOf(el)))tryNodes.push(el);
  let choice=null;for(const el of tryNodes){const r=candidateCard(el);if(r&&(!choice||r.score>choice.score))choice=r;}
  if(!choice){say('The clicked title was not inside a recognizable product card. Click Pick Title again, then click the actual product-name text.');return;}
  run.rule={selector:choice.selector,path:choice.path};persist();scan();say(`Title learned! Found ${titlePairs().length} matching product cards. Click Start Auto.`);
 }
 function classify(name){const codes=[...name.matchAll(SF_RE)].map(m=>m[0].replace(/[\s_-]/g,'').toUpperCase());return {sf:[...new Set(codes)].join('; '),clean:tidy(name.replace(SF_RE,' ').replace(/\s*[-–—|:,]\s*$/,''))||name};}
 function images(card){const out=new Set();for(const img of card.querySelectorAll('img')){
  const sources=[img.getAttribute('data-src'),img.getAttribute('data-original'),img.getAttribute('data-lazy-src'),img.getAttribute('srcset')?.split(',')[0]?.trim()?.split(' ')[0],img.currentSrc,img.getAttribute('src')].filter(Boolean);
  const src=sources.find(s=>!/^about:|^blob:|^data:image\/svg|placeholder|no-?image|default[_-]?image/i.test(s))||'';
  if(!src)continue;
  const size=Math.max(img.naturalWidth||0,img.naturalHeight||0,img.width||0,img.height||0,Number(img.getAttribute('width'))||0,Number(img.getAttribute('height'))||0);
  if(size<40&&!/imimg\.com|cloudinary|product|catalog|image/i.test(src))continue;
  if(/^data:image\/(png|jpeg|webp)/i.test(src)){out.add('Embedded product image');continue;}
  try{const u=new URL(src,location.href);if(/^https?:$/.test(u.protocol))out.add(u.href);}catch{}
 }
  // Some cards use CSS thumbnail backgrounds rather than <img> elements.
  for(const el of [card,...card.querySelectorAll('[style*="background-image" i]')]){
   const bg=el.style?.backgroundImage||'';const m=bg.match(/url\(["']?([^"')]+)["']?\)/i);if(m){try{const u=new URL(m[1],location.href);if(/^https?:$/.test(u.protocol))out.add(u.href);}catch{}}
  }
  return [...out];
 }
 function linkOf(card,title){const a=title.closest('a[href]')||card.querySelector('a[href*="product" i]');
  if(!a)return '';const raw=a.getAttribute('href')||'';if(!raw||raw==='#'||/^javascript:/i.test(raw))return '';
  try{const u=new URL(raw,location.href);if(u.origin===location.origin&&u.pathname===location.pathname&&!u.search)return '';return /^https?:$/.test(u.protocol)?u.href:'';}catch{return '';}
 }
 function scan(){if(!run.account)return 0;let pairs=titlePairs();if(!pairs.length&&autoDetect())pairs=titlePairs();if(!pairs.length)return 0;
  const seen=new Map(),rs=records();let changed=0;
  for(const {card,title} of pairs){const name=textOf(title);if(!isName(name))continue;
   const classif=classify(name),photos=images(card),href=linkOf(card,title),pid=card.getAttribute('data-product-id')||card.getAttribute('data-id')||card.getAttribute('data-item-id')||'';
   const n=(seen.get(name)||0)+1;seen.set(name,n);
   // A stable product ID or real listing link deduplicates repeated scans; otherwise preserve page and occurrence.
   const key=[run.phase, pid?`id:${pid}`:href?`url:${href}`:`p${run.page}:${name}:${n}`].join('::');
   const old=rs[key];if(old&&old.name===name&&old.sf===classif.sf&&old.clean===classif.clean&&old.images.join('|')===photos.join('|'))continue;
   rs[key]={name,sf:classif.sf,clean:classif.clean,images:photos,url:href,page:run.page,phase:run.phase,at:Date.now()};changed++;
  }
  if(changed){if(!persist()&&!currentError){currentError='Browser storage write failed; export your results before closing.';say(currentError);}render();}
  return changed;
 }
 function scrollElement(){const el=titlePairs()[0]?.card;
  for(let p=el?.parentElement;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p);if(/auto|scroll/.test(s.overflowY)&&p.scrollHeight>p.clientHeight+70)return p;}
  return document.scrollingElement||document.documentElement;
 }
 function scrollDown(){const p=scrollElement();const before=p.scrollTop,step=Math.max(350,Math.round((p.clientHeight||innerHeight)*.83));
  if(p===document.scrollingElement){window.scrollBy(0,step);}else{p.scrollTop=Math.min(p.scrollHeight-p.clientHeight,p.scrollTop+step);}
  return p.scrollTop>before+3;
 }
 function scrollTop(){const p=scrollElement();if(p===document.scrollingElement)window.scrollTo(0,0);else p.scrollTop=0;}
 function control(kind){const ctrls=[...document.querySelectorAll('a,button,[role="button"],[role="tab"],input[type="button"]')].filter(el=>!isInHost(el)&&visible(el)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&!el.closest('[disabled], [aria-disabled="true"]')&&!/disabled/i.test(String(el.className)));
  const label=el=>tidy([el.getAttribute('aria-label'),el.getAttribute('title'),el.textContent,el.value].filter(Boolean).join(' '));
  if(kind==='more')return ctrls.find(el=>/^(load more|show more products|view more products)$/i.test(label(el)));
  if(kind==='next'){
   const named=ctrls.find(el=>{
    const txt=label(el);const inNav=!!el.closest('nav,[class*="paginat" i],[aria-label*="paginat" i]');
    return el.getAttribute('rel')==='next'||(inNav&&(/\b(next|next page)\b/i.test(txt)||/^(›|»|>|→|❯|⟩)$/.test(txt)||(/right|arrow-next|chevron-right/i.test(String(el.className))&&(!txt||txt.length<15))));
   });
   return named||ctrls.find(el=>!!el.closest('nav,[class*="paginat" i],[aria-label*="paginat" i]')&&label(el)===String(run.page+1));
  }
  if(kind==='Inactive')return ctrls.find(el=>/\binactive\b/i.test(label(el))&&!/activate all/i.test(label(el))&&(el.getAttribute('role')==='tab'||el.closest('[role="tablist"],[class*="tab" i]')));
  return null;
 }
 function activePhase(){const selected=[...document.querySelectorAll('[role="tab"][aria-selected="true"], [role="tab"][data-state="active"]')];const t=selected.map(textOf).join(' ');if(/\binactive\b/i.test(t))return 'Inactive';if(/\bactive\b/i.test(t))return 'Active';return run.phase;}
 function signature(){const titles=titlePairs().map(p=>textOf(p.title));return JSON.stringify([location.href,titles.length,titles.slice(0,3),titles.slice(-3)]);}
 async function waitChange(sig,t){for(let i=0;i<36&&run.running&&t===iteration;i++){await wait(250);if(titlePairs().length&&signature()!==sig)return true;}return false;}
 function finish(message){run.running=false;run.paused=false;persist();scan();render();say(message);}
 async function loop(t){if(!autoDetect()&&!titlePairs().length){finish('Product titles could not be detected automatically. Click Pick Title, then click one actual product name.');return;}
  let hops=0;while(run.running&&t===iteration&&hops<250){
   if(!titlePairs().length){finish('Product list disappeared or changed layout. Use Pick Title again, then Start Auto.');return;}
   say(`Scanning ${run.account}\n${run.phase}, page ${run.page}. Live count updates as items are seen.`);
   let stall=0,scrollHops=0;
   while(run.running&&t===iteration&&stall<4&&scrollHops<450){const newNow=scan(),moved=scrollDown();await wait(320);const added=scan();if(newNow||added||moved)stall=0;else stall++;scrollHops++;}
   if(!run.running||t!==iteration)return;scan();hops++;
   if(scrollHops>=450){finish('Stopped after 450 scroll steps. Export and inspect this page before continuing.');return;}
   const more=control('more');if(more){const sig=signature();more.click();if(await waitChange(sig,t)){continue;}finish('Load More did not produce new visible titles; stopped to avoid incorrect final counts.');return;}
   const next=control('next');if(next){const sig=signature();run.page++;persist();next.click();if(await waitChange(sig,t)){scrollTop();continue;}run.page--;finish('Next page could not be verified. Counts are partial. Check pagination manually.');return;}
   if(run.includeInactive&&run.phase==='Active'){
    const tab=control('Inactive');if(!tab){finish('Active scanning reached last detected page. Inactive tab NOT found; check it manually.');return;}
    const sig=signature();run.phase='Inactive';run.page=1;persist();tab.click();if(await waitChange(sig,t)){scrollTop();continue;}
    finish('Active list scanned. Inactive tab did not load distinct products; scan Inactive manually.');return;
   }
   finish('Reached last detected page. Export CSV. Verify listed totals with IndiaMART before treating as an exact full-account count.');return;
  }
  if(hops>=250)finish('250-page safety limit reached; export partial results.');
 }
 function stop(){run.running=false;run.paused=true;iteration++;persist();render();say('Stopped. Current results are saved; Resume with Start Auto.');}
 function report(allAccounts=false){const rows=[['Account','Listing status','Product Name','SF Code','Product Name without SF','Name Type','Card image count','Image URLs','Product link','Page']];
  for(const [account,obj]of Object.entries(db))for(const v of Object.values(obj||{}))rows.push([account,v.phase,v.name,v.sf,v.clean,v.sf?'With SF':'Name only',v.images.length,v.images.join(' | '),v.url,v.page]);
  const filtered=rows.slice(1).filter(r=>allAccounts||r[0]===run.account);
  const selected=[rows[0],...filtered];
  return selected.map(row=>row.map(val=>'"'+String(val??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
 }
 function exportCsv(allAccounts=false){scan();if(!run.account||(allAccounts?!Object.values(db).some(obj=>Object.keys(obj||{}).length):!Object.keys(records()).length)){say('No products scanned yet. Select the account and scan.');return;}
  const csv='\uFEFF'+report(allAccounts),u=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=u;a.download='NUNES_IndiaMART_'+(allAccounts?'ALL_ACCOUNTS':run.account.replace(/[^a-z0-9]+/gi,'_'))+'_V6_2.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),12000);say(`Created ${allAccounts?'all-accounts':'current-account'} CSV. If browser blocks download, click Copy CSV (current account).`);
 }
 async function copyCsv(){scan();if(!run.account||!Object.keys(records()).length){say('Nothing to copy yet.');return;}
  const csv=report();try{await navigator.clipboard.writeText(csv);say(`Copied ${stats().total} rows. Paste into Excel or Notepad.`);return;}catch{}
  const field=document.createElement('textarea');field.value=csv;field.style.cssText='position:fixed;left:2px;top:2px;opacity:.01';document.body.append(field);field.select();const copied=document.execCommand('copy');field.remove();say(copied?`Copied ${stats().total} rows. Paste into Excel.`:'Clipboard permission blocked. Use CSV export or Chrome browser clipboard permission.');
 }
 function diagnostic(){const els=document.querySelectorAll('img').length,manual=titlePairs().length;const guess=manual||autoDetect();const count=titlePairs().length;
  const message=`Page: ${location.pathname}\nProduct titles recognized: ${count}\nImages on entire page: ${els}\nRule: ${guess?run.rule.selector+' → '+run.rule.path:'NONE'}\n${count?'Ready. Start Auto to scan.':'Click Pick Title and choose a real product name. If no panel appears, verify Tampermonkey is enabled on this URL.'}`;
  scan();say(message);render();
 }
 $('account').onchange=e=>{stop();run.account=e.target.value;run.rule=null;run.page=1;run.phase='Active';run.paused=false;persist();render();say(run.account?'Account selected. Click Check Page, then Start Auto.':'Select account first.');};
 $('inactive').onchange=e=>{run.includeInactive=e.target.checked;persist();};
 $('pick').onclick=()=>{picking=true;document.addEventListener('click',pick,true);say('Now click exactly on ONE product title shown in the IndiaMART list. Click is intercepted; nothing will open.');};
 $('start').onclick=()=>{if(!run.account||run.running)return;if(!run.paused){run.phase=activePhase();run.page=1;}run.running=true;run.paused=false;persist();render();loop(++iteration).catch(e=>finish('Stopped on script error: '+e.message));};
 $('stop').onclick=stop;$('diagnose').onclick=diagnostic;$('csv').onclick=()=>exportCsv(false);$('csvall').onclick=()=>exportCsv(true);$('copy').onclick=copyCsv;
 $('filter').onchange=render;$('query').oninput=render;
 $('reset').onclick=()=>{if(!run.account||!confirm('Clear saved scan for this account?'))return;stop();db[run.account]={};persist();run.page=1;run.phase='Active';run.paused=false;persist();render();say('Results cleared for this account only.');};
 $('min').onclick=()=>{$('panel').classList.toggle('hidden');$('min').textContent=$('panel').classList.contains('hidden')?'+':'−';};
 const observer=new MutationObserver(mutations=>{if(!run.account||!mutations.some(x=>!isInHost(x.target)))return;clearTimeout(settleTimer);settleTimer=setTimeout(scan,250);});
 observer.observe(document.body,{subtree:true,childList:true,characterData:true});
 addEventListener('scroll',()=>{clearTimeout(settleTimer);settleTimer=setTimeout(scan,180);},{passive:true});
 render();
 if(run.running&&run.account){setTimeout(()=>loop(++iteration).catch(e=>finish('Stopped: '+e.message)),650);}
 else if(run.account)setTimeout(scan,600);

 // NUNES dashboard bridge: opt-in, browser-to-browser, no credentials or server upload.
 const DASHBOARD_URL='https://nunes-indiamart-audit.vercel.app/';
 const DASHBOARD_ORIGIN=new URL(DASHBOARD_URL).origin;
 let dashboardTab=null,lastPush='',lastPushTime=0;
 const dashboardButton=document.createElement('button');
 dashboardButton.textContent='↗ Dashboard';
 dashboardButton.title='Open the live audit console. Scanned rows are sent only to that tab.';
 $('start').parentElement.appendChild(dashboardButton);
 function publishAudit(force=false){
  if(!dashboardTab||dashboardTab.closed||!run.account)return;
  const entries=Object.entries(db[run.account]||{});
  const maxAt=entries.reduce((v,[,r])=>Math.max(v,Number(r.at)||0),0);
  const status=$('status').textContent;
  const signature=[run.account,entries.length,maxAt,run.phase,run.page,run.running,run.paused,status].join('|');
  if(!force&&signature===lastPush)return;
  if(!force&&Date.now()-lastPushTime<1200)return;
  const rows=entries.map(([scanKey,r])=>({...r,scanKey}));
  const completed=/Reached last detected page/i.test(status);
  try{
   dashboardTab.postMessage({type:'NUNES_AUDIT_SCAN_V7',account:run.account,rows,
     session:{completed,running:run.running,phase:run.phase,page:run.page}},DASHBOARD_ORIGIN);
   lastPush=signature;lastPushTime=Date.now();
  }catch(e){say('Dashboard sync error: '+e.message+'; use CSV export instead.');}
 }
 dashboardButton.onclick=()=>{
  dashboardTab=window.open(DASHBOARD_URL,'nunes_indiamart_audit');
  if(!dashboardTab){say('Popup was blocked. Allow popups for IndiaMART and retry Dashboard.');return;}
  lastPush='';setTimeout(()=>publishAudit(true),1100);
 };
 window.addEventListener('message',event=>{
  if(event.origin!==DASHBOARD_ORIGIN||event.data?.type!=='NUNES_AUDIT_READY_V7')return;
  if(dashboardTab&&event.source!==dashboardTab)return;
  dashboardTab=event.source;publishAudit(true);
 });
 setInterval(()=>{if(dashboardTab&&!dashboardTab.closed)publishAudit();},1700);
})();