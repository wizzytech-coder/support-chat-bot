const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers
} = require('@whiskeysockets/baileys');

const express = require('express');
const axios = require('axios');
const P = require('pino');
const fs = require('fs');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =====================================
// CONFIG
// =====================================

const PORT = process.env.PORT || 3000;
const AI_LINK = 'https://your-ai-api-url.com/ai';

// =====================================
// STATE
// =====================================

let sock;
let aiEnabled = true;
let adminTakeover = false;
let latestPairingCode = 'Not Generated';
let isConnecting = false;

const users = new Set();
const memory = {};
const logs = [];

let keywords = {
  'waec result checker': 'WAEC Result Checker costs ₦4,000.',
  'waec scratch card': 'WAEC Scratch Card costs ₦4,000.',
  'jamb epin for utme': 'JAMB ePIN for UTME costs ₦8,000.',
  'postutme classes': 'Post-UTME Classes cost ₦6,000.',
  'waec tutorial fee': 'WAEC Tutorial Fee costs ₦1,000.',
  'waec certificate': 'WAEC Certificate Processing costs ₦10,000.'
};

// =====================================
// LOGS
// =====================================

function saveLog(text) {
  const entry = `[${new Date().toLocaleString()}] ${text}`;
  logs.push(entry);
  fs.appendFileSync('logs.txt', entry + '\n');
}

// =====================================
// MENU
// =====================================

function menuText() {
  return `
╔══════════════════════╗
     FLEXI SYSTEMS AI
╚══════════════════════╝

/menu → Commands

📚 Services:
• WAEC
• JAMB
• Admission

🤖 AI Chat Enabled
📊 Dashboard Active
`;
}

// =====================================
// DASHBOARD TEMPLATE
// =====================================

function dashboardTemplate(content) {
  return `
<html>
<head>
<title>FLEXI AI</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>

<style>
body{margin:0;font-family:Arial;background:#111;color:#fff}
.sidebar{position:fixed;left:-260px;top:0;width:240px;height:100%;background:#1b1b1b;transition:.3s;padding-top:60px}
.sidebar.active{left:0}
.sidebar a{display:block;padding:15px;color:#fff;text-decoration:none;border-bottom:1px solid #333}
.main{padding:80px 20px}
.card{background:#1f1f1f;padding:15px;border-radius:10px;margin-bottom:15px}
button,input,textarea{width:100%;padding:10px;margin-top:10px;border:none;border-radius:8px}
.hamburger{position:fixed;width:100%;background:#000;padding:15px;font-size:25px;cursor:pointer}
.code{text-align:center;font-size:30px}
</style>

<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

</head>

<body>

<div class="hamburger" onclick="document.getElementById('s').classList.toggle('active')">☰</div>

<div class="sidebar" id="s">

<a href="/">Dashboard</a>
<a href="/pair">Pairing</a>
<a href="/broadcast-page">Broadcast</a>
<a href="/keywords">Keywords</a>
<a href="/logs">Logs</a>
<a href="/analytics">Analytics</a>
<a href="/settings">Settings</a>

</div>

<div class="main">
${content}
</div>

</body>
</html>
`;
}

// =====================================
// HOME
// =====================================

app.get('/', (req,res)=>{
  res.send(dashboardTemplate(`
    <h2>BOT DASHBOARD</h2>

    <div class="card">
      <p>AI: ${aiEnabled ? 'ON' : 'OFF'}</p>
      <p>Users: ${users.size}</p>
      <p>Logs: ${logs.length}</p>
    </div>

    <div class="card">
      <button onclick="fetch('/ai/on')">Enable AI</button>
      <button onclick="fetch('/ai/off')">Disable AI</button>
      <button onclick="fetch('/admin/on')">Enable Human Mode</button>
      <button onclick="fetch('/admin/off')">Disable Human Mode</button>
    </div>
  `));
});

// =====================================
// PAIRING PAGE
// =====================================

app.get('/pair',(req,res)=>{
  res.send(dashboardTemplate(`
    <h2>PAIRING SYSTEM</h2>

    <div class="card">
      <input id="num" placeholder="2348012345678"/>
      <button onclick="pair()">Generate Code</button>
    </div>

    <div class="card">
      <div class="code">${latestPairingCode}</div>
    </div>

    <script>
      async function pair(){
        const n = document.getElementById('num').value;
        const res = await fetch('/pair-code?number='+n);
        document.querySelector('.code').innerText = await res.text();
      }
    </script>
  `));
});

// =====================================
// FIXED PAIRING CODE
// =====================================

