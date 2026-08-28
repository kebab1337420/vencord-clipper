// Vencord ef29bbe
// Standalone: false
// Platform: win32
// Updater Disabled: false
"use strict";var vt=Object.defineProperty;var Jn=Object.getOwnPropertyDescriptor;var Xn=Object.getOwnPropertyNames;var Qn=Object.prototype.hasOwnProperty;var He=(t,e,r)=>()=>{if(r)throw r[0];try{return t&&(e=t(t=0)),e}catch(n){throw r=[n],n}};var te=(t,e)=>{for(var r in e)vt(t,r,{get:e[r],enumerable:!0})},ei=(t,e,r,n)=>{if(e&&typeof e=="object"||typeof e=="function")for(let i of Xn(e))!Qn.call(t,i)&&i!==r&&vt(t,i,{get:()=>e[i],enumerable:!(n=Jn(e,i))||n.enumerable});return t};var ti=t=>ei(vt({},"__esModule",{value:!0}),t);var l=He(()=>{"use strict"});var ve=He(()=>{"use strict";l()});function Me(t){return async function(){try{return{ok:!0,value:await t(...arguments)}}catch(e){return{ok:!1,error:e instanceof Error?{...e,message:e.message,name:e.name,stack:e.stack}:e}}}}var mr=He(()=>{"use strict";l()});var si={};function ge(...t){let e={cwd:wr};return yt?gt("flatpak-spawn",["--host","git",...t],e):gt("git",t,e)}async function ri(){return(await ge("remote","get-url","origin")).stdout.trim().replace(/git@(.+):/,"https://$1/").replace(/\.git$/,"")}async function ni(){await ge("fetch");let t=(await ge("branch","--show-current")).stdout.trim();if(!((await ge("ls-remote","origin",t)).stdout.length>0))return[];let n=(await ge("log",`HEAD...origin/${t}`,"--pretty=format:%an/%h/%s")).stdout.trim();return n?n.split(`
`).map(i=>{let[o,s,...a]=i.split("/");return{hash:s,author:o,message:a.join("/").split(`
`)[0]}}):[]}async function ii(){return(await ge("pull")).stdout.includes("Fast-forward")}async function oi(){return!(await gt(yt?"flatpak-spawn":"node",yt?["--host","node","scripts/build/build.mjs"]:["scripts/build/build.mjs"],{cwd:wr})).stderr.includes("Build failed")}var vr,_e,gr,yr,wr,gt,yt,br=He(()=>{"use strict";l();ve();vr=require("child_process"),_e=require("electron"),gr=require("path"),yr=require("util");mr();wr=(0,gr.join)(__dirname,".."),gt=(0,yr.promisify)(vr.execFile),yt=!1;_e.ipcMain.handle("VencordGetRepo",Me(ri));_e.ipcMain.handle("VencordGetUpdates",Me(ni));_e.ipcMain.handle("VencordUpdate",Me(ii));_e.ipcMain.handle("VencordBuild",Me(oi))});l();l();l();br();l();ve();var jt=require("electron");l();var xt={};te(xt,{fetchTrackData:()=>ci});l();l();l();var xr="ef29bbe";l();var wt="Vendicated/Vencord";var Sr=`Vencord/${xr}${wt?` (https://github.com/${wt})`:""}`;var Er=require("child_process"),kr=require("util"),Tr=(0,kr.promisify)(Er.execFile);async function bt(t){let{stdout:e}=await Tr("osascript",t.map(r=>["-e",r]).flat());return e}var L=null;async function ai({id:t,name:e,artist:r,album:n}){if(t===L?.id){if("data"in L)return L.data;if("failures"in L&&L.failures>=5)return null}try{let i=new URL("https://itunes.apple.com/search");i.searchParams.set("term",`${e} ${r} ${n}`),i.searchParams.set("media","music"),i.searchParams.set("entity","song");let o=await fetch(i,{headers:{"user-agent":Sr}}).then(a=>a.json()).then(a=>a.results.find(c=>c.collectionName===n)||a.results[0]),s=await fetch(o.artistViewUrl).then(a=>a.text()).then(a=>{let c=a.match(/<meta property="og:image" content="(.+?)">/);return c?c[1].replace(/[0-9]+x.+/,"220x220bb-60.png"):void 0}).catch(()=>{});return L={id:t,data:{appleMusicLink:o.trackViewUrl,appleMusicArtistLink:o.artistViewUrl,songLink:`https://song.link/i/${new URL(o.trackViewUrl).searchParams.get("i")}`,albumArtwork:o.artworkUrl100.replace("100x100","512x512"),artistArtwork:s}},L.data}catch(i){return console.error("[AppleMusicRichPresence] Failed to fetch remote data:",i),L={id:t,failures:(t===L?.id&&"failures"in L?L.failures:0)+1},null}}async function ci(){try{await Tr("pgrep",["^Music$"])}catch{return null}if(await bt(['tell application "Music"',"get player state","end tell"]).then(h=>h.trim())!=="playing")return null;let e=await bt(['tell application "Music"',"get player position","end tell"]).then(h=>Number.parseFloat(h.trim())),r=await bt(['set output to ""','tell application "Music"',"set t_id to database id of current track","set t_name to name of current track","set t_album to album of current track","set t_artist to artist of current track","set t_duration to duration of current track",'set output to "" & t_id & "\\n" & t_name & "\\n" & t_album & "\\n" & t_artist & "\\n" & t_duration',"end tell","return output"]),[n,i,o,s,a]=r.split(`
`).filter(h=>!!h),c=Number.parseFloat(a),p=await ai({id:n,name:i,artist:s,album:o});return{name:i,album:o,artist:s,playerPosition:e,duration:c,...p}}var St={};te(St,{initDevtoolsOpenEagerLoad:()=>li});l();function li(t){let e=()=>t.sender.executeJavaScript("Vencord.Plugins.plugins.ConsoleShortcuts.eagerLoad(true)");t.sender.isDevToolsOpened()?e():t.sender.once("devtools-opened",()=>e())}var Mr={};l();l();ve();l();var Et=Symbol("SettingsStore.isProxy"),Ir=Symbol("SettingsStore.getRawTarget"),Oe=class{pathListeners=new Map;prefixListeners=new Map;globalListeners=new Set;proxyContexts=new WeakMap;proxyHandler=(()=>{let e=this;return{get(r,n,i){if(n===Et)return!0;if(n===Ir)return r;let o=Reflect.get(r,n,i),s=e.proxyContexts.get(r);if(s==null)return o;let{root:a,path:c}=s;if(!(n in r)&&e.getDefaultValue!=null&&(o=e.getDefaultValue({target:r,key:n,root:a,path:c})),typeof o=="object"&&o!==null&&!o[Et]){let p=`${c}${c&&"."}${n}`;return e.makeProxy(o,a,p)}return o},set(r,n,i){if(i?.[Et]&&(i=i[Ir]),r[n]===i)return!0;if(!Reflect.set(r,n,i))return!1;let o=e.proxyContexts.get(r);if(o==null)return!0;let{root:s,path:a}=o,c=`${a}${a&&"."}${n}`;return e.notifyListeners(c,i,s),!0},deleteProperty(r,n){if(!Reflect.deleteProperty(r,n))return!1;let i=e.proxyContexts.get(r);if(i==null)return!0;let{root:o,path:s}=i,a=`${s}${s&&"."}${n}`;return e.notifyListeners(a,void 0,o),!0}}})();constructor(e,r={}){this.plain=e,this.store=this.makeProxy(e),Object.assign(this,r)}makeProxy(e,r=e,n=""){return this.proxyContexts.set(e,{root:r,path:n}),new Proxy(e,this.proxyHandler)}notifyPrefixListeners(e,r,n){for(let i=1;i<=r.length;i++){let o=r.slice(0,i).join(".");this.prefixListeners.get(o)?.forEach(s=>s(n,e))}}notifyListeners(e,r,n){let i=e.split(".");if(i.length>3&&i[0]==="plugins"){let o=i.slice(0,3),s=o.join("."),a=o.reduce((c,p)=>c[p],n);this.globalListeners.forEach(c=>c(n,s)),this.pathListeners.get(s)?.forEach(c=>c(a))}else this.globalListeners.forEach(o=>o(n,e));this.pathListeners.get(e)?.forEach(o=>o(r)),this.notifyPrefixListeners(e,i,r)}setData(e,r){if(this.readOnly)throw new Error("SettingsStore is read-only");if(this.plain=e,this.store=this.makeProxy(e),r){let n=e,i=r.split(".");for(let o of i){if(!n){console.warn(`Settings#setData: Path ${r} does not exist in new data. Not dispatching update`);return}n=n[o]}this.pathListeners.get(r)?.forEach(o=>o(n)),this.notifyPrefixListeners(r,i,n)}this.markAsChanged()}addGlobalChangeListener(e){this.globalListeners.add(e)}addChangeListener(e,r){let n=this.pathListeners.get(e)??new Set;n.add(r),this.pathListeners.set(e,n)}addPrefixChangeListener(e,r){let n=this.prefixListeners.get(e)??new Set;n.add(r),this.prefixListeners.set(e,n)}removeGlobalChangeListener(e){this.globalListeners.delete(e)}removeChangeListener(e,r){let n=this.pathListeners.get(e);n&&(n.delete(r),n.size||this.pathListeners.delete(e))}removePrefixChangeListener(e,r){let n=this.prefixListeners.get(e);n&&(n.delete(r),n.size||this.prefixListeners.delete(e))}markAsChanged(){this.globalListeners.forEach(e=>e(this.plain,""))}};l();function kt(t,e){for(let r in e){let n=e[r];typeof n=="object"&&!Array.isArray(n)?(t[r]??={},kt(t[r],n)):t[r]??=n}return t}var At=require("electron"),ne=require("fs");l();var Ar=require("electron"),K=require("path"),Ye=process.env.VENCORD_USER_DATA_DIR??(process.env.DISCORD_USER_DATA_DIR?(0,K.join)(process.env.DISCORD_USER_DATA_DIR,"..","VencordData"):(0,K.join)(Ar.app.getPath("userData"),"..","Vencord")),re=(0,K.join)(Ye,"settings"),Y=(0,K.join)(Ye,"themes"),ye=(0,K.join)(re,"quickCss.css"),Tt=(0,K.join)(re,"settings.json"),It=(0,K.join)(re,"native-settings.json"),Rr=["https:","http:","steam:","spotify:","com.epicgames.launcher:","tidal:","itunes:"];(0,ne.mkdirSync)(re,{recursive:!0});function Cr(t,e){try{return JSON.parse((0,ne.readFileSync)(e,"utf-8"))}catch(r){return r?.code!=="ENOENT"&&console.error(`Failed to read ${t} settings`,r),{}}}var A=new Oe(Cr("renderer",Tt));A.addGlobalChangeListener(()=>{try{(0,ne.writeFileSync)(Tt,JSON.stringify(A.plain,null,4))}catch(t){console.error("Failed to write renderer settings",t)}});At.ipcMain.on("VencordGetSettings",t=>t.returnValue=A.plain);At.ipcMain.handle("VencordSetSettings",(t,e,r)=>{A.setData(e,r)});var ui={plugins:{},customCspRules:{}},Dr=Cr("native",It);kt(Dr,ui);var F=new Oe(Dr);F.addGlobalChangeListener(()=>{try{(0,ne.writeFileSync)(It,JSON.stringify(F.plain,null,4))}catch(t){console.error("Failed to write native settings",t)}});var Je=require("electron"),qe=[];function Pr(){let t=[];for(let e=qe.length-1;e>=0;e--){let{processId:r,routingId:n}=qe[e],i=Je.webFrameMain.fromId(r,n);if(!i){qe.splice(e,1);continue}t.push(i)}return t}Je.app.on("browser-window-created",(t,e)=>{e.webContents.on("frame-created",(r,{frame:n})=>{n?.once("dom-ready",()=>{if(n.url.startsWith("https://open.spotify.com/embed/")){Pr();let{routingId:i,processId:o}=n;qe.push({routingId:i,processId:o});let s=A.store.plugins?.FixSpotifyEmbeds;if(!s?.enabled)return;n.executeJavaScript(`
                    globalThis._vcVolume = ${s.volume/100};
                    const original = Audio.prototype.play;
                    Audio.prototype.play = function() {
                        this.volume = _vcVolume;
                        return original.apply(this, arguments);
                    }
                `)}})})});A.addChangeListener("plugins.FixSpotifyEmbeds.volume",t=>{try{Pr().forEach(e=>e.executeJavaScript(`globalThis._vcVolume = ${t/100}`))}catch(e){console.error("FixSpotifyEmbeds: Failed to update volume",e)}});var Or={};l();var _r=require("electron");_r.app.on("browser-window-created",(t,e)=>{e.webContents.on("frame-created",(r,{frame:n})=>{n?.once("dom-ready",()=>{if(n.url.startsWith("https://www.youtube.com/")){if(!A.store.plugins?.FixYoutubeEmbeds?.enabled)return;n.executeJavaScript(`
                new MutationObserver(() => {
                    if(
                        document.querySelector('div.ytp-error-content-wrap-subreason a[href*="www.youtube.com/watch?v="]')
                    ) location.reload()
                }).observe(document.body, { childList: true, subtree:true });
                `)}})})});var Rt={};te(Rt,{resolveRedirect:()=>pi});l();var Lr=require("https"),fi=/^https:\/\/(spotify\.link|s\.team)\/.+$/;function Nr(t){return new Promise((e,r)=>{let n=(0,Lr.request)(new URL(t),{method:"HEAD"},i=>{e(i.headers.location?Nr(i.headers.location):t)});n.on("error",r),n.end()})}async function pi(t,e){return fi.test(e)?Nr(e):e}var Ct={};te(Ct,{makeDeeplTranslateRequest:()=>di,makeKagiTranslateRequest:()=>hi});l();async function di(t,e,r,n){let i=e?"https://api.deepl.com/v2/translate":"https://api-free.deepl.com/v2/translate";try{let o=await fetch(i,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`DeepL-Auth-Key ${r}`},body:n}),s=await o.text();return{status:o.status,data:s}}catch(o){return{status:-1,data:String(o)}}}async function hi(t,e,r,n,i){let o="https://translate.kagi.com/api/translate";try{let s=await fetch(o,{method:"POST",headers:{"Content-Type":"application/json",Cookie:`kagi_session=${e}`},body:JSON.stringify({text:r,from:n,to:i,model:"standard"})}),a=await s.json();return{status:s.status,data:a}}catch(s){return{status:-1,data:String(s)}}}var Dt={};te(Dt,{readRecording:()=>mi});l();var Ur=require("electron"),Xe=require("fs/promises"),Le=require("path");async function mi(t,e){e=(0,Le.normalize)(e);let r=(0,Le.basename)(e),n=(0,Le.normalize)(Ur.app.getPath("userData")+"/");if(!/^\d*recording\.ogg$/.test(r)||!e.startsWith(n))return null;try{let i=await(0,Xe.readFile)(e);return(0,Xe.rm)(e).catch(()=>{}),new Uint8Array(i.buffer)}catch{return null}}var Pt={};te(Pt,{closeSocket:()=>gi,sendToOverlay:()=>vi});l();var Fr=require("dgram"),Qe=null;function vi(t,e){e.messageType=e.type;let r=JSON.stringify(e);Qe??=(0,Fr.createSocket)("udp4"),Qe.send(r,42069,"127.0.0.1")}function gi(){Qe?.close(),Qe=null}var $r={};l();var Vr=require("electron");l();var Mt=`"use strict";(()=>{if(window.adguardInjected)return;window.adguardInjected=!0;const c=["#__ffYoutube1","#__ffYoutube2","#__ffYoutube3","#__ffYoutube4","#feed-pyv-container","#feedmodule-PRO","#homepage-chrome-side-promo","#merch-shelf","#offer-module",'#pla-shelf > ytd-pla-shelf-renderer[class="style-scope ytd-watch"]',"#pla-shelf","#premium-yva","#promo-info","#promo-list","#promotion-shelf","#related > ytd-watch-next-secondary-results-renderer > #items > ytd-compact-promoted-video-renderer.ytd-watch-next-secondary-results-renderer","#search-pva","#shelf-pyv-container","#video-masthead","#watch-branded-actions","#watch-buy-urls","#watch-channel-brand-div","#watch7-branded-banner","#YtKevlarVisibilityIdentifier","#YtSparklesVisibilityIdentifier",".carousel-offer-url-container",".companion-ad-container",".GoogleActiveViewElement",'.list-view[style="margin: 7px 0pt;"]',".promoted-sparkles-text-search-root-container",".promoted-videos",".searchView.list-view",".sparkles-light-cta",".watch-extra-info-column",".watch-extra-info-right",".ytd-carousel-ad-renderer",".ytd-compact-promoted-video-renderer",".ytd-companion-slot-renderer",".ytd-merch-shelf-renderer",".ytd-player-legacy-desktop-watch-ads-renderer",".ytd-promoted-sparkles-text-search-renderer",".ytd-promoted-video-renderer",".ytd-search-pyv-renderer",".ytd-video-masthead-ad-v3-renderer",".ytp-ad-action-interstitial-background-container",".ytp-ad-action-interstitial-slot",".ytp-ad-image-overlay",".ytp-ad-overlay-container",".ytp-ad-progress",".ytp-ad-progress-list",'[class*="ytd-display-ad-"]','[layout*="display-ad-"]','a[href^="http://www.youtube.com/cthru?"]','a[href^="https://www.youtube.com/cthru?"]',"ytd-action-companion-ad-renderer","ytd-banner-promo-renderer","ytd-compact-promoted-video-renderer","ytd-companion-slot-renderer","ytd-display-ad-renderer","ytd-promoted-sparkles-text-search-renderer","ytd-promoted-sparkles-web-renderer","ytd-search-pyv-renderer","ytd-single-option-survey-renderer","ytd-video-masthead-ad-advertiser-info-renderer","ytd-video-masthead-ad-v3-renderer","YTM-PROMOTED-VIDEO-RENDERER"],l=()=>{const e=c;if(!e)return;const t=e.join(", ")+" { display: none!important; }",r=document.createElement("style");r.textContent=t,document.head.appendChild(r)},p=e=>{new MutationObserver(r=>{e(r)}).observe(document.documentElement,{childList:!0,subtree:!0})},a=()=>{const e=document.querySelectorAll("#contents > ytd-rich-item-renderer ytd-display-ad-renderer");e.length!==0&&e.forEach(t=>{if(t.parentNode&&t.parentNode.parentNode){const r=t.parentNode.parentNode;r.localName==="ytd-rich-item-renderer"&&(r.style.display="none")}})},s=()=>{if(document.querySelector(".ad-showing")){const e=document.querySelector("video");e&&e.duration&&(e.currentTime=e.duration,setTimeout(()=>{const t=document.querySelector("button.ytp-ad-skip-button");t&&t.click()},100))}},d=(e,t,r)=>{if(!e)return!1;let n=!1;for(const o in e)e.hasOwnProperty(o)&&o===t?(e[o]=r,n=!0):e.hasOwnProperty(o)&&typeof e[o]=="object"&&d(e[o],t,r)&&(n=!0);return n},i=(e,t)=>{const r=JSON.parse;JSON.parse=(...n)=>{const o=r.apply(this,n);return d(o,e,t),o},Response.prototype.json=new Proxy(Response.prototype.json,{async apply(...n){const o=await Reflect.apply(...n);return d(o,e,t),o}})};i("adPlacements",[]),i("playerAds",[]),l(),a(),s(),p(()=>{a(),s()})})();
`;Vr.app.on("browser-window-created",(t,e)=>{e.webContents.on("frame-created",(r,{frame:n})=>{n?.once("dom-ready",()=>{A.store.plugins?.YoutubeAdblock?.enabled&&(n.url.includes("youtube.com/embed/")?n.executeJavaScript(Mt):n.parent?.url.includes("youtube.com/embed/")&&n.parent.executeJavaScript(Mt))})})});var Gt={};te(Gt,{answerOverlayAction:()=>To,armDisplayMedia:()=>so,checkUpdate:()=>Po,closeStudioOverlay:()=>xo,deleteClip:()=>Fi,disarmDisplayMedia:()=>ao,downloadUpdate:()=>_o,dropOverlayWaiters:()=>ko,focusClient:()=>Io,getActiveScreen:()=>oo,getCaptureSources:()=>no,getClipDirectory:()=>Qi,getMemoryReport:()=>io,getPlatformInfo:()=>ro,hideClipOverlay:()=>vo,listClips:()=>Ni,notifyClipSaved:()=>mo,openClipDirectory:()=>to,openStudioOverlay:()=>bo,pickAudioFiles:()=>Bi,pickClipDirectory:()=>eo,pickImageFiles:()=>Ki,pickVideoFiles:()=>Wi,readAudioFile:()=>Hi,readClip:()=>Ui,readImageFile:()=>Ji,readLibrary:()=>$i,readVideoFile:()=>ji,readVoiceTrack:()=>Oi,registerShortcuts:()=>lo,relaunchClient:()=>Oo,renameClip:()=>Vi,reserveClipPath:()=>Di,revealClip:()=>Xi,saveClip:()=>Ci,saveVoiceTrack:()=>_i,showClipOverlay:()=>ho,studioOverlayUp:()=>So,unregisterShortcuts:()=>Wt,waitForOverlayAction:()=>Eo,waitForShortcut:()=>uo,writeLibrary:()=>zi});l();var Qr=require("crypto"),g=require("electron"),f=require("fs"),en=require("https"),d=require("path");l();var q=require("electron"),rt=require("fs"),Ue=require("path"),zr=require("url"),et=24,Wr=2600,tt=220,yi=300,wi=56,_t=!0;function nt(){return _t}var se=null,ie=null,Ne=null,oe=null;function bi(){return!!se&&!se.isDestroyed()}function ae(){ie&&(clearTimeout(ie),ie=null);let t=se;se=null,t&&!t.isDestroyed()&&t.destroy()}function we(){oe&&(clearTimeout(oe),oe=null);let t=Ne;Ne=null,t&&!t.isDestroyed()&&t.destroy()}function xi(t,e,r){let i=q.screen.getDisplayNearestPoint(q.screen.getCursorScreenPoint()).workArea,o=t==="top-left"||t==="bottom-left",s=t==="top-left"||t==="top-right";return{x:Math.round(o?i.x+et:i.x+i.width-e-et),y:Math.round(s?i.y+et:i.y+i.height-r-et)}}function Fe(t,e){let r=(0,Ue.join)(q.app.getPath("userData"),"clipper-overlay");(0,rt.mkdirSync)(r,{recursive:!0});let n=(0,Ue.join)(r,t);return(0,rt.writeFileSync)(n,e,"utf8"),n}function Gr(t,e,r,n){let{x:i,y:o}=xi(n,e,r),s=new q.BrowserWindow({width:e,height:r,x:i,y:o,frame:!1,transparent:!0,backgroundColor:"#00000000",resizable:!1,movable:!1,minimizable:!1,maximizable:!1,fullscreenable:!1,skipTaskbar:!0,focusable:!1,hasShadow:!1,alwaysOnTop:!0,show:!1,webPreferences:{nodeIntegration:!1,contextIsolation:!0,sandbox:!0,backgroundThrottling:!1}});return s.setAlwaysOnTop(!0,"screen-saver"),s.setVisibleOnAllWorkspaces(!0,{visibleOnFullScreen:!0}),s.setIgnoreMouseEvents(!0,{forward:!0}),s.loadFile(t).then(()=>{s.isDestroyed()||s.showInactive()}).catch(()=>{s.isDestroyed()||s.destroy()}),s}function jr(t){return`<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src file:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
    html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
    .card {
        position: absolute; inset: 0; border-radius: 12px; overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.14); box-shadow: 0 10px 34px rgba(0, 0, 0, 0.6);
        opacity: 0; transform: scale(0.96); transition: opacity ${tt}ms ease, transform ${tt}ms ease;
    }
    .card.up { opacity: 1; transform: none; }
    ${t}
