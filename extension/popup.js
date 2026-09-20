const $=id=>document.getElementById(id);
const example=[100,95,93,92,89,87,86,79,76,51,229,228,220,219,215,216,217,210,201,178,177,163,140,138,131,120,119,117,115,101].map(id=>`https://www.nexusmods.com/supermarkettogether/mods/${id}`);
function parse(raw){
  try{const v=JSON.parse(raw);if(Array.isArray(v))return v;}catch{}
  return raw.split(/\r?\n/).map(x=>x.trim()).filter(x=>/^https:\/\/www\.nexusmods\.com\//i.test(x));
}
async function refresh(){const {nexusQueueState:s}=await chrome.storage.local.get('nexusQueueState');if(!s)return;$('status').textContent=s.running?`Running ${Math.min(s.index+1,s.urls.length)}/${s.urls.length}`:'Idle';$('log').textContent=(s.log||[]).join('\n');}
$('load').onclick=()=>{$('list').value=JSON.stringify(example,null,2)};
$('start').onclick=async()=>{const urls=[...new Set(parse($('list').value))];if(!urls.length)return $('status').textContent='No valid Nexus URLs';await chrome.runtime.sendMessage({type:'START',urls});await refresh();};
$('stop').onclick=async()=>{await chrome.runtime.sendMessage({type:'STOP'});await refresh();};
refresh();setInterval(refresh,1000);
