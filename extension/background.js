const KEY='nexusQueueState';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(){return (await chrome.storage.local.get(KEY))[KEY]||{running:false,index:0,urls:[],tabId:null,log:[]};}
async function save(s){await chrome.storage.local.set({[KEY]:s});}
async function log(s,msg){s.log=(s.log||[]).slice(-100);s.log.push(new Date().toLocaleTimeString()+' '+msg);await save(s);}
async function next(){
  const s=await get();
  if(!s.running)return;
  if(s.index>=s.urls.length){s.running=false;await log(s,'Completed all URLs');return;}
  const url=s.urls[s.index];
  await log(s,`Opening ${s.index+1}/${s.urls.length}: ${url}`);
  if(s.tabId){try{await chrome.tabs.update(s.tabId,{url});return;}catch(e){s.tabId=null;}}
  const tab=await chrome.tabs.create({url,active:true});s.tabId=tab.id;await save(s);
}
chrome.runtime.onMessage.addListener(async(msg,sender)=>{
  const state=await get();
  if(msg.type==='START'){state.urls=msg.urls;state.index=0;state.running=true;state.tabId=null;state.log=[];await save(state);await next();}
  if(msg.type==='STOP'){state.running=false;await log(state,'Stopped by user');}
  if(msg.type==='STEP_LOG'){await log(state,msg.text);}
  if(msg.type==='DOWNLOAD_STARTED'){
    await log(state,'Slow download clicked; waiting 10 seconds');
    await sleep(10000);
    state.index++;await save(state);await next();
  }
});
chrome.tabs.onRemoved.addListener(async id=>{const s=await get();if(s.tabId===id&&s.running){s.tabId=null;await save(s);}});
