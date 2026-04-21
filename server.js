const http = require('http');
const fs   = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT     = process.env.PORT || 18765;
const HTML_PATH = path.join(__dirname, 'cafeteria_reservation.html');

// ── 공유 좌석 상태 ──
const STATE = {};
(function init(){
  for(let i=1;  i<=12; i++) STATE[`T${i}`] = {type:4, zone:'A', q:[]};
  for(let i=13; i<=30; i++) STATE[`T${i}`] = {type:2, zone:'B', q:[]};
  for(let i=31; i<=48; i++) STATE[`T${i}`] = {type:1, zone:'C', q:[]};
})();

function secLeft(e){
  if(!e.active) return e.min*60;
  return Math.max(0, e.min*60 - Math.floor((Date.now()-e.t0)/1000));
}

function advance(tbl){
  let changed=false;
  while(tbl.q.length>0){
    const f=tbl.q[0];
    if(!f.active||secLeft(f)>0) break;
    tbl.q.shift();
    changed=true;
    if(tbl.q.length>0){ tbl.q[0].t0=Date.now(); tbl.q[0].active=true; }
  }
  return changed;
}

const server = http.createServer((req, res)=>{
  if(req.url==='/'||req.url==='/index.html'){
    try{
      const html=fs.readFileSync(HTML_PATH,'utf8');
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      res.end(html);
    }catch(e){ res.writeHead(500); res.end('cafeteria_reservation.html을 찾을 수 없습니다.'); }
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

const wss = new WebSocket.Server({ server });

function broadcast(msg){
  const data=JSON.stringify(msg);
  wss.clients.forEach(c=>{ if(c.readyState===WebSocket.OPEN) c.send(data); });
}

function sendState(ws){
  const data=JSON.stringify({type:'state', state:STATE});
  if(ws) ws.send(data);
  else broadcast({type:'state', state:STATE});
}

wss.on('connection', ws=>{
  sendState(ws);

  ws.on('message', raw=>{
    try{
      const msg=JSON.parse(raw.toString());

      if(msg.type==='reserve'){
        const tbl=STATE[msg.tableId];
        if(!tbl||tbl.q.length>=3) return;
        const isFirst=tbl.q.length===0;
        tbl.q.push({name:msg.name, t0:isFirst?Date.now():0, min:msg.min, active:isFirst});
        sendState();
        if(!isFirst){
          broadcast({type:'notify', tableId:msg.tableId,
            text:`${msg.name}님이 대기 ${tbl.q.length-1}번으로 등록되었습니다.`});
        }
      }

      if(msg.type==='leave'){
        const tbl=STATE[msg.tableId];
        if(!tbl||tbl.q.length===0) return;
        // 이름이 있으면 해당 이름의 자리 제거, 없으면 0번 제거
        const idx = msg.name ? tbl.q.findIndex(e=>e.name===msg.name) : 0;
        if(idx===-1) return;
        tbl.q.splice(idx,1);
        // 0번이 빠졌으면 다음 사람 활성화
        if(idx===0&&tbl.q.length>0){
          tbl.q[0].t0=Date.now(); tbl.q[0].active=true;
          broadcast({type:'notify', tableId:msg.tableId,
            text:`${tbl.q[0].name}님, 이제 ${msg.tableId} 자리를 이용하실 수 있습니다!`});
        }
        sendState();
      }
    }catch(e){ console.error('메시지 처리 오류:', e.message); }
  });
});

setInterval(()=>{
  let changed=false;
  Object.values(STATE).forEach(tbl=>{ if(advance(tbl)) changed=true; });
  if(changed) sendState();
}, 1000);

server.listen(PORT, ()=>{
  console.log(`🍱 학식당 WebSocket 서버 → http://localhost:${PORT}`);
});
