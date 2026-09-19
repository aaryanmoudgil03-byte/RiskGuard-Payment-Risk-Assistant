const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

// Demo history used by the adaptive baseline. In production, replace this with your DB/event stream.
const history = [
  {id:'TX-94817', amount:1250, recipient:'Vertex Pay', recipientId:'ACC-102', device:'iPhone 15', location:'London, UK', timestamp:'2026-09-19T14:12:00Z', qr:false, message:'Rent payment'},
  {id:'TX-94816', amount:980, recipient:'Vertex Pay', recipientId:'ACC-102', device:'iPhone 15', location:'London, UK', timestamp:'2026-09-19T13:42:00Z', qr:false, message:'Monthly bill'},
  {id:'TX-94815', amount:1120, recipient:'Vertex Pay', recipientId:'ACC-102', device:'iPhone 15', location:'London, UK', timestamp:'2026-09-18T16:08:00Z', qr:false, message:'Bill'},
  {id:'TX-94814', amount:850, recipient:'Coffee House', recipientId:'ACC-221', device:'iPhone 15', location:'London, UK', timestamp:'2026-09-18T09:18:00Z', qr:true, message:'Coffee'},
  {id:'TX-94813', amount:1450, recipient:'Vertex Pay', recipientId:'ACC-102', device:'iPhone 15', location:'London, UK', timestamp:'2026-09-17T15:21:00Z', qr:false, message:'Rent'},
  {id:'TX-94812', amount:720, recipient:'Metro Store', recipientId:'ACC-334', device:'iPhone 15', location:'London, UK', timestamp:'2026-09-17T12:02:00Z', qr:true, message:'Groceries'},
  {id:'TX-94811', amount:1300, recipient:'Vertex Pay', recipientId:'ACC-102', device:'iPhone 15', location:'London, UK', timestamp:'2026-09-16T17:43:00Z', qr:false, message:'Monthly bill'},
  {id:'TX-94810', amount:910, recipient:'Vertex Pay', recipientId:'ACC-102', device:'iPhone 15', location:'London, UK', timestamp:'2026-09-16T10:33:00Z', qr:false, message:'Bill'},
  {id:'TX-94809', amount:1180, recipient:'Coffee House', recipientId:'ACC-221', device:'iPhone 15', location:'London, UK', timestamp:'2026-09-15T08:54:00Z', qr:true, message:'Coffee'},
  {id:'TX-94808', amount:1020, recipient:'Vertex Pay', recipientId:'ACC-102', device:'iPhone 15', location:'London, UK', timestamp:'2026-09-15T14:14:00Z', qr:false, message:'Rent'},
  {id:'TX-94807', amount:760, recipient:'Metro Store', recipientId:'ACC-334', device:'iPhone 15', location:'London, UK', timestamp:'2026-09-14T11:19:00Z', qr:true, message:'Groceries'},
  {id:'TX-94806', amount:1350, recipient:'Vertex Pay', recipientId:'ACC-102', device:'iPhone 15', location:'London, UK', timestamp:'2026-09-13T16:04:00Z', qr:false, message:'Rent'}
];