</style>`}function V(t){return JSON.stringify(t).replace(/</g,"\\u003c")}function Si(t,e){return`<!doctype html>
<html>
<head>
${jr(`.card { background: #000; }
    video { display: block; width: 100%; height: 100%; object-fit: cover; }
    .tag {
        position: absolute; left: 0; right: 0; bottom: 0; padding: 18px 10px 7px;
        font: 600 12px/1.3 "gg sans", "Segoe UI", system-ui, sans-serif; color: #fff;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9); white-space: nowrap; overflow: hidden;
        text-overflow: ellipsis; background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
    }`)}
</head>
<body>
<div class="card" id="card">
    <video id="video" playsinline></video>
    <div class="tag" id="tag"></div>
</div>
<script>
    var look = ${V(e)};
    var video = document.getElementById("video");
    var card = document.getElementById("card");
    document.getElementById("tag").textContent = ${V((0,Ue.basename)(t))};

    var leaving = false;
    function leave() {
        if (leaving) return;
        leaving = true;
        card.classList.remove("up");
        setTimeout(function () { window.close(); }, ${tt});
    }

    // The last seconds of the clip are the ones worth seeing: a save keeps the
    // moment that just happened, and it happened at the end of the buffer.
    video.addEventListener("loadedmetadata", function () {
        var length = isFinite(video.duration) ? video.duration : 0;
        if (look.seconds > 0 && length > look.seconds) video.currentTime = length - look.seconds;
        card.classList.add("up");
    });

    video.addEventListener("ended", leave);
    video.addEventListener("error", leave);

    video.volume = Math.max(0, Math.min(1, look.volume / 100));
    video.muted = look.volume <= 0;

    video.src = ${V((0,zr.pathToFileURL)(t).href)};

    // Autoplay with sound is only allowed after a gesture, and this window
    // never gets one. Muted playback is always allowed, so it is the fallback
    // rather than a reason to show nothing.
    video.play().catch(function () {
        video.muted = true;
        video.play().catch(leave);
    });