app.get('/pair-code', async (req,res)=>{
  try {

    let number = req.query.number?.replace(/[^0-9]/g,'');
    if(!number) return res.send('Enter number');

    if(number.startsWith('0')){
      number = '234' + number.slice(1);
    }

    if(!sock) return res.send('Bot starting...');

    if(isConnecting) return res.send('Pairing in progress...');

    if(sock.authState?.creds?.registered){
      return res.send('Already linked');
    }

    isConnecting = true;

    const code = await sock.requestPairingCode(number);

    latestPairingCode = code;

    saveLog(`PAIR CODE => ${number}`);

    isConnecting = false;

    res.send(code);

  } catch(e){
    isConnecting = false;
    res.send('Failed pairing');
  }
});

// =====================================
// BROADCAST
// =====================================

app.get('/broadcast-page',(req,res)=>{
  res.send(dashboardTemplate(`
    <h2>BROADCAST</h2>

    <div class="card">
      <form method="POST" action="/broadcast">
        <textarea name="message" placeholder="Message"></textarea>
        <button>Send</button>
      </form>
    </div>
  `));
});

app.post('/broadcast',async(req,res)=>{
  const msg = req.body.message;

  for(const user of users){
    try{
      await sock.sendMessage(user,{text:msg});
    }catch{}
  }

  saveLog(`BROADCAST => ${msg}`);
  res.redirect('/broadcast-page');
});

// =====================================
// KEYWORDS
// =====================================

app.get('/keywords',(req,res)=>{
  const list = Object.keys(keywords).map(k=>`
    <div class="card">
      <b>${k}</b>
      <p>${keywords[k]}</p>
    </div>
  `).join('');

  res.send(dashboardTemplate(`
    <h2>KEYWORDS</h2>

    <div class="card">
      <form method="POST" action="/keyword">
        <input name="key" placeholder="keyword"/>
        <textarea name="reply" placeholder="reply"></textarea>
        <button>Save</button>
      </form>
    </div>

    ${list}
  `));
});

app.post('/keyword',(req,res)=>{
  keywords[req.body.key.toLowerCase()] = req.body.reply;
  saveLog(`KEYWORD => ${req.body.key}`);
  res.redirect('/keywords');
});

// =====================================
// LOGS
// =====================================

app.get('/logs',(req,res)=>{
  res.send(dashboardTemplate(`
    <h2>LOGS</h2>
    <div class="card" style="height:500px;overflow:auto">
      ${logs.map(l=>`<p>${l}</p>`).join('')}
    </div>
  `));
});

// =====================================
// ANALYTICS
// =====================================

app.get('/analytics',(req,res)=>{
  res.send(dashboardTemplate(`
    <h2>ANALYTICS</h2>

    <div class="card">
      <canvas id="c"></canvas>
    </div>

    <script>
      new Chart(document.getElementById('c'),{
        type:'bar',
        data:{
          labels:['Users','Logs'],
          datasets:[{data:[${users.size},${logs.length}]}]
        }
      });
    </script>
  `));
});

// =====================================
// SETTINGS
// =====================================

app.get('/settings',(req,res)=>{
  res.send(dashboardTemplate(`
    <h2>SETTINGS</h2>

    <div class="card">
      <p>AI: ${aiEnabled ? 'ON':'OFF'}</p>
    </div>
  `));
});

// =====================================
// TOGGLES
// =====================================

app.get('/ai/on',(r,s)=>{aiEnabled=true;s.send('AI ON')});
app.get('/ai/off',(r,s)=>{aiEnabled=false;s.send('AI OFF')});
app.get('/admin/on',(r,s)=>{adminTakeover=true;s.send('ADMIN ON')});
app.get('/admin/off',(r,s)=>{adminTakeover=false;s.send('ADMIN OFF')});

// =====================================
// BOT ENGINE
// =====================================

async function startBot(){

  const {state,saveCreds} = await useMultiFileAuthState('session');
  const {version} = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: P({level:'silent'}),
    printQRInTerminal:false,
    browser: Browsers.macOS('Chrome'),
    markOnlineOnConnect:true
  });

  sock.ev.on('creds.update',saveCreds);

  sock.ev.on('connection.update',({connection,lastDisconnect})=>{

    if(connection==='open'){
      saveLog('BOT CONNECTED');
      isConnecting = false;
    }

    if(connection==='close'){
      const code = lastDisconnect?.error?.output?.statusCode;
      sock = null;

      if(code !== DisconnectReason.loggedOut){
        setTimeout(startBot,5000);
      }
    }
  });

  sock.ev.on('messages.upsert',async({messages})=>{

    const msg = messages[0];
    if(!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

    if(!text) return;

    users.add(from);

    if(text === '/menu'){
      return sock.sendMessage(from,{text:menuText()});
    }

    if(!aiEnabled) return;

    const res = await axios.post(AI_LINK,{
      prompt:text
    });

    const reply = res.data.reply || 'No response';

    await sock.sendMessage(from,{text:reply});

  });

}

app.listen(PORT,()=>console.log('Dashboard running'));
startBot();