const live = [
  {id:'TX-94821', amount:124500, recipient:'Acme Corp', recipientId:'ACC-992', device:'Android emulator', location:'Lagos, NG', previousLocation:'Berlin, DE', risk:96, flags:['QR bypass','VPN mismatch'], status:'critical', message:'Urgent invoice — pay now'},
  {id:'TX-94820', amount:45000, recipient:'Stellar Tech Ltd', recipientId:'ACC-441', device:'Android emulator', location:'London, UK', previousDevice:'iPhone 15', risk:68, flags:['Device mutation'], status:'suspicious', message:'Confirm account today'},
  {id:'TX-94819', amount:1250, recipient:'Vertex Pay', recipientId:'ACC-102', device:'iPhone 15', location:'London, UK', risk:12, flags:[], status:'normal', message:'Monthly bill'},
  {id:'TX-94818', amount:89000, recipient:'Nexus Capital', recipientId:'ACC-883', device:'iPhone 15', location:'Zurich, CH', previousLocation:'Tokyo, JP', risk:92, flags:['Velocity spike','Location shift'], status:'critical', message:'QR payment request'},
  {id:'TX-94817', amount:5600, recipient:'Metro Store', recipientId:'ACC-334', device:'iPhone 15', location:'London, UK', risk:28, flags:[], status:'normal', message:'Groceries'}
];

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'Access-Control-Allow-Origin':'*'});
  res.end(body);
}
function parseBody(req) {
  return new Promise((resolve,reject)=>{
    let body='';
    req.on('data', c=>{ body += c; if(body.length>1e6) req.destroy(); });
    req.on('end', ()=>{ try { resolve(body ? JSON.parse(body) : {}); } catch(e){ reject(e); } });
    req.on('error', reject);
  });
}
function mean(xs){ return xs.reduce((a,b)=>a+b,0)/(xs.length||1); }
function std(xs){ const m=mean(xs); return Math.sqrt(mean(xs.map(x=>(x-m)**2))) || 1; }
function riskLabel(score){ return score>=85?'CRITICAL':score>=55?'SUSPICIOUS':'NORMAL'; }
function clamp(x,a=0,b=100){ return Math.max(a,Math.min(b,x)); }
function tokenize(s){ return String(s||'').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }

function analyze(tx) {
  const amounts = history.map(x=>x.amount);
  const avg = mean(amounts), sigma = std(amounts);
  const z = Math.abs((Number(tx.amount)-avg)/sigma);
  const recipientHistory = history.filter(x=>x.recipientId===tx.recipientId);
  const recipientKnown = recipientHistory.length > 0;
  const deviceKnown = history.some(x=>x.device===tx.device);
  const locationKnown = history.some(x=>x.location===tx.location);
  const recentCount = history.filter(x=>Date.now()-new Date(x.timestamp).getTime() < 24*3600*1000).length;
  const reasons=[];
  let score=8;
  if(!recipientKnown){ score+=22; reasons.push({title:'New recipient', detail:'No prior payment relationship was found for this recipient.', weight:22}); }
  else score += 4;
  if(z>3){ score+=30; reasons.push({title:'Amount is far outside your baseline', detail:`₹${Number(tx.amount).toLocaleString()} is about ${z.toFixed(1)} standard deviations from recent behavior.`, weight:30}); }
  else if(z>1.8){ score+=16; reasons.push({title:'Unusual amount', detail:'The payment is materially larger or smaller than your normal transaction pattern.', weight:16}); }
  if(!deviceKnown){ score+=18; reasons.push({title:'New device fingerprint', detail:'This device has not appeared in the observed payment history.', weight:18}); }
  if(!locationKnown){ score+=15; reasons.push({title:'Location change', detail:'The payment location differs from locations in your normal activity.', weight:15}); }
  if(tx.previousLocation && tx.previousLocation!==tx.location){ score+=10; reasons.push({title:'Rapid location shift', detail:`Recent activity moved from ${tx.previousLocation} to ${tx.location}.`, weight:10}); }
  if(tx.qr){ score+=8; reasons.push({title:'QR payment request', detail:'QR-originated payments receive extra scrutiny when combined with other anomalies.', weight:8}); }
  const suspiciousWords=['urgent','verify','refund','gift','investment','unlock','fee','confirm','crypto','immediately','password'];
  const hits=tokenize(tx.message).filter(w=>suspiciousWords.includes(w));
  if(hits.length){ score+=Math.min(16,hits.length*8); reasons.push({title:'Message contains pressure or financial-risk language', detail:`Detected terms: ${[...new Set(hits)].join(', ')}.`, weight:Math.min(16,hits.length*8)}); }
  if(tx.velocity && tx.velocity > 3){ score+=18; reasons.push({title:'Velocity spike', detail:`Payment frequency is ${tx.velocity}× the learned recent pattern.`, weight:18}); }
  if(recipientHistory.length>=3){ reasons.push({title:'Recipient relationship is established', detail:`${recipientHistory.length} previous payments to this recipient were found.`, weight:-4}); }
  score=clamp(Math.round(score));
  const label=riskLabel(score);
  const action=score>=85?'BLOCK & VERIFY RECIPIENT':score>=55?'PAUSE & INSPECT':'APPROVE WITH STANDARD CHECKS';
  return {score,label,action,reasons,baseline:{average:Math.round(avg),stdDev:Math.round(sigma),recipientPayments:recipientHistory.length,knownDevice:deviceKnown,knownLocation:locationKnown,recent24h:recentCount}};
}

