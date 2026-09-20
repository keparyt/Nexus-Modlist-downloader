(() => {
  if (!location.hostname.endsWith('nexusmods.com')) return;
  let busy=false;
  const norm=s=>(s||'').replace(/\s+/g,' ').trim().toLowerCase();
  const visible=el=>!!(el&&el.offsetParent!==null);
  const clickWhenFound=(finder, label, timeout=30000)=>new Promise(resolve=>{
    const started=Date.now();
    const scan=()=>{
      const el=finder();
      if(el&&visible(el)){el.click();chrome.runtime.sendMessage({type:'STEP_LOG',text:label});resolve(true);return;}
      if(Date.now()-started>timeout){chrome.runtime.sendMessage({type:'STEP_LOG',text:'Timeout: '+label});resolve(false);return;}
      setTimeout(scan,400);
    };scan();
  });
  async function run(){
    if(busy)return;busy=true;
    if(location.pathname.includes('/download')){
      const ok=await clickWhenFound(()=>[...document.querySelectorAll('#upsell-cards button,button')].find(b=>norm(b.textContent).includes('slow download')),'Clicked Slow download');
      if(ok)chrome.runtime.sendMessage({type:'DOWNLOAD_STARTED'});
      busy=false;return;
    }
    const vortex=await clickWhenFound(()=>[...document.querySelectorAll('span,button,a')].find(e=>norm(e.textContent)==='vortex'),'Clicked Vortex');
    if(!vortex){busy=false;return;}
    await clickWhenFound(()=>[...document.querySelectorAll('button,a')].find(e=>norm(e.textContent)==='download' && (/\/download\?nmm=1/i.test(e.href||'') || e.closest('.nxm-modal-body'))),'Clicked modal Download');
    busy=false;
  }
  chrome.storage.local.get('nexusQueueState',({nexusQueueState:s})=>{if(s?.running)run();});
})();