</script>
</body>
</html>`}function Ei(t,e){return`<!doctype html>
<html>
<head>
${jr(`.card {
        background: rgba(20, 21, 24, 0.92); display: flex; align-items: center; gap: 10px; padding: 0 14px;
        font: 12px/1.3 "gg sans", "Segoe UI", system-ui, sans-serif; color: #fff;
    }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #f23f43; flex: none; }
    .text { min-width: 0; }
    .title { font-weight: 600; font-size: 13px; }
    .note { opacity: 0.72; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`)}
</head>
<body>
<div class="card" id="card">
    <div class="dot"></div>
    <div class="text">
        <div class="title" id="title"></div>
        <div class="note" id="note"></div>
    </div>
</div>
<script>
    var card = document.getElementById("card");
    document.getElementById("title").textContent = ${V(t)};
    document.getElementById("note").textContent = ${V(e)};

    requestAnimationFrame(function () { card.classList.add("up"); });

    setTimeout(function () {
        card.classList.remove("up");
        setTimeout(function () { window.close(); }, ${tt});
    }, ${Wr});
</script>
</body>
</html>`}function Br(t,e){if(!_t)return!1;ae(),we();let r=Math.max(200,Math.round(e.width)),n=Math.round(r*9/16),i=Gr(Fe("clip.html",Si(t,e)),r,n,e.corner);se=i,i.on("closed",()=>{se===i&&(se=null,ie&&(clearTimeout(ie),ie=null))});let o=(e.seconds>0?e.seconds:300)+10;return ie=setTimeout(()=>ae(),o*1e3),!0}function Zr(t,e,r){if(!_t||bi())return!1;we();let n=Gr(Fe("toast.html",Ei(t,e)),yi,wi,r);return Ne=n,n.on("closed",()=>{Ne===n&&(Ne=null,oe&&(clearTimeout(oe),oe=null))}),oe=setTimeout(()=>we(),Wr+4e3),!0}q.app.on("will-quit",()=>{ae(),we()});l();var $=require("electron"),Hr=require("url");var Ot="VencordClipperOverlayAction",Kr="VencordClipperOverlayReply",ki=108,R=null;function Lt(){return!!R&&!R.isDestroyed()}function $e(){let t=R;R=null,t&&!t.isDestroyed()&&t.destroy()}var be=[],Ve=[];function Ti(t){let e=be.shift();if(e){e(t);return}Ve.push(t),Ve.length>4&&Ve.shift()}function Yr(t){let e=Ve.shift();return e?Promise.resolve(e):new Promise(r=>{let n=!1,i=s=>{n||(n=!0,clearTimeout(o),r(s))},o=setTimeout(()=>{be=be.filter(s=>s!==i),i(null)},t);be.push(i)})}function qr(){Ve=[];let t=be;be=[];for(let e of t)e(null)}function Jr(t){!R||R.isDestroyed()||R.webContents.send(Kr,t)}$.ipcMain.removeAllListeners(Ot);$.ipcMain.on(Ot,(t,e,r)=>{if(!R||R.isDestroyed()||t.sender!==R.webContents)return;let n=String(e??"");if(n==="close"){$e();return}if(n!=="cut"&&n!=="send"&&n!=="delete"&&n!=="open")return;let i=r??{},o=Number(i.from),s=Number(i.to);Ti({kind:n,clip:String(i.clip??""),from:Number.isFinite(o)?Math.max(0,o):0,to:Number.isFinite(s)?Math.max(0,s):0})});function Ii(t,e){let{workArea:r}=$.screen.getDisplayNearestPoint($.screen.getCursorScreenPoint());return{x:Math.round(r.x+(r.width-t)/2),y:Math.round(r.y+(r.height-e)/2)}}var Ai=`"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("clipper", {
    act(kind, payload) {
        ipcRenderer.send(${V(Ot)}, String(kind), payload);
    },
    onReply(handler) {
        ipcRenderer.on(${V(Kr)}, (_event, reply) => handler(reply));
    }
});
`;function Ri(t,e){return`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src file:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
    html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; user-select: none; }
    .card {
        position: absolute; inset: 0; display: flex; flex-direction: column;
        border-radius: 12px; overflow: hidden; background: #101114;
        border: 1px solid rgba(255, 255, 255, 0.14); box-shadow: 0 14px 40px rgba(0, 0, 0, 0.7);
        font: 12px/1.35 "gg sans", "Segoe UI", system-ui, sans-serif; color: #f2f3f5;
        opacity: 0; transition: opacity 160ms ease;
    }
    .card.up { opacity: 1; }
    .screen { position: relative; flex: 1 1 auto; min-height: 0; background: #000; }
    video { display: block; width: 100%; height: 100%; object-fit: contain; }
    .name {
        position: absolute; left: 10px; top: 8px; max-width: 70%; padding: 3px 8px; border-radius: 6px;
        background: rgba(0, 0, 0, 0.55); font-size: 11px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .controls { flex: none; padding: 10px 12px 11px; display: flex; flex-direction: column; gap: 8px; }
    .track { position: relative; height: 22px; cursor: pointer; }
    .rail { position: absolute; left: 0; right: 0; top: 8px; height: 6px; border-radius: 3px; background: #2c2f36; }
    .range { position: absolute; top: 8px; height: 6px; border-radius: 3px; background: #3c437e; }
    .played { position: absolute; top: 8px; height: 6px; border-radius: 3px; background: #5865f2; }
    .mark { position: absolute; top: 3px; width: 2px; height: 16px; margin-left: -1px; border-radius: 1px; background: #f0b132; }
    .handle {
        position: absolute; top: 1px; width: 8px; height: 20px; margin-left: -4px; border-radius: 3px;
        background: #f2f3f5; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.6); cursor: ew-resize;
    }
    .head { position: absolute; top: 0; width: 2px; height: 22px; margin-left: -1px; background: #fff; pointer-events: none; }
    .row { display: flex; align-items: center; gap: 6px; }
    .spacer { flex: 1 1 auto; }
    .time { font-variant-numeric: tabular-nums; opacity: 0.75; }
    button {
        font: inherit; color: #f2f3f5; background: #2b2d31; border: 0; border-radius: 6px;
        padding: 5px 10px; cursor: pointer;
    }
    button:hover { background: #3a3d44; }
    button:disabled { opacity: 0.4; cursor: default; }
    button.go { background: #5865f2; }
    button.go:hover { background: #4752c4; }
    button.danger:hover { background: #b5292d; }
    .status { min-height: 15px; font-size: 11px; opacity: 0.75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .status.bad { color: #fa777c; opacity: 1; }
    /* Where the panels that come later - speed, volume, captions - mount. They
       speak the same channel, so nothing below them has to change. */
    .panels:empty { display: none; }
</style>
</head>
<body>
<div class="card" id="card">
    <div class="screen">
        <video id="video" playsinline></video>
        <div class="name" id="name"></div>
    </div>
    <div class="controls">
        <div class="track" id="track">
            <div class="rail"></div>
            <div class="range" id="range"></div>
            <div class="played" id="played"></div>
            <div id="marks"></div>
            <div class="handle" id="handleIn"></div>
            <div class="handle" id="handleOut"></div>
            <div class="head" id="head"></div>
        </div>
        <div class="panels" id="panels"></div>
        <div class="row">
            <button id="play" data-do="play">Pause</button>
            <span class="time" id="time">0:00 / 0:00</span>
            <button data-do="in" title="I">In</button>
            <button data-do="out" title="O">Out</button>
            <button data-do="all">All</button>
            <span class="spacer"></span>
            <button class="go" data-do="cut">Cut</button>
            <button class="go" data-do="send">Send</button>
            <button class="danger" data-do="delete">Delete</button>
            <button data-do="open">Studio</button>
            <button data-do="close" title="Esc">Close</button>
        </div>
        <div class="status" id="status"></div>
    </div>
</div>
<script>
    var clip = ${V({name:t.name,url:(0,Hr.pathToFileURL)(t.path).href,markers:t.markers})};
    var look = ${V(e)};
    var api = window.clipper;

    var el = {};
    ["card", "video", "name", "track", "range", "played", "marks", "handleIn", "handleOut", "head", "play", "time", "status"]
        .forEach(function (id) { el[id] = document.getElementById(id); });

    el.name.textContent = clip.name;

    var length = 0;
    var inAt = 0;
    var outAt = 0;
    var busy = false;
    var armed = false;
    var armedTimer = 0;

    function clamp(value, low, high) { return value < low ? low : value > high ? high : value; }

    function stamp(seconds) {
        var whole = Math.max(0, Math.floor(seconds || 0));
        var rest = whole % 60;
        return Math.floor(whole / 60) + ":" + (rest < 10 ? "0" : "") + rest;
    }

    function percent(seconds) { return (length > 0 ? clamp(seconds / length, 0, 1) * 100 : 0) + "%"; }

    function span(from, to) {
        return (length > 0 ? clamp((to - from) / length, 0, 1) * 100 : 0) + "%";
    }

    function draw() {
        var at = el.video.currentTime || 0;

        el.range.style.left = percent(inAt);
        el.range.style.width = span(inAt, outAt);

        el.played.style.left = percent(inAt);
        el.played.style.width = span(inAt, clamp(at, inAt, outAt));

        el.head.style.left = percent(at);
        el.handleIn.style.left = percent(inAt);
        el.handleOut.style.left = percent(outAt);

        el.time.textContent = stamp(at - inAt) + " / " + stamp(outAt - inAt);
    }

    function say(text, bad) {
        el.status.textContent = text || "";
        el.status.className = bad ? "status bad" : "status";
    }

    function disarm() {
        if (!armed) return;
        armed = false;
        clearTimeout(armedTimer);
        document.querySelector("[data-do=delete]").textContent = "Delete";
    }

    function working(state) {
        busy = state;
        var buttons = document.querySelectorAll("[data-do=cut], [data-do=send], [data-do=delete], [data-do=open]");
        for (var i = 0; i < buttons.length; i++) buttons[i].disabled = state;
    }

    function leave() {
        el.card.classList.remove("up");
        // The window belongs to the main process; asking it to close is the
        // same door the keybind uses.
        if (api) api.act("close", {});
        else window.close();
    }

    function ask(kind) {
        if (busy) return;
        if (!api) { say("This overlay cannot reach the client", true); return; }
        if (!(outAt > inAt)) { say("Nothing is selected", true); return; }

        working(true);
        say("Working...");
        api.act(kind, { clip: clip.name, from: inAt, to: outAt });
    }

    if (api) api.onReply(function (reply) {
        working(false);
        say(reply && reply.message, !(reply && reply.ok));
        if (reply && reply.close) setTimeout(leave, 700);
    });

    /* ------------------------------------------------------------ playback */

    el.video.addEventListener("loadedmetadata", function () {
        length = isFinite(el.video.duration) ? el.video.duration : 0;
        outAt = length;
        drawMarks();
        draw();
        el.card.classList.add("up");
    });

    el.video.addEventListener("timeupdate", function () {
        // Playback stays inside the selection, so the handles are heard as well
        // as seen: what loops is what a cut would keep.
        if (el.video.currentTime < inAt - 0.25 || el.video.currentTime > outAt) el.video.currentTime = inAt;
        draw();
    });

    el.video.addEventListener("play", function () { el.play.textContent = "Pause"; });
    el.video.addEventListener("pause", function () { el.play.textContent = "Play"; });
    el.video.addEventListener("error", function () { say("That clip cannot be played here", true); });

    el.video.volume = clamp((look.volume || 0) / 100, 0, 1);
    el.video.muted = !(look.volume > 0);
    el.video.src = clip.url;

    // Sound needs a gesture this window has not had yet; muted always plays.
    el.video.play().catch(function () {
        el.video.muted = true;
        el.video.play().catch(function () { say("That clip cannot be played here", true); });
    });

    /* ----------------------------------------------------------- the ruler */

    function timeAt(event) {
        var box = el.track.getBoundingClientRect();
        return clamp((event.clientX - box.left) / (box.width || 1), 0, 1) * length;
    }

    function drag(handle, move) {
        handle.addEventListener("pointerdown", function (event) {
            event.preventDefault();
            event.stopPropagation();
            handle.setPointerCapture(event.pointerId);

            var onMove = function (moved) { move(timeAt(moved)); draw(); };
            var onUp = function () {
                handle.removeEventListener("pointermove", onMove);
                handle.removeEventListener("pointerup", onUp);
            };

            handle.addEventListener("pointermove", onMove);
            handle.addEventListener("pointerup", onUp);
        });
    }

    drag(el.handleIn, function (at) {
        inAt = clamp(at, 0, Math.max(0, outAt - 0.2));
        if (el.video.currentTime < inAt) el.video.currentTime = inAt;
    });

    drag(el.handleOut, function (at) {
        outAt = clamp(at, Math.min(length, inAt + 0.2), length);
        if (el.video.currentTime > outAt) el.video.currentTime = inAt;
    });

    el.track.addEventListener("pointerdown", function (event) {
        el.video.currentTime = clamp(timeAt(event), inAt, outAt);
        draw();
    });

    function drawMarks() {
        el.marks.textContent = "";
        if (!(length > 0)) return;

        for (var i = 0; i < clip.markers.length; i++) {
            if (clip.markers[i] < 0 || clip.markers[i] > length) continue;

            var mark = document.createElement("div");
            mark.className = "mark";
            mark.style.left = percent(clip.markers[i]);
            el.marks.appendChild(mark);
        }
    }

    /* --------------------------------------------------------- the buttons */

    var doing = {
        play: function () { if (el.video.paused) el.video.play().catch(function () {}); else el.video.pause(); },
        "in": function () { inAt = clamp(el.video.currentTime, 0, Math.max(0, outAt - 0.2)); draw(); },
        out: function () { outAt = clamp(el.video.currentTime, Math.min(length, inAt + 0.2), length); draw(); },
        all: function () { inAt = 0; outAt = length; el.video.currentTime = 0; draw(); },
        cut: function () { ask("cut"); },
        send: function () { ask("send"); },
        open: function () { ask("open"); },
        close: leave,
        "delete": function () {
            // Nothing irreversible on one click, in a window opened mid-game.
            if (!armed) {
                armed = true;
                document.querySelector("[data-do=delete]").textContent = "Sure?";
                say("Press again to delete this clip");
                armedTimer = setTimeout(disarm, 4000);
                return;
            }

            disarm();
            ask("delete");
        }
    };

    document.addEventListener("click", function (event) {
        var button = event.target.closest ? event.target.closest("[data-do]") : null;
        if (!button) return;

        var what = button.getAttribute("data-do");
        if (what !== "delete") disarm();
        if (doing[what]) doing[what]();
    });

    document.addEventListener("keydown", function (event) {
        var step = event.shiftKey ? 5 : 1;

        if (event.key === "Escape") leave();
        else if (event.key === " ") doing.play();
        else if (event.key === "ArrowLeft") el.video.currentTime = clamp(el.video.currentTime - step, inAt, outAt);
        else if (event.key === "ArrowRight") el.video.currentTime = clamp(el.video.currentTime + step, inAt, outAt);
        else if (event.key === "i" || event.key === "I") doing["in"]();
        else if (event.key === "o" || event.key === "O") doing.out();
        else return;

        event.preventDefault();
        draw();
    });

    draw();
</script>
</body>
</html>`}function Xr(t,e){if(!nt())return!1;$e(),ae(),we();let r=Math.max(360,Math.round(e.width)),n=Math.round(r*9/16)+ki,{x:i,y:o}=Ii(r,n),s=Fe("studio-preload.js",Ai),a=Fe("studio.html",Ri(t,e)),c=new $.BrowserWindow({width:r,height:n,x:i,y:o,frame:!1,transparent:!0,backgroundColor:"#00000000",resizable:!1,movable:!1,minimizable:!1,maximizable:!1,fullscreenable:!1,skipTaskbar:!0,hasShadow:!1,alwaysOnTop:!0,show:!1,webPreferences:{preload:s,nodeIntegration:!1,contextIsolation:!0,sandbox:!0,backgroundThrottling:!1}});return R=c,c.setAlwaysOnTop(!0,"screen-saver"),c.setVisibleOnAllWorkspaces(!0,{visibleOnFullScreen:!0}),c.on("closed",()=>{R===c&&(R=null)}),c.loadFile(a).then(()=>{c.isDestroyed()||(c.show(),c.focus())}).catch(()=>{c.isDestroyed()||c.destroy()}),!0}$.app.on("will-quit",()=>$e());l();function ze(t){return`${t.replace(/\.(webm|mp4)$/i,"")}.thumb.jpg`}var tn=!0,$t=!1,rn=/vesktop|equibop/i.test(g.app.getName());function x(t){let e=t?.trim();return e&&(0,d.isAbsolute)(e)?e:(0,d.join)(g.app.getPath("videos"),"DiscordClips")}function Ee(t){let r=(0,d.basename)(String(t??"").replace(/[\\/]/g,"_")).trim().replace(/[<>:"|?*\x00-\x1f]/g,"_").replace(/^\.+/,""),n=/^([\w.\-+ ()[\]]{1,120})\.(webm|mp4|png|jpg|gif)$/i.exec(r);return n?`${n[1]}.${n[2].toLowerCase()}`:null}function ke(t){return Ee(t)??`clip-${Date.now()}.webm`}function zt(t,e){let r=(0,d.extname)(e),n=e.slice(0,e.length-r.length),i=(0,d.join)(t,e);for(let o=2;(0,f.existsSync)(i)&&o<1e3;o++)i=(0,d.join)(t,`${n} (${o})${r}`);return i}function Ci(t,e,r,n,i=!1){let o=x(e);(0,f.mkdirSync)(o,{recursive:!0});let s=ke(r),a=i?zt(o,s):(0,d.join)(o,s);return(0,f.writeFileSync)(a,Buffer.from(n)),a}function Di(t,e,r){let n=x(e);return(0,f.mkdirSync)(n,{recursive:!0}),zt(n,ke(r))}var it="voices";function Pi(t,e){let r=Ee(t);return!r||!/^\d{1,25}$/.test(String(e??""))?null:`${r.slice(0,r.length-(0,d.extname)(r).length)}.${e}.webm`}function Mi(t,e){let r=Ee(e);if(!r)return[];let n=(0,d.join)(x(t),it);if(!(0,f.existsSync)(n))return[];let i=`${r.slice(0,r.length-(0,d.extname)(r).length)}.`,o=[];for(let s of(0,f.readdirSync)(n,{withFileTypes:!0})){if(!s.isFile()||!s.name.startsWith(i)||!s.name.toLowerCase().endsWith(".webm"))continue;let a=s.name.slice(i.length,s.name.length-5);/^\d{1,25}$/.test(a)&&o.push({userId:a,file:s.name})}return o}function _i(t,e,r,n,i){let o=Pi(r,n);if(!o)return null;let s=(0,d.join)(x(e),it);(0,f.mkdirSync)(s,{recursive:!0});let a=(0,d.join)(s,o);return(0,f.writeFileSync)(a,Buffer.from(i)),a}function Oi(t,e,r){let n=(0,d.basename)(String(r??"").replace(/[\\/]/g,"_"));if(!n.toLowerCase().endsWith(".webm")||n.includes(".."))throw new Error("not a voice track");return new Uint8Array((0,f.readFileSync)((0,d.join)(x(e),it,n)))}function Li(t,e){let r=(0,d.join)(x(t),it);for(let{file:n}of Mi(t,e))try{(0,f.unlinkSync)((0,d.join)(r,n))}catch{}}function Ni(t,e){let r=x(e);if(!(0,f.existsSync)(r))return[];let n=[],i=new Set,o=(0,f.readdirSync)(r,{withFileTypes:!0});for(let s of o)s.isFile()&&i.add(s.name);for(let s of o){if(!s.isFile()||!/\.(webm|mp4)$/i.test(s.name))continue;let a=(0,d.join)(r,s.name);try{let c=(0,f.statSync)(a),p=ze(s.name);n.push({name:s.name,path:a,size:c.size,modified:c.mtimeMs,...i.has(p)?{thumb:p}:{}})}catch{}}return n.sort((s,a)=>a.modified-s.modified)}function Ui(t,e,r){let n=(0,d.join)(x(e),ke(r));return new Uint8Array((0,f.readFileSync)(n))}async function Fi(t,e,r){let n=x(e),i=ke(r),o=(0,d.join)(n,i);try{await g.shell.trashItem(o)}catch{(0,f.unlinkSync)(o)}Li(e,i);let s=(0,d.join)(n,ze(i));if((0,f.existsSync)(s))try{await g.shell.trashItem(s)}catch{try{(0,f.unlinkSync)(s)}catch{}}}function Vi(t,e,r,n){let i=x(e),o=ke(r),s=(0,d.join)(i,o),a=(0,d.extname)(o),c=Ee(n.toLowerCase().endsWith(a)?n:n+a);if(!c)throw new Error("That name cannot be used. Keep it under 120 characters, with letters, digits, spaces or - _ . + ( ) [ ]");if(c===o)return o;let h=c.toLowerCase()===o.toLowerCase()?(0,d.join)(i,c):zt(i,c);(0,f.renameSync)(s,h);let u=(0,d.join)(i,ze(o));if((0,f.existsSync)(u))try{(0,f.renameSync)(u,(0,d.join)(i,ze((0,d.basename)(h))))}catch{}return(0,d.basename)(h)}var nn="clipper-library.json";function $i(t,e){let r=(0,d.join)(x(e),nn);if(!(0,f.existsSync)(r))return"";try{return(0,f.readFileSync)(r,"utf8")}catch{return""}}function zi(t,e,r){let n=x(e);(0,f.mkdirSync)(n,{recursive:!0});let i=(0,d.join)(n,nn),o=`${i}.tmp`;(0,f.writeFileSync)(o,String(r??""),"utf8"),(0,f.renameSync)(o,i)}async function Wi(t){let e=await g.dialog.showOpenDialog({title:"Add videos to the timeline",properties:["openFile","multiSelections"],filters:[{name:"Video",extensions:["mp4","webm","mkv","mov","m4v"]}]});return e.canceled?[]:e.filePaths}var Gi=512*1024*1024;function ji(t,e){if(!(0,d.isAbsolute)(e)||!/\.(mp4|webm|mkv|mov|m4v)$/i.test(e))throw new Error("Not a video file");let r=(0,f.statSync)(e);if(r.size>Gi){let n=Math.round(r.size/1048576);throw new Error(`That video is ${n} MB; imports are capped at 512 MB. Trim it or lower its bitrate first.`)}return new Uint8Array((0,f.readFileSync)(e))}async function Bi(t){let e=await g.dialog.showOpenDialog({title:"Add sounds to the timeline",properties:["openFile","multiSelections"],filters:[{name:"Audio",extensions:["mp3","wav","ogg","opus","m4a","aac","flac","webm"]}]});return e.canceled?[]:e.filePaths}var Zi=64*1024*1024;function Hi(t,e){if(!(0,d.isAbsolute)(e)||!/\.(mp3|wav|ogg|opus|m4a|aac|flac|webm)$/i.test(e))throw new Error("Not an audio file");let r=(0,f.statSync)(e);if(r.size>Zi){let n=Math.round(r.size/1048576);throw new Error(`That sound is ${n} MB; the timeline caps them at 64 MB.`)}return new Uint8Array((0,f.readFileSync)(e))}async function Ki(t){let e=await g.dialog.showOpenDialog({title:"Add pictures and clips to the montage",properties:["openFile","multiSelections"],filters:[{name:"Pictures and clips",extensions:["png","jpg","jpeg","webp","gif","avif","bmp","mp4","webm"]},{name:"Pictures",extensions:["png","jpg","jpeg","webp","gif","avif","bmp"]},{name:"Clips",extensions:["mp4","webm"]}]});return e.canceled?[]:e.filePaths}var Yi=24*1024*1024,qi=64*1024*1024;function Ji(t,e){if(!(0,d.isAbsolute)(e)||!/\.(png|jpe?g|webp|gif|avif|bmp|mp4|webm)$/i.test(e))throw new Error("Not a picture or a clip");let r=/\.(mp4|webm)$/i.test(e),n=r?qi:Yi,i=(0,f.statSync)(e);if(i.size>n){let o=Math.round(i.size/1048576),s=Math.round(n/(1024*1024));throw new Error(`That ${r?"clip":"picture"} is ${o} MB; the montage caps them at ${s} MB.`)}return new Uint8Array((0,f.readFileSync)(e))}function Xi(t,e,r){g.shell.showItemInFolder((0,d.join)(x(e),ke(r)))}function Qi(t,e){return x(e)}async function eo(t,e){let r=await g.dialog.showOpenDialog({title:"Where should clips be saved?",defaultPath:x(e),properties:["openDirectory","createDirectory"]});return r.canceled?"":r.filePaths[0]??""}function to(t,e){let r=x(e);(0,f.mkdirSync)(r,{recursive:!0}),g.shell.openPath(r)}function ro(t){return{platform:"win32",wayland:$t,vesktop:rn,overlay:nt()}}var J=new Set;async function no(t,e=!0){if($t)return[];let r=await g.desktopCapturer.getSources({types:["screen","window"],thumbnailSize:e?{width:320,height:180}:{width:0,height:0},fetchWindowIcons:!1});if(J.size){let i=new Set(r.map(o=>o.id));for(let o of J)i.has(o)||J.delete(o)}let n=[];for(let i of r){let o=i.id.startsWith("screen:");if(!e){if(!o&&J.has(i.id))continue;n.push({id:i.id,name:i.name,thumbnail:""});continue}let s=i.thumbnail.isEmpty();if(tn&&!o&&s){J.add(i.id);continue}J.delete(i.id),n.push({id:i.id,name:i.name,thumbnail:s?"":i.thumbnail.toDataURL(),capturable:!0})}return n}async function io(t){try{return g.app.getAppMetrics().map(e=>({type:e.serviceName||e.type,mb:Math.round((e.memory?.workingSetSize??0)/1024)})).filter(e=>e.mb>0).sort((e,r)=>r.mb-e.mb)}catch{return[]}}async function oo(t){if($t)return"";let e=await g.desktopCapturer.getSources({types:["screen"],thumbnailSize:{width:0,height:0}});if(!e.length)return"";try{let r=g.screen.getDisplayNearestPoint(g.screen.getCursorScreenPoint()),n=e.find(i=>i.display_id===String(r.id));if(n)return n.id}catch{}return e[0].id}var Nt="",Ut=!1;function so(t,e,r=!0){return!r||rn?!1:(Nt=e??"",Ut=!0,g.session.defaultSession.setDisplayMediaRequestHandler(async(n,i)=>{let o=await g.desktopCapturer.getSources({types:["screen","window"],thumbnailSize:{width:0,height:0}}),s=o.find(p=>p.id===Nt),c=(s&&!J.has(s.id)?s:void 0)??o.find(p=>p.id.startsWith("screen:"))??o.find(p=>!J.has(p.id));if(!c){i({});return}i(tn&&c.id.startsWith("screen:")?{video:c,audio:"loopback"}:{video:c})},{useSystemPicker:!1}),!0)}function ao(t){Nt="",Ut&&(Ut=!1,g.session.defaultSession.setDisplayMediaRequestHandler(null))}var Ft=new Map,xe=[],We=[];function co(t){let e=xe.shift();if(e){e(t);return}We.push(t),We.length>8&&We.shift()}function lo(t,e){Wt();let r=[];for(let[n,i]of Object.entries(e)){if(!i)continue;let o=!1;try{o=g.globalShortcut.register(i,()=>co(n))}catch{o=!1}o?Ft.set(n,i):r.push(i)}return r}function Wt(t){for(let r of Ft.values())try{g.globalShortcut.unregister(r)}catch{}Ft.clear(),We=[];let e=xe;xe=[];for(let r of e)r(null)}function uo(t,e=3e4){let r=We.shift();return r?Promise.resolve(r):new Promise(n=>{let i=!1,o=a=>{i||(i=!0,clearTimeout(s),n(a))},s=setTimeout(()=>{xe=xe.filter(a=>a!==o),o(null)},e);xe.push(o)})}g.app.on("will-quit",()=>Wt());var fo=["top-left","top-right","bottom-left","bottom-right"];function Se(t,e,r,n){let i=Number(t);return Number.isFinite(i)?Math.min(r,Math.max(e,Math.round(i))):n}function on(t){return fo.includes(t)?t:"bottom-right"}function po(t){return{corner:on(t?.corner),width:Se(t?.width,200,1280,420),volume:Se(t?.volume,0,100,0),seconds:Se(t?.seconds,0,300,10)}}function Vt(t,e){return String(t??"").replace(/\s+/g," ").trim().slice(0,e)}function ho(t,e,r,n){let i=Ee(r);if(!i)return!1;let o=(0,d.join)(x(e),i);return(0,f.existsSync)(o)?Br(o,po(n)):!1}function mo(t,e,r,n){return g.BrowserWindow.getFocusedWindow()||Lt()?!1:Zr(Vt(e,60),Vt(r,90),on(n))}function vo(t){ae()}var go=200;function yo(t){return Array.isArray(t)?t.map(Number).filter(e=>Number.isFinite(e)&&e>=0).slice(0,go):[]}function wo(t){return{width:Se(t?.width,360,1600,720),volume:Se(t?.volume,0,100,0)}}function bo(t,e,r,n,i){let o=Ee(r);if(!o)return!1;let s=(0,d.join)(x(e),o);return(0,f.existsSync)(s)?Xr({name:o,path:s,markers:yo(n)},wo(i)):!1}function xo(t){$e()}function So(t){return Lt()}function Eo(t,e=3e4){return Yr(Se(e,1e3,12e4,3e4))}function ko(t){qr()}function To(t,e,r,n){Jr({ok:!!e,message:Vt(r,120),close:!!n})}function Io(t){let e=g.BrowserWindow.fromWebContents(t.sender);!e||e.isDestroyed()||(e.isMinimized()&&e.restore(),e.show(),e.focus())}var Ge="kebab1337420/vencord-clipper",Ao=`VencordClipper (+https://github.com/${Ge})`,Ro=["patcher.js","patcher.js.LEGAL.txt","preload.js","renderer.css","renderer.js","renderer.js.LEGAL.txt","vencordDesktopMain.js","vencordDesktopMain.js.LEGAL.txt","vencordDesktopPreload.js","vencordDesktopRenderer.css","vencordDesktopRenderer.js","vencordDesktopRenderer.js.LEGAL.txt"];function ot(t,e=0){return new Promise((r,n)=>{let i=(0,en.get)(t,{headers:{"User-Agent":Ao,Accept:"*/*"}},o=>{let s=o.statusCode??0,{location:a}=o.headers;if(s>=300&&s<400&&a){o.resume(),e>=5?n(new Error(`Too many redirects for ${t}`)):r(ot(new URL(a,t).toString(),e+1));return}let c=[];o.on("data",p=>c.push(p)),o.on("end",()=>r({status:s,body:Buffer.concat(c)})),o.on("error",n)});i.setTimeout(6e4,()=>i.destroy(new Error(`${t} timed out`))),i.on("error",n)})}async function Co(t){let{status:e,body:r}=await ot(t);if(e!==200)throw new Error(`${t} answered ${e}`);return r}function sn(){return __dirname}function an(t){return(0,f.existsSync)((0,d.join)(t,"patcher.js"))&&(0,f.existsSync)((0,d.join)(t,"renderer.js"))}function cn(t){try{return(0,f.accessSync)(t,f.constants.W_OK),!0}catch{return!1}}function Do(t,e){let r=o=>o.replace(/^v/i,"").split(/[.\-+]/).map(s=>Number(s)||0),n=r(t),i=r(e);for(let o=0;o<3;o++)if((n[o]??0)!==(i[o]??0))return(n[o]??0)>(i[o]??0);return!1}async function Po(t,e){let r=await Co(`https://api.github.com/repos/${Ge}/releases/latest`),n=JSON.parse(r.toString("utf8")),i=String(n.tag_name??""),o=i.replace(/^v/i,""),s=sn();return{version:o,tag:i,available:!!o&&Do(o,e),notes:String(n.body??"").trim().slice(0,1200),url:String(n.html_url??`https://github.com/${Ge}/releases`),directory:s,writable:an(s)&&cn(s)}}async function Mo(t){let{status:e,body:r}=await ot(`https://raw.githubusercontent.com/${Ge}/${t}/prebuilt/build-info.json`);if(e!==200)return null;try{let{files:n}=JSON.parse(r.toString("utf8"));return n&&typeof n=="object"?n:null}catch{return null}}async function _o(t,e){if(!/^[\w.-]{1,40}$/.test(e))throw new Error(`Refusing to fetch a release named ${e}`);let r=sn();if(!an(r))throw new Error(`No installed bundle at ${r}`);if(!cn(r))throw new Error(`${r} is read-only`);let n=await Mo(e),i=n?Object.keys(n):Ro,o=(0,d.join)(r,".clipper-update");(0,f.rmSync)(o,{recursive:!0,force:!0}),(0,f.mkdirSync)(o,{recursive:!0});try{let s=[];for(let a of i){if(a!==(0,d.basename)(a)||a.startsWith("."))throw new Error(`Refusing a release file named ${a}`);let{status:c,body:p}=await ot(`https://raw.githubusercontent.com/${Ge}/${e}/prebuilt/dist/${a}`);if(c===404&&!n)continue;if(c!==200)throw new Error(`${a} answered ${c}`);if(p.length===0)throw new Error(`${a} came back empty`);let h=n?.[a];if(h?.size!==void 0&&p.length!==h.size)throw new Error(`${a} is ${p.length} bytes, the release says ${h.size}`);if(h?.sha256&&(0,Qr.createHash)("sha256").update(p).digest("hex").toLowerCase()!==h.sha256.toLowerCase())throw new Error(`${a} does not match its hash`);(0,f.writeFileSync)((0,d.join)(o,a),p),s.push(a)}if(s.length===0)throw new Error(`There is no bundle published under ${e}`);for(let a of["renderer.js","patcher.js"])if(!s.includes(a))throw new Error(`The release carries no ${a}`);if(!(0,f.readFileSync)((0,d.join)(o,"renderer.js")).includes("Clipper"))throw new Error("There is no Clipper in that release's renderer");for(let a of s)(0,f.renameSync)((0,d.join)(o,a),(0,d.join)(r,a));return s}finally{(0,f.rmSync)(o,{recursive:!0,force:!0})}}function Oo(t){g.app.relaunch(),g.app.quit(),setTimeout(()=>g.app.exit(0),3e3)}var ln={AppleMusicRichPresence:xt,ConsoleShortcuts:St,FixSpotifyEmbeds:Mr,FixYoutubeEmbeds:Or,OpenInApp:Rt,Translate:Ct,VoiceMessages:Dt,XSOverlay:Pt,YoutubeAdblock:$r,Clipper:Gt};var un={};for(let[t,e]of Object.entries(ln)){let r=Object.entries(e);if(!r.length)continue;let n=un[t]={};for(let[i,o]of r){let s=`VencordPluginNative_${t}_${i}`;jt.ipcMain.handle(s,o),n[i]=s}}jt.ipcMain.on("VencordGetPluginIpcMethodMap",t=>{t.returnValue=un});l();function Bt(t,e=300){let r;return function(...n){clearTimeout(r),r=setTimeout(()=>{t(...n)},e)}}ve();var w=require("electron");l();var fn="PCFkb2N0eXBlIGh0bWw+PGh0bWwgbGFuZz0iZW4iPjxoZWFkPjxtZXRhIGNoYXJzZXQ9InV0Zi04Ij48dGl0bGU+VmVuY29yZCBRdWlja0NTUyBFZGl0b3I8L3RpdGxlPjxsaW5rIHJlbD0ic3R5bGVzaGVldCIgaHJlZj0iaHR0cHM6Ly9jZG4uanNkZWxpdnIubmV0L25wbS9tb25hY28tZWRpdG9yQDAuNTAuMC9taW4vdnMvZWRpdG9yL2VkaXRvci5tYWluLmNzcyIgaW50ZWdyaXR5PSJzaGEyNTYtdGlKUFEyTzA0ei9wWi9Bd2R5SWdock9NemV3ZitQSXZFbDFZS2JRdnNaaz0iIGNyb3Nzb3JpZ2luPSJhbm9ueW1vdXMiIHJlZmVycmVycG9saWN5PSJuby1yZWZlcnJlciI+PHN0eWxlPiNjb250YWluZXIsYm9keSxodG1se3Bvc2l0aW9uOmFic29sdXRlO2xlZnQ6MDt0b3A6MDt3aWR0aDoxMDAlO2hlaWdodDoxMDAlO21hcmdpbjowO3BhZGRpbmc6MDtvdmVyZmxvdzpoaWRkZW59PC9zdHlsZT48L2hlYWQ+PGJvZHk+PGRpdiBpZD0iY29udGFpbmVyIj48L2Rpdj48c2NyaXB0IHNyYz0iaHR0cHM6Ly9jZG4uanNkZWxpdnIubmV0L25wbS9tb25hY28tZWRpdG9yQDAuNTAuMC9taW4vdnMvbG9hZGVyLmpzIiBpbnRlZ3JpdHk9InNoYTI1Ni1LY1U0OFRHcjg0cjd1bkY3SjVJZ0JvOTVhZVZyRWJyR2UwNFM3VGNGVWpzPSIgY3Jvc3NvcmlnaW49ImFub255bW91cyIgcmVmZXJyZXJwb2xpY3k9Im5vLXJlZmVycmVyIj48L3NjcmlwdD48c2NyaXB0PnJlcXVpcmUuY29uZmlnKHtwYXRoczp7dnM6Imh0dHBzOi8vY2RuLmpzZGVsaXZyLm5ldC9ucG0vbW9uYWNvLWVkaXRvckAwLjUwLjAvbWluL3ZzIn19KSxyZXF1aXJlKFsidnMvZWRpdG9yL2VkaXRvci5tYWluIl0sKCgpPT57Z2V0Q3VycmVudENzcygpLnRoZW4oKGU9Pnt2YXIgdD1tb25hY28uZWRpdG9yLmNyZWF0ZShkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiY29udGFpbmVyIikse3ZhbHVlOmUsbGFuZ3VhZ2U6ImNzcyIsdGhlbWU6Z2V0VGhlbWUoKX0pO3Qub25EaWRDaGFuZ2VNb2RlbENvbnRlbnQoKCgpPT5zZXRDc3ModC5nZXRWYWx1ZSgpKSkpLHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCJyZXNpemUiLCgoKT0+e3QubGF5b3V0KCl9KSl9KSl9KSk8L3NjcmlwdD48L2JvZHk+PC9odG1sPg==";var ce=require("fs"),Q=require("fs/promises"),xn=require("os"),Jt=require("path");l();ve();var Te=require("electron");l();var Zt=require("electron"),N=["connect-src"],M=[...N,"img-src"],hn=["style-src","font-src"],pn=[...M,"media-src"],S=[...M,...hn],dn=[...S,"script-src","worker-src"],Kt={"http://localhost:*":S,"http://127.0.0.1:*":S,"localhost:*":S,"127.0.0.1:*":S,"*.github.io":S,"github.com":S,"raw.githubusercontent.com":S,"*.gitlab.io":S,"gitlab.com":S,"*.codeberg.page":S,"codeberg.org":S,"*.githack.com":S,"jsdelivr.net":S,"fonts.googleapis.com":hn,"i.imgur.com":M,"i.ibb.co":M,"i.pinimg.com":M,"files.catbox.moe":S,"cdn.discordapp.com":S,"media.discordapp.net":M,"cdnjs.cloudflare.com":dn,"cdn.jsdelivr.net":dn,"api.github.com":N,"ws.audioscrobbler.com":N,"musicbrainz.org":N,"*.listenbrainz.org":N,"coverartarchive.org":N,"archive.org":N,"*.archive.org":N,"translate-pa.googleapis.com":N,"*.vencord.dev":M,"manti.vendicated.dev":M,"decor.fieryflames.dev":N,"ugc.decor.fieryflames.dev":M,"sponsor.ajay.app":N,"dearrow-thumb.ajay.app":M,"usrbg.is-hardly.online":M,"icons.duckduckgo.com":M,"*.tenor.com":pn,"*.tenor.co":pn},Ht=(t,e)=>Object.keys(t).find(r=>r.toLowerCase()===e),Lo=t=>{let e={};return t.split(";").forEach(r=>{let[n,...i]=r.trim().split(/\s+/g);n&&!Object.prototype.hasOwnProperty.call(e,n)&&(e[n]=i)}),e},No=t=>Object.entries(t).filter(([,e])=>e?.length).map(e=>e.flat().join(" ")).join("; "),Uo=t=>{let e=Ht(t,"content-security-policy-report-only");e&&delete t[e];let r=Ht(t,"content-security-policy");if(r){let n=Lo(t[r][0]),i=(o,...s)=>{n[o]??=[...n["default-src"]??[]],n[o].push(...s)};i("style-src","'unsafe-inline'"),i("script-src","'unsafe-inline'","'unsafe-eval'");for(let o of["style-src","connect-src","img-src","font-src","media-src","worker-src"])i(o,"blob:","data:","vencord:","vesktop:");for(let[o,s]of Object.entries(F.store.customCspRules))for(let a of s)i(a,o);for(let[o,s]of Object.entries(Kt))for(let a of s)i(a,o);t[r]=[No(n)]}};function mn(){Zt.session.defaultSession.webRequest.onHeadersReceived(({responseHeaders:t,resourceType:e},r)=>{if(t&&(e==="mainFrame"&&Uo(t),e==="stylesheet")){let n=Ht(t,"content-type");n&&(t[n]=["text/css"])}r({cancel:!1,responseHeaders:t})}),Zt.session.defaultSession.webRequest.onHeadersReceived=()=>{}}function vn(){Te.ipcMain.handle("VencordCspRemoveOverride",zo),Te.ipcMain.handle("VencordCspRequestAddOverride",$o),Te.ipcMain.handle("VencordCspIsDomainAllowed",Wo)}function Fo(t,e){try{let{host:r}=new URL(t);if(/[;'"\\]/.test(r))return!1}catch{return!1}return!(e.length===0||e.some(r=>!S.includes(r)))}function Vo(t,e,r){let n=new URL(t).host,i=`${r} wants to allow connections to ${n}`,o=`Unless you recognise and fully trust ${n}, you should cancel this request!

You will have to fully close and restart Vesktop for the changes to take effect.`;if(e.length===1&&e[0]==="connect-src")return{message:i,detail:o};let s=e.filter(a=>a!=="connect-src").map(a=>{switch(a){case"img-src":return"Images";case"style-src":return"CSS & Themes";case"font-src":return"Fonts";default:throw new Error(`Illegal CSP directive: ${a}`)}}).sort().join(", ");return o=`The following types of content will be allowed to load from ${n}:
${s}

${o}`,{message:i,detail:o}}async function $o(t,e,r,n){if(!Fo(e,r))return"invalid";let i=new URL(e).host;if(i in F.store.customCspRules)return"conflict";let{checkboxChecked:o,response:s}=await Te.dialog.showMessageBox({...Vo(e,r,n),type:n?"info":"warning",title:"Vencord Host Permissions",buttons:["Cancel","Allow"],defaultId:0,cancelId:0,checkboxLabel:`I fully trust ${i} and understand the risks of allowing connections to it.`,checkboxChecked:!1});return s!==1?"cancelled":o?(F.store.customCspRules[i]=r,"ok"):"unchecked"}function zo(t,e){return e in F.store.customCspRules?(delete F.store.customCspRules[e],!0):!1}function Wo(t,e,r){try{let n=new URL(e).host,i=Kt[n]??F.store.customCspRules[n];return i?r.every(o=>i.includes(o)):!1}catch{return!1}}l();var Go=/[^\S\r\n]*?\r?(?:\r\n|\n)[^\S\r\n]*?\*[^\S\r\n]?/,jo=/^\\@/;function Yt(t,e={}){return{fileName:t,name:e.name??t.replace(/\.css$/i,""),author:e.author??"Unknown Author",description:e.description??"A Discord Theme.",version:e.version,license:e.license,source:e.source,website:e.website,invite:e.invite}}function gn(t){return t.charCodeAt(0)===65279&&(t=t.slice(1)),t}function yn(t,e){if(!t)return Yt(e);let r=t.split("/**",2)?.[1]?.split("*/",1)?.[0];if(!r)return Yt(e);let n={},i="",o="";for(let s of r.split(Go))if(s.length!==0)if(s.charAt(0)==="@"&&s.charAt(1)!==" "){n[i]=o.trim();let a=s.indexOf(" ");i=s.substring(1,a),o=s.substring(a+1)}else o+=" "+s.replace("\\n",`
`).replace(jo,"@");return n[i]=o.trim(),delete n[""],Yt(e,n)}l();var Ie=require("path");function X(t,e){let r=(0,Ie.normalize)(t+"/"),n=(0,Ie.join)(t,e),i=(0,Ie.normalize)(n);return i===(0,Ie.normalize)(t)||i.startsWith(r)?i:null}l();var wn=require("electron");function bn(t){t.webContents.setWindowOpenHandler(({url:e})=>{switch(e){case"about:blank":case"https://discord.com/popout":case"https://ptb.discord.com/popout":case"https://canary.discord.com/popout":return{action:"allow"}}try{var{protocol:r}=new URL(e)}catch{return{action:"deny"}}switch(r){case"http:":case"https:":case"mailto:":case"steam:":case"spotify:":wn.shell.openExternal(e)}return{action:"deny"}})}var Bo=(0,Jt.join)(__dirname,"vencordDesktopRenderer.css");(0,ce.mkdirSync)(Y,{recursive:!0});vn();function Sn(){return(0,Q.readFile)(ye,"utf-8").catch(()=>"")}async function Zo(){let t=await(0,Q.readdir)(Y).catch(()=>[]),e=[];for(let r of t){if(!r.endsWith(".css"))continue;let n=await En(r).then(gn).catch(()=>null);n!=null&&e.push(yn(n,r))}return e}function En(t){t=t.replace(/\?v=\d+$/,"");let e=X(Y,t);return e?(0,Q.readFile)(e,"utf-8"):Promise.reject(`Unsafe path ${t}`)}w.ipcMain.handle("VencordOpenQuickCss",()=>w.shell.openPath(ye));w.ipcMain.handle("VencordOpenExternal",(t,e)=>{try{var{protocol:r}=new URL(e)}catch{throw"Malformed URL"}if(!Rr.includes(r))throw"Disallowed protocol.";w.shell.openExternal(e).catch(n=>console.error("[Vencord] Failed to open external link",e,n))});w.ipcMain.handle("VencordGetQuickCss",()=>Sn());w.ipcMain.handle("VencordSetQuickCss",(t,e)=>(0,ce.writeFileSync)(ye,e));w.ipcMain.handle("VencordGetThemesList",()=>Zo());w.ipcMain.handle("VencordGetThemeData",(t,e)=>En(e));w.ipcMain.handle("VencordGetThemeSystemValues",()=>{let t=w.systemPreferences.getAccentColor?.()??"";return t.length&&t[0]!=="#"&&(t=`#${t}`),{"os-accent-color":t}});w.ipcMain.handle("VencordOpenThemesFolder",()=>w.shell.openPath(Y));w.ipcMain.handle("VencordOpenSettingsFolder",()=>w.shell.openPath(re));var qt=[];w.ipcMain.handle("VencordInitFileWatchers",({sender:t})=>{qt.forEach(i=>i.close());let e,r;(0,Q.open)(ye,"a+").then(i=>{i.close(),e=(0,ce.watch)(ye,{persistent:!1},Bt(async()=>{t.postMessage("VencordQuickCssUpdate",await Sn())},50))}).catch(()=>{});let n=(0,ce.watch)(Y,{persistent:!1},Bt(()=>{t.postMessage("VencordThemeUpdate",void 0)}));qt=[e,n,r].filter(Boolean),t.once("destroyed",()=>{e?.close(),n.close(),r?.close(),qt=[]})});w.ipcMain.on("VencordGetMonacoTheme",t=>{t.returnValue=w.nativeTheme.shouldUseDarkColors?"vs-dark":"vs-light"});w.ipcMain.handle("VencordOpenMonacoEditor",async()=>{let t="Vencord QuickCSS Editor",e=w.BrowserWindow.getAllWindows().find(n=>n.title===t);if(e&&!e.isDestroyed()){e.focus();return}let r=new w.BrowserWindow({title:t,autoHideMenuBar:!0,darkTheme:!0,backgroundColor:w.nativeTheme.shouldUseDarkColors?"#1e1e1e":"white",webPreferences:{preload:(0,Jt.join)(__dirname,"vencordDesktopPreload.js"),contextIsolation:!0,nodeIntegration:!1,sandbox:!1}});bn(r),await r.loadURL(`data:text/html;base64,${fn}`)});w.ipcMain.handle("VencordGetRendererCss",()=>(0,Q.readFile)(Bo,"utf-8"));w.ipcMain.on("VencordSupportsWindowsMaterial",t=>{t.returnValue=Number((0,xn.release)().split(".")[2])>=22621});var ue=require("electron"),Bn=require("path"),sr=require("url");l();var pt=require("electron");l();var In=require("module"),Ho=(0,In.createRequire)("/"),Ae,at,Qt,Ko=";var __w=require('worker_threads');__w.parentPort.on('message',function(m){onmessage({data:m})}),postMessage=function(m,t){__w.parentPort.postMessage(m,t)},close=process.exit;self=global";try{Ae=Ho("worker_threads"),at=Ae.Worker,Qt=Ae.isMarkedAsUntransferable}catch{}var Yo=at?function(t,e,r,n,i){var o=!1,s=new at(t+Ko,{eval:!0}).on("error",function(a){return i(a,null)}).on("message",function(a){return i(null,a)}).on("exit",function(a){a&&!o&&i(new Error("exited with code "+a),null)});return Qt&&(n=n.filter(function(a){return!Qt(a)})),s.postMessage(r,n),s.terminate=function(){return o=!0,at.prototype.terminate.call(s)},s}:function(t,e,r,n,i){setImmediate(function(){return i(new Error("async operations unsupported - update to Node 12+ (or Node 10-11 with the --experimental-worker CLI flag)"),null)});var o=function(){};return{terminate:o,postMessage:o}},I=Uint8Array,le=Uint16Array,An=Int32Array,tr=new I([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0,0,0,0]),rr=new I([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13,0,0]),Rn=new I([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]),Cn=function(t,e){for(var r=new le(31),n=0;n<31;++n)r[n]=e+=1<<t[n-1];for(var i=new An(r[30]),n=1;n<30;++n)for(var o=r[n];o<r[n+1];++o)i[o]=o-r[n]<<5|n;return{b:r,r:i}},Ae=Cn(tr,2),nr=Ae.b,qo=Ae.r;nr[28]=258,qo[258]=28;var Dn=Cn(rr,0),Pn=Dn.b,ic=Dn.r,ut=new le(32768);for(y=0;y<32768;++y)B=(y&43690)>>1|(y&21845)<<1,B=(B&52428)>>2|(B&13107)<<2,B=(B&61680)>>4|(B&3855)<<4,ut[y]=((B&65280)>>8|(B&255)<<8)>>1;var B,y,Re=(function(t,e,r){for(var n=t.length,i=0,o=new le(e);i<n;++i)t[i]&&++o[t[i]-1];var s=new le(e);for(i=1;i<e;++i)s[i]=s[i-1]+o[i-1]<<1;var a;if(r){a=new le(1<<e);var c=15-e;for(i=0;i<n;++i)if(t[i])for(var p=i<<4|t[i],h=e-t[i],u=s[t[i]-1]++<<h,b=u|(1<<h)-1;u<=b;++u)a[ut[u]>>c]=p}else for(a=new le(n),i=0;i<n;++i)t[i]&&(a[i]=ut[s[t[i]-1]++]>>15-t[i]);return a}),je=new I(288);for(y=0;y<144;++y)je[y]=8;var y;for(y=144;y<256;++y)je[y]=9;var y;for(y=256;y<280;++y)je[y]=7;var y;for(y=280;y<288;++y)je[y]=8;var y,Mn=new I(32);for(y=0;y<32;++y)Mn[y]=5;var y;var _n=Re(je,9,1);var On=Re(Mn,5,1),ct=function(t){for(var e=t[0],r=1;r<t.length;++r)t[r]>e&&(e=t[r]);return e},_=function(t,e,r){var n=e/8|0;return(t[n]|t[n+1]<<8)>>(e&7)&r},lt=function(t,e){var r=e/8|0;return(t[r]|t[r+1]<<8|t[r+2]<<16)>>(e&7)},Ln=function(t){return(t+7)/8|0},ft=function(t,e,r){return(e==null||e<0)&&(e=0),(r==null||r>t.length)&&(r=t.length),new I(t.subarray(e,r))};var Nn=["unexpected EOF","invalid block type","invalid length/literal","invalid distance","stream finished","no stream handler",,"no callback","invalid UTF-8 data","extra field too long","date not in range 1980-2099","filename too long","stream finishing","invalid zip data"],k=function(t,e,r){var n=new Error(e||Nn[t]);if(n.code=t,Error.captureStackTrace&&Error.captureStackTrace(n,k),!r)throw n;return n},Un=function(t,e,r,n){var i=t.length,o=n?n.length:0;if(!i||e.f&&!e.l)return r||new I(0);var s=!r,a=s||e.i!=2,c=e.i;s&&(r=new I(i*3));var p=function(pr){var dr=r.length;if(pr>dr){var hr=new I(Math.max(dr*2,pr));hr.set(r),r=hr}},h=e.f||0,u=e.p||0,b=e.b||0,U=e.l,fe=e.d,G=e.m,C=e.n,D=i*8;do{if(!U){h=_(t,u,1);var Z=_(t,u+1,3);if(u+=3,Z)if(Z==1)U=_n,fe=On,G=9,C=5;else if(Z==2){var Ce=_(t,u,31)+257,Be=_(t,u+10,15)+4,ee=Ce+_(t,u+5,31)+1;u+=14;for(var P=new I(ee),de=new I(19),E=0;E<Be;++E)de[Rn[E]]=_(t,u+E*3,7);u+=Be*3;for(var De=ct(de),Zn=(1<<De)-1,Hn=Re(de,De,1),E=0;E<ee;){var ar=Hn[_(t,u,Zn)];u+=ar&15;var T=ar>>4;if(T<16)P[E++]=T;else{var he=0,Ze=0;for(T==16?(Ze=3+_(t,u,3),u+=2,he=P[E-1]):T==17?(Ze=3+_(t,u,7),u+=3):T==18&&(Ze=11+_(t,u,127),u+=7);Ze--;)P[E++]=he}}var cr=P.subarray(0,Ce),H=P.subarray(Ce);G=ct(cr),C=ct(H),U=Re(cr,G,1),fe=Re(H,C,1)}else k(1);else{var T=Ln(u)+4,j=t[T-4]|t[T-3]<<8,pe=T+j;if(pe>i){c&&k(0);break}a&&p(b+j),r.set(t.subarray(T,pe),b),e.b=b+=j,e.p=u=pe*8,e.f=h;continue}if(u>D){c&&k(0);break}}a&&p(b+131072);for(var Kn=(1<<G)-1,Yn=(1<<C)-1,dt=u;;dt=u){var he=U[lt(t,u)&Kn],me=he>>4;if(u+=he&15,u>D){c&&k(0);break}if(he||k(2),me<256)r[b++]=me;else if(me==256){dt=u,U=null;break}else{var lr=me-254;if(me>264){var E=me-257,Pe=tr[E];lr=_(t,u,(1<<Pe)-1)+nr[E],u+=Pe}var ht=fe[lt(t,u)&Yn],mt=ht>>4;ht||k(3),u+=ht&15;var H=Pn[mt];if(mt>3){var Pe=rr[mt];H+=lt(t,u)&(1<<Pe)-1,u+=Pe}if(u>D){c&&k(0);break}a&&p(b+131072);var ur=b+lr;if(b<H){var fr=o-H,qn=Math.min(H,ur);for(fr+b<0&&k(3);b<qn;++b)r[b]=n[fr+b]}for(;b<ur;++b)r[b]=r[b-H]}}e.l=U,e.p=dt,e.b=b,e.f=h,U&&(h=1,e.m=G,e.d=fe,e.n=C)}while(!h);return b!=r.length&&s?ft(r,0,b):r.subarray(0,b)};var Jo=new I(0);var Xo=function(t,e){var r={};for(var n in t)r[n]=t[n];for(var n in e)r[n]=e[n];return r},kn=function(t,e,r){for(var n=t(),i=t.toString(),o=i.slice(i.indexOf("[")+1,i.lastIndexOf("]")).replace(/\s+/g,"").split(","),s=0;s<n.length;++s){var a=n[s],c=o[s];if(typeof a=="function"){e+=";"+c+"=";var p=a.toString();if(a.prototype)if(p.indexOf("[native code]")!=-1){var h=p.indexOf(" ",8)+1;e+=p.slice(h,p.indexOf("(",h))}else{e+=p;for(var u in a.prototype)e+=";"+c+".prototype."+u+"="+a.prototype[u].toString()}else e+=p}else r[c]=a}return e},st=[],Qo=function(t){var e=[];for(var r in t)t[r].buffer&&e.push((t[r]=new t[r].constructor(t[r])).buffer);return e},es=function(t,e,r,n){if(!st[r]){for(var i="",o={},s=t.length-1,a=0;a<s;++a)i=kn(t[a],i,o);st[r]={c:kn(t[s],i,o),e:o}}var c=Xo({},st[r].e);return Yo(st[r].c+";onmessage=function(e){for(var k in e.data)self[k]=e.data[k];onmessage="+e.toString()+"}",r,c,Qo(c),n)},ts=function(){return[I,le,An,tr,rr,Rn,nr,Pn,_n,On,ut,Nn,Re,ct,_,lt,Ln,ft,k,Un,ir,Fn,Vn]};var Fn=function(t){return postMessage(t,[t.buffer])},Vn=function(t){return t&&{out:t.size&&new I(t.size),dictionary:t.dictionary}},rs=function(t,e,r,n,i,o){var s=es(r,n,i,function(a,c){s.terminate(),o(a,c)});return s.postMessage([t,e],e.consume?[t.buffer]:[]),function(){s.terminate()}};var z=function(t,e){return t[e]|t[e+1]<<8},O=function(t,e){return(t[e]|t[e+1]<<8|t[e+2]<<16|t[e+3]<<24)>>>0},Xt=function(t,e){return O(t,e)+O(t,e+4)*4294967296};function ns(t,e,r){return r||(r=e,e={}),typeof r!="function"&&k(7),rs(t,e,[ts],function(n){return Fn(ir(n.data[0],Vn(n.data[1])))},1,r)}function ir(t,e){return Un(t,{i:2},e&&e.out,e&&e.dictionary)}var er=typeof TextDecoder<"u"&&new TextDecoder,is=0;try{er.decode(Jo,{stream:!0}),is=1}catch{}var os=function(t){for(var e="",r=0;;){var n=t[r++],i=(n>127)+(n>223)+(n>239);if(r+i>t.length)return{s:e,r:ft(t,r-1)};i?i==3?(n=((n&15)<<18|(t[r++]&63)<<12|(t[r++]&63)<<6|t[r++]&63)-65536,e+=String.fromCharCode(55296|n>>10,56320|n&1023)):i&1?e+=String.fromCharCode((n&31)<<6|t[r++]&63):e+=String.fromCharCode((n&15)<<12|(t[r++]&63)<<6|t[r++]&63):e+=String.fromCharCode(n)}};function ss(t,e){if(e){for(var r="",n=0;n<t.length;n+=16384)r+=String.fromCharCode.apply(null,t.subarray(n,n+16384));return r}else{if(er)return er.decode(t);var i=os(t),o=i.s,r=i.r;return r.length&&k(8),o}}var as=function(t,e){return e+30+z(t,e+26)+z(t,e+28)},cs=function(t,e,r){var n=z(t,e+28),i=z(t,e+30),o=ss(t.subarray(e+46,e+46+n),!(z(t,e+8)&2048)),s=e+46+n,a=ls(t,s,i,r,O(t,e+20),O(t,e+24),O(t,e+42)),c=a[0],p=a[1],h=a[2];return[z(t,e+10),c,p,o,s+i+z(t,e+32),h]},ls=function(t,e,r,n,i,o,s){var a=i==4294967295,c=o==4294967295,p=s==4294967295,h=e+r,u=a+c+p;if(n&&u){for(;e+4<h;e+=4+z(t,e+2))if(z(t,e)==1)return[a?Xt(t,e+4+8*c):i,c?Xt(t,e+4):o,p?Xt(t,e+4+8*(c+a)):s,1];n<2&&k(13)}return[i,o,s,0]};var Tn=typeof queueMicrotask=="function"?queueMicrotask:typeof setTimeout=="function"?setTimeout:function(t){t()};function $n(t,e,r){r||(r=e,e={}),typeof r!="function"&&k(7);var n=[],i=function(){for(var C=0;C<n.length;++C)n[C]()},o={},s=function(C,D){Tn(function(){r(C,D)})};Tn(function(){s=r});for(var a=t.length-22;O(t,a)!=101010256;--a)if(!a||t.length-a>65558)return s(k(13,0,1),null),i;var c=z(t,a+8);if(c){var p=c,h=O(t,a+16),u=O(t,a-20)==117853008;if(u){var b=O(t,a-12);u=O(t,b)==101075792,u&&(p=c=O(t,b+32),h=O(t,b+48))}for(var U=e&&e.filter,fe=function(C){var D=cs(t,h,u),Z=D[0],T=D[1],j=D[2],pe=D[3],Ce=D[4],Be=D[5],ee=as(t,Be);h=Ce;var P=function(E,De){E?(i(),s(E,null)):(De&&(o[pe]=De),--c||s(null,o))};if(!U||U({name:pe,size:T,originalSize:j,compression:Z}))if(!Z)P(null,ft(t,ee,ee+T));else if(Z==8){var de=t.subarray(ee,ee+T);if(j<524288||T>.8*j)try{P(null,ir(de,{out:new I(j)}))}catch(E){P(E,null)}else n.push(ns(de,{size:j},P))}else P(k(14,"unknown compression type "+Z,1),null);else P(null,null)},G=0;G<p;++G)fe(G)}else s(null,{});return i}var Gn=require("fs"),W=require("fs/promises"),or=require("path");l();function zn(t){function e(s,a,c,p){let h=0;return h+=s<<0,h+=a<<8,h+=c<<16,h+=p<<24>>>0,h}if(t[0]===80&&t[1]===75&&t[2]===3&&t[3]===4)return t;if(t[0]!==67||t[1]!==114||t[2]!==50||t[3]!==52)throw new Error("Invalid header: Does not start with Cr24");let r=t[4]===3,n=t[4]===2;if(!n&&!r||t[5]||t[6]||t[7])throw new Error("Unexpected crx format version number.");if(n){let s=e(t[8],t[9],t[10],t[11]),a=e(t[12],t[13],t[14],t[15]),c=16+s+a;return t.subarray(c,t.length)}let o=12+e(t[8],t[9],t[10],t[11]);return t.subarray(o,t.length)}l();var us=require("original-fs");async function fs(t,e){try{var r=await fetch(t,e)}catch(i){throw i instanceof Error&&i.cause&&(i=i.cause),new Error(`${e?.method??"GET"} ${t} failed: ${i}`)}if(r.ok)return r;let n=`${e?.method??"GET"} ${t}: ${r.status} ${r.statusText}`;try{let i=await r.text();n+=`
${i}`}catch{}throw new Error(n)}async function Wn(t,e){let n=await(await fs(t,e)).arrayBuffer();return Buffer.from(n)}var ps=(0,or.join)(Ye,"ExtensionCache");async function ds(t,e){return await(0,W.mkdir)(e,{recursive:!0}),new Promise((r,n)=>{$n(t,(i,o)=>{if(i)return void n(i);Promise.all(Object.keys(o).map(async s=>{if(s.startsWith("_metadata/"))return;if(s.includes("\0"))throw new Error(`Invalid filename: "${s}"`);if(s.endsWith("/")){let u=X(e,s);if(!u)throw new Error(`Path traversal detected: "${s}"`);return void await(0,W.mkdir)(u,{recursive:!0})}let c=s.split("/").slice(0,-1).join("/"),p=X(e,c);if(!p)throw new Error(`Path traversal detected: "${s}"`);let h=X(e,s);if(!h)throw new Error(`Path traversal detected: "${s}"`);c&&await(0,W.mkdir)(p,{recursive:!0}),await(0,W.writeFile)(h,o[s])})).then(()=>r()).catch(s=>{(0,W.rm)(e,{recursive:!0,force:!0}),n(s)})})})}async function jn(t){let e=(0,or.join)(ps,t);try{await(0,W.access)(e,Gn.constants.F_OK)}catch{let n=`https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3&x=id%3D${t}%26uc&prodversion=${process.versions.chrome}`,i=await Wn(n,{headers:{"User-Agent":`Electron ${process.versions.electron} ~ Vencord (https://github.com/Vendicated/Vencord)`}});await ds(zn(i),e).catch(o=>console.error(`Failed to extract extension ${t}`,o))}pt.session.defaultSession.extensions?pt.session.defaultSession.extensions.loadExtension(e):pt.session.defaultSession.loadExtension(e)}ue.app.whenReady().then(()=>{ue.protocol.handle("vencord",({url:t})=>{let e=decodeURI(t).slice(10).replace(/\?v=\d+$/,"");if(e.endsWith("/")&&(e=e.slice(0,-1)),e.startsWith("/themes/")){let r=e.slice(8),n=X(Y,r);return n?ue.net.fetch((0,sr.pathToFileURL)(n).toString()):new Response(null,{status:404})}switch(e){case"renderer.js.map":case"vencordDesktopRenderer.js.map":case"preload.js.map":case"vencordDesktopPreload.js.map":case"patcher.js.map":case"vencordDesktopMain.js.map":return ue.net.fetch((0,sr.pathToFileURL)((0,Bn.join)(__dirname,e)).toString());default:return new Response(null,{status:404})}});try{A.store.enableReactDevtools&&jn("fmkadmapgofadopljbjfkapdkoienihi").then(()=>console.info("[Vencord] Installed React Developer Tools")).catch(t=>console.error("[Vencord] Failed to install React Developer Tools",t))}catch{}mn()});
//# sourceURL=file:///VencordDesktopMain
//# sourceMappingURL=vencord://vencordDesktopMain.js.map
/*! For license information please see vencordDesktopMain.js.LEGAL.txt */