function graphData(){
  const nodes=[
    {id:'A-1042',label:'Account A-1042',type:'account',risk:91},
    {id:'A-7710',label:'Account A-7710',type:'account',risk:84},
    {id:'A-9921',label:'Account A-9921',type:'account',risk:78},
    {id:'A-2301',label:'Account A-2301',type:'account',risk:18},
    {id:'D-44',label:'Android emulator',type:'device',risk:90},
    {id:'D-15',label:'iPhone 15',type:'device',risk:12},
    {id:'R-883',label:'Nexus Capital',type:'recipient',risk:88},
    {id:'R-441',label:'Stellar Tech Ltd',type:'recipient',risk:72}
  ];
  const edges=[
    {source:'A-1042',target:'D-44',label:'shared device',risk:92},
    {source:'A-7710',target:'D-44',label:'shared device',risk:92},
    {source:'A-9921',target:'D-44',label:'shared device',risk:92},
    {source:'A-1042',target:'R-883',label:'paid',risk:88},
    {source:'A-7710',target:'R-883',label:'paid',risk:86},
    {source:'A-9921',target:'R-441',label:'paid',risk:74},
    {source:'A-2301',target:'D-15',label:'owns device',risk:10}
  ];
  return {nodes,edges,clusters:[{name:'Shared emulator cluster',members:['A-1042','A-7710','A-9921','D-44'],signal:'3 accounts linked by one device fingerprint',risk:94}]};
}

function serveStatic(req,res){
  let pathname = url.parse(req.url).pathname;
  if(pathname==='/' || pathname==='/index.html') pathname='/index.html';
  const safe=path.normalize(pathname).replace(/^([.][.][/\\])+/, '');
  const file=path.join(PUBLIC,safe);
  if(!file.startsWith(PUBLIC)) return json(res,403,{error:'Forbidden'});
  fs.readFile(file,(err,data)=>{
    if(err){ res.writeHead(404,{'Content-Type':'text/plain'}); return res.end('Not found'); }
    const ext=path.extname(file); const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.json':'application/json'};
    res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream'}); res.end(data);
  });
}

const server=http.createServer(async (req,res)=>{
  const parsed=url.parse(req.url,true);
  try {
    if(req.method==='GET' && parsed.pathname==='/api/health') return json(res,200,{ok:true,service:'RiskGuard API',time:new Date().toISOString()});
    if(req.method==='GET' && parsed.pathname==='/api/transactions') return json(res,200,{transactions:live,processed24h:48291402,critical:14,activeNodes:1284,velocity:450});
    if(req.method==='GET' && parsed.pathname==='/api/behavior') {
      const amounts=history.map(x=>x.amount); const recipientCounts={}; history.forEach(x=>recipientCounts[x.recipient]=(recipientCounts[x.recipient]||0)+1);
      return json(res,200,{average:Math.round(mean(amounts)),median:[...amounts].sort((a,b)=>a-b)[Math.floor(amounts.length/2)],stdDev:Math.round(std(amounts)),typicalLocation:'London, UK',typicalDevice:'iPhone 15',topRecipients:Object.entries(recipientCounts).map(([recipient,count])=>({recipient,count})),history});
    }
    if(req.method==='GET' && parsed.pathname==='/api/graph') return json(res,200,graphData());
    if(req.method==='POST' && parsed.pathname==='/api/analyze') {
      const tx=await parseBody(req);
      if(!tx.amount || !tx.recipientId || !tx.device || !tx.location) return json(res,400,{error:'amount, recipientId, device and location are required'});
      const result=analyze(tx);
      const id='TX-'+crypto.randomInt(10000,99999);
      return json(res,200,{transaction:{...tx,id,createdAt:new Date().toISOString()},...result});
    }
    return serveStatic(req,res);
  } catch(e){ console.error(e); return json(res,500,{error:'Internal server error'}); }
});
server.listen(PORT,()=>console.log(`RiskGuard running at http://localhost:${PORT}`));
