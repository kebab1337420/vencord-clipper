// Vencord ef29bbe
// Standalone: false
// Platform: win32
// Updater Disabled: false
"use strict";var Qt=Object.defineProperty;var vo=Object.getOwnPropertyDescriptor;var yo=Object.getOwnPropertyNames;var wo=Object.prototype.hasOwnProperty;var xt=(t,e,n)=>()=>{if(n)throw n[0];try{return t&&(e=t(t=0)),e}catch(r){throw n=[r],r}};var pe=(t,e)=>{for(var n in e)Qt(t,n,{get:e[n],enumerable:!0})},bo=(t,e,n,r)=>{if(e&&typeof e=="object"||typeof e=="function")for(let i of yo(e))!wo.call(t,i)&&i!==n&&Qt(t,i,{get:()=>e[i],enumerable:!(r=vo(e,i))||r.enumerable});return t};var So=t=>bo(Qt({},"__esModule",{value:!0}),t);var c=xt(()=>{"use strict"});var Ae=xt(()=>{"use strict";c()});function Ye(t){return async function(){try{return{ok:!0,value:await t(...arguments)}}catch(e){return{ok:!1,error:e instanceof Error?{...e,message:e.message,name:e.name,stack:e.stack}:e}}}}var sr=xt(()=>{"use strict";c()});var Io={};function Ce(...t){let e={cwd:dr};return tn?en("flatpak-spawn",["--host","git",...t],e):en("git",t,e)}async function xo(){return(await Ce("remote","get-url","origin")).stdout.trim().replace(/git@(.+):/,"https://$1/").replace(/\.git$/,"")}async function ko(){await Ce("fetch");let t=(await Ce("branch","--show-current")).stdout.trim();if(!((await Ce("ls-remote","origin",t)).stdout.length>0))return[];let r=(await Ce("log",`HEAD...origin/${t}`,"--pretty=format:%an/%h/%s")).stdout.trim();return r?r.split(`
`).map(i=>{let[o,a,...s]=i.split("/");return{hash:a,author:o,message:s.join("/").split(`
`)[0]}}):[]}async function Eo(){return(await Ce("pull")).stdout.includes("Fast-forward")}async function To(){return!(await en(tn?"flatpak-spawn":"node",tn?["--host","node","scripts/build/build.mjs"]:["scripts/build/build.mjs"],{cwd:dr})).stderr.includes("Build failed")}var lr,Je,cr,ur,dr,en,tn,pr=xt(()=>{"use strict";c();Ae();lr=require("child_process"),Je=require("electron"),cr=require("path"),ur=require("util");sr();dr=(0,cr.join)(__dirname,".."),en=(0,ur.promisify)(lr.execFile),tn=!1;Je.ipcMain.handle("VencordGetRepo",Ye(xo));Je.ipcMain.handle("VencordGetUpdates",Ye(ko));Je.ipcMain.handle("VencordUpdate",Ye(Eo));Je.ipcMain.handle("VencordBuild",Ye(To))});c();c();c();pr();c();Ae();var Vn=require("electron");c();var on={};pe(on,{fetchTrackData:()=>Ao});c();c();c();var fr="ef29bbe";c();var nn="Vendicated/Vencord";var hr=`Vencord/${fr}${nn?` (https://github.com/${nn})`:""}`;var mr=require("child_process"),gr=require("util"),vr=(0,gr.promisify)(mr.execFile);async function rn(t){let{stdout:e}=await vr("osascript",t.map(n=>["-e",n]).flat());return e}var $=null;async function Po({id:t,name:e,artist:n,album:r}){if(t===$?.id){if("data"in $)return $.data;if("failures"in $&&$.failures>=5)return null}try{let i=new URL("https://itunes.apple.com/search");i.searchParams.set("term",`${e} ${n} ${r}`),i.searchParams.set("media","music"),i.searchParams.set("entity","song");let o=await fetch(i,{headers:{"user-agent":hr}}).then(s=>s.json()).then(s=>s.results.find(l=>l.collectionName===r)||s.results[0]),a=await fetch(o.artistViewUrl).then(s=>s.text()).then(s=>{let l=s.match(/<meta property="og:image" content="(.+?)">/);return l?l[1].replace(/[0-9]+x.+/,"220x220bb-60.png"):void 0}).catch(()=>{});return $={id:t,data:{appleMusicLink:o.trackViewUrl,appleMusicArtistLink:o.artistViewUrl,songLink:`https://song.link/i/${new URL(o.trackViewUrl).searchParams.get("i")}`,albumArtwork:o.artworkUrl100.replace("100x100","512x512"),artistArtwork:a}},$.data}catch(i){return console.error("[AppleMusicRichPresence] Failed to fetch remote data:",i),$={id:t,failures:(t===$?.id&&"failures"in $?$.failures:0)+1},null}}async function Ao(){try{await vr("pgrep",["^Music$"])}catch{return null}if(await rn(['tell application "Music"',"get player state","end tell"]).then(d=>d.trim())!=="playing")return null;let e=await rn(['tell application "Music"',"get player position","end tell"]).then(d=>Number.parseFloat(d.trim())),n=await rn(['set output to ""','tell application "Music"',"set t_id to database id of current track","set t_name to name of current track","set t_album to album of current track","set t_artist to artist of current track","set t_duration to duration of current track",'set output to "" & t_id & "\\n" & t_name & "\\n" & t_album & "\\n" & t_artist & "\\n" & t_duration',"end tell","return output"]),[r,i,o,a,s]=n.split(`
`).filter(d=>!!d),l=Number.parseFloat(s),h=await Po({id:r,name:i,artist:a,album:o});return{name:i,album:o,artist:a,playerPosition:e,duration:l,...h}}var an={};pe(an,{initDevtoolsOpenEagerLoad:()=>Co});c();function Co(t){let e=()=>t.sender.executeJavaScript("Vencord.Plugins.plugins.ConsoleShortcuts.eagerLoad(true)");t.sender.isDevToolsOpened()?e():t.sender.once("devtools-opened",()=>e())}var Er={};c();c();Ae();c();var sn=Symbol("SettingsStore.isProxy"),yr=Symbol("SettingsStore.getRawTarget"),Xe=class{pathListeners=new Map;prefixListeners=new Map;globalListeners=new Set;proxyContexts=new WeakMap;proxyHandler=(()=>{let e=this;return{get(n,r,i){if(r===sn)return!0;if(r===yr)return n;let o=Reflect.get(n,r,i),a=e.proxyContexts.get(n);if(a==null)return o;let{root:s,path:l}=a;if(!(r in n)&&e.getDefaultValue!=null&&(o=e.getDefaultValue({target:n,key:r,root:s,path:l})),typeof o=="object"&&o!==null&&!o[sn]){let h=`${l}${l&&"."}${r}`;return e.makeProxy(o,s,h)}return o},set(n,r,i){if(i?.[sn]&&(i=i[yr]),n[r]===i)return!0;if(!Reflect.set(n,r,i))return!1;let o=e.proxyContexts.get(n);if(o==null)return!0;let{root:a,path:s}=o,l=`${s}${s&&"."}${r}`;return e.notifyListeners(l,i,a),!0},deleteProperty(n,r){if(!Reflect.deleteProperty(n,r))return!1;let i=e.proxyContexts.get(n);if(i==null)return!0;let{root:o,path:a}=i,s=`${a}${a&&"."}${r}`;return e.notifyListeners(s,void 0,o),!0}}})();constructor(e,n={}){this.plain=e,this.store=this.makeProxy(e),Object.assign(this,n)}makeProxy(e,n=e,r=""){return this.proxyContexts.set(e,{root:n,path:r}),new Proxy(e,this.proxyHandler)}notifyPrefixListeners(e,n,r){for(let i=1;i<=n.length;i++){let o=n.slice(0,i).join(".");this.prefixListeners.get(o)?.forEach(a=>a(r,e))}}notifyListeners(e,n,r){let i=e.split(".");if(i.length>3&&i[0]==="plugins"){let o=i.slice(0,3),a=o.join("."),s=o.reduce((l,h)=>l[h],r);this.globalListeners.forEach(l=>l(r,a)),this.pathListeners.get(a)?.forEach(l=>l(s))}else this.globalListeners.forEach(o=>o(r,e));this.pathListeners.get(e)?.forEach(o=>o(n)),this.notifyPrefixListeners(e,i,n)}setData(e,n){if(this.readOnly)throw new Error("SettingsStore is read-only");if(this.plain=e,this.store=this.makeProxy(e),n){let r=e,i=n.split(".");for(let o of i){if(!r){console.warn(`Settings#setData: Path ${n} does not exist in new data. Not dispatching update`);return}r=r[o]}this.pathListeners.get(n)?.forEach(o=>o(r)),this.notifyPrefixListeners(n,i,r)}this.markAsChanged()}addGlobalChangeListener(e){this.globalListeners.add(e)}addChangeListener(e,n){let r=this.pathListeners.get(e)??new Set;r.add(n),this.pathListeners.set(e,r)}addPrefixChangeListener(e,n){let r=this.prefixListeners.get(e)??new Set;r.add(n),this.prefixListeners.set(e,r)}removeGlobalChangeListener(e){this.globalListeners.delete(e)}removeChangeListener(e,n){let r=this.pathListeners.get(e);r&&(r.delete(n),r.size||this.pathListeners.delete(e))}removePrefixChangeListener(e,n){let r=this.prefixListeners.get(e);r&&(r.delete(n),r.size||this.prefixListeners.delete(e))}markAsChanged(){this.globalListeners.forEach(e=>e(this.plain,""))}};c();function ln(t,e){for(let n in e){let r=e[n];typeof r=="object"&&!Array.isArray(r)?(t[n]??={},ln(t[n],r)):t[n]??=r}return t}var dn=require("electron"),he=require("fs");c();var wr=require("electron"),te=require("path"),Et=process.env.VENCORD_USER_DATA_DIR??(process.env.DISCORD_USER_DATA_DIR?(0,te.join)(process.env.DISCORD_USER_DATA_DIR,"..","VencordData"):(0,te.join)(wr.app.getPath("userData"),"..","Vencord")),fe=(0,te.join)(Et,"settings"),ne=(0,te.join)(Et,"themes"),Re=(0,te.join)(fe,"quickCss.css"),cn=(0,te.join)(fe,"settings.json"),un=(0,te.join)(fe,"native-settings.json"),br=["https:","http:","steam:","spotify:","com.epicgames.launcher:","tidal:","itunes:"];(0,he.mkdirSync)(fe,{recursive:!0});function Sr(t,e){try{return JSON.parse((0,he.readFileSync)(e,"utf-8"))}catch(n){return n?.code!=="ENOENT"&&console.error(`Failed to read ${t} settings`,n),{}}}var C=new Xe(Sr("renderer",cn));C.addGlobalChangeListener(()=>{try{(0,he.writeFileSync)(cn,JSON.stringify(C.plain,null,4))}catch(t){console.error("Failed to write renderer settings",t)}});dn.ipcMain.on("VencordGetSettings",t=>t.returnValue=C.plain);dn.ipcMain.handle("VencordSetSettings",(t,e,n)=>{C.setData(e,n)});var Ro={plugins:{},customCspRules:{}},xr=Sr("native",un);ln(xr,Ro);var j=new Xe(xr);j.addGlobalChangeListener(()=>{try{(0,he.writeFileSync)(un,JSON.stringify(j.plain,null,4))}catch(t){console.error("Failed to write native settings",t)}});var It=require("electron"),Tt=[];function kr(){let t=[];for(let e=Tt.length-1;e>=0;e--){let{processId:n,routingId:r}=Tt[e],i=It.webFrameMain.fromId(n,r);if(!i){Tt.splice(e,1);continue}t.push(i)}return t}It.app.on("browser-window-created",(t,e)=>{e.webContents.on("frame-created",(n,{frame:r})=>{r?.once("dom-ready",()=>{if(r.url.startsWith("https://open.spotify.com/embed/")){kr();let{routingId:i,processId:o}=r;Tt.push({routingId:i,processId:o});let a=C.store.plugins?.FixSpotifyEmbeds;if(!a?.enabled)return;r.executeJavaScript(`
                    globalThis._vcVolume = ${a.volume/100};
                    const original = Audio.prototype.play;
                    Audio.prototype.play = function() {
                        this.volume = _vcVolume;
                        return original.apply(this, arguments);
                    }
                `)}})})});C.addChangeListener("plugins.FixSpotifyEmbeds.volume",t=>{try{kr().forEach(e=>e.executeJavaScript(`globalThis._vcVolume = ${t/100}`))}catch(e){console.error("FixSpotifyEmbeds: Failed to update volume",e)}});var Ir={};c();var Tr=require("electron");Tr.app.on("browser-window-created",(t,e)=>{e.webContents.on("frame-created",(n,{frame:r})=>{r?.once("dom-ready",()=>{if(r.url.startsWith("https://www.youtube.com/")){if(!C.store.plugins?.FixYoutubeEmbeds?.enabled)return;r.executeJavaScript(`
                new MutationObserver(() => {
                    if(
                        document.querySelector('div.ytp-error-content-wrap-subreason a[href*="www.youtube.com/watch?v="]')
                    ) location.reload()
                }).observe(document.body, { childList: true, subtree:true });
                `)}})})});var pn={};pe(pn,{resolveRedirect:()=>_o});c();var Pr=require("https"),Mo=/^https:\/\/(spotify\.link|s\.team)\/.+$/;function Ar(t){return new Promise((e,n)=>{let r=(0,Pr.request)(new URL(t),{method:"HEAD"},i=>{e(i.headers.location?Ar(i.headers.location):t)});r.on("error",n),r.end()})}async function _o(t,e){return Mo.test(e)?Ar(e):e}var fn={};pe(fn,{makeDeeplTranslateRequest:()=>Do,makeKagiTranslateRequest:()=>Oo});c();async function Do(t,e,n,r){let i=e?"https://api.deepl.com/v2/translate":"https://api-free.deepl.com/v2/translate";try{let o=await fetch(i,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`DeepL-Auth-Key ${n}`},body:r}),a=await o.text();return{status:o.status,data:a}}catch(o){return{status:-1,data:String(o)}}}async function Oo(t,e,n,r,i){let o="https://translate.kagi.com/api/translate";try{let a=await fetch(o,{method:"POST",headers:{"Content-Type":"application/json",Cookie:`kagi_session=${e}`},body:JSON.stringify({text:n,from:r,to:i,model:"standard"})}),s=await a.json();return{status:a.status,data:s}}catch(a){return{status:-1,data:String(a)}}}var hn={};pe(hn,{readRecording:()=>Lo});c();var Cr=require("electron"),Pt=require("fs/promises"),Qe=require("path");async function Lo(t,e){e=(0,Qe.normalize)(e);let n=(0,Qe.basename)(e),r=(0,Qe.normalize)(Cr.app.getPath("userData")+"/");if(!/^\d*recording\.ogg$/.test(n)||!e.startsWith(r))return null;try{let i=await(0,Pt.readFile)(e);return(0,Pt.rm)(e).catch(()=>{}),new Uint8Array(i.buffer)}catch{return null}}var mn={};pe(mn,{closeSocket:()=>Fo,sendToOverlay:()=>Vo});c();var Rr=require("dgram"),At=null;function Vo(t,e){e.messageType=e.type;let n=JSON.stringify(e);At??=(0,Rr.createSocket)("udp4"),At.send(n,42069,"127.0.0.1")}function Fo(){At?.close(),At=null}var _r={};c();var Mr=require("electron");c();var gn=`"use strict";(()=>{if(window.adguardInjected)return;window.adguardInjected=!0;const c=["#__ffYoutube1","#__ffYoutube2","#__ffYoutube3","#__ffYoutube4","#feed-pyv-container","#feedmodule-PRO","#homepage-chrome-side-promo","#merch-shelf","#offer-module",'#pla-shelf > ytd-pla-shelf-renderer[class="style-scope ytd-watch"]',"#pla-shelf","#premium-yva","#promo-info","#promo-list","#promotion-shelf","#related > ytd-watch-next-secondary-results-renderer > #items > ytd-compact-promoted-video-renderer.ytd-watch-next-secondary-results-renderer","#search-pva","#shelf-pyv-container","#video-masthead","#watch-branded-actions","#watch-buy-urls","#watch-channel-brand-div","#watch7-branded-banner","#YtKevlarVisibilityIdentifier","#YtSparklesVisibilityIdentifier",".carousel-offer-url-container",".companion-ad-container",".GoogleActiveViewElement",'.list-view[style="margin: 7px 0pt;"]',".promoted-sparkles-text-search-root-container",".promoted-videos",".searchView.list-view",".sparkles-light-cta",".watch-extra-info-column",".watch-extra-info-right",".ytd-carousel-ad-renderer",".ytd-compact-promoted-video-renderer",".ytd-companion-slot-renderer",".ytd-merch-shelf-renderer",".ytd-player-legacy-desktop-watch-ads-renderer",".ytd-promoted-sparkles-text-search-renderer",".ytd-promoted-video-renderer",".ytd-search-pyv-renderer",".ytd-video-masthead-ad-v3-renderer",".ytp-ad-action-interstitial-background-container",".ytp-ad-action-interstitial-slot",".ytp-ad-image-overlay",".ytp-ad-overlay-container",".ytp-ad-progress",".ytp-ad-progress-list",'[class*="ytd-display-ad-"]','[layout*="display-ad-"]','a[href^="http://www.youtube.com/cthru?"]','a[href^="https://www.youtube.com/cthru?"]',"ytd-action-companion-ad-renderer","ytd-banner-promo-renderer","ytd-compact-promoted-video-renderer","ytd-companion-slot-renderer","ytd-display-ad-renderer","ytd-promoted-sparkles-text-search-renderer","ytd-promoted-sparkles-web-renderer","ytd-search-pyv-renderer","ytd-single-option-survey-renderer","ytd-video-masthead-ad-advertiser-info-renderer","ytd-video-masthead-ad-v3-renderer","YTM-PROMOTED-VIDEO-RENDERER"],l=()=>{const e=c;if(!e)return;const t=e.join(", ")+" { display: none!important; }",r=document.createElement("style");r.textContent=t,document.head.appendChild(r)},p=e=>{new MutationObserver(r=>{e(r)}).observe(document.documentElement,{childList:!0,subtree:!0})},a=()=>{const e=document.querySelectorAll("#contents > ytd-rich-item-renderer ytd-display-ad-renderer");e.length!==0&&e.forEach(t=>{if(t.parentNode&&t.parentNode.parentNode){const r=t.parentNode.parentNode;r.localName==="ytd-rich-item-renderer"&&(r.style.display="none")}})},s=()=>{if(document.querySelector(".ad-showing")){const e=document.querySelector("video");e&&e.duration&&(e.currentTime=e.duration,setTimeout(()=>{const t=document.querySelector("button.ytp-ad-skip-button");t&&t.click()},100))}},d=(e,t,r)=>{if(!e)return!1;let n=!1;for(const o in e)e.hasOwnProperty(o)&&o===t?(e[o]=r,n=!0):e.hasOwnProperty(o)&&typeof e[o]=="object"&&d(e[o],t,r)&&(n=!0);return n},i=(e,t)=>{const r=JSON.parse;JSON.parse=(...n)=>{const o=r.apply(this,n);return d(o,e,t),o},Response.prototype.json=new Proxy(Response.prototype.json,{async apply(...n){const o=await Reflect.apply(...n);return d(o,e,t),o}})};i("adPlacements",[]),i("playerAds",[]),l(),a(),s(),p(()=>{a(),s()})})();
`;Mr.app.on("browser-window-created",(t,e)=>{e.webContents.on("frame-created",(n,{frame:r})=>{r?.once("dom-ready",()=>{C.store.plugins?.YoutubeAdblock?.enabled&&(r.url.includes("youtube.com/embed/")?r.executeJavaScript(gn):r.parent?.url.includes("youtube.com/embed/")&&r.parent.executeJavaScript(gn))})})});var Ln={};pe(Ln,{answerOverlayAction:()=>_s,armDisplayMedia:()=>rs,checkUpdate:()=>Ns,closeStudioOverlay:()=>As,deleteClip:()=>La,disarmDisplayMedia:()=>is,downloadUpdate:()=>Gs,dropOverlayWaiters:()=>Ms,focusClient:()=>Ds,gameFeedStatus:()=>us,getActiveScreen:()=>ns,getCaptureSources:()=>es,getClipDirectory:()=>Ya,getMemoryReport:()=>ts,getPlatformInfo:()=>Qa,hideClipOverlay:()=>ks,hideVrPanel:()=>vs,listClips:()=>Da,notifyClipSaved:()=>xs,openClipDirectory:()=>Xa,openStudioOverlay:()=>Ps,openVrBindings:()=>ms,pickAudioFiles:()=>za,pickClipDirectory:()=>Ja,pickImageFiles:()=>Ba,pickVideoFiles:()=>Ua,readAudioFile:()=>ja,readClip:()=>Oa,readImageFile:()=>Za,readLibrary:()=>Fa,readVideoFile:()=>$a,readVoiceTrack:()=>Ma,registerShortcuts:()=>as,relaunchClient:()=>$s,renameClip:()=>Va,reserveClipPath:()=>Pa,revealClip:()=>qa,saveClip:()=>Ia,saveVoiceTrack:()=>Ra,showClipOverlay:()=>Ss,showVrPanel:()=>gs,startGameFeeds:()=>ls,startVrBridge:()=>ps,stopGameFeeds:()=>cs,stopVrBridge:()=>fs,studioOverlayUp:()=>Cs,unregisterShortcuts:()=>On,vrBridgeStatus:()=>hs,waitForGameEvent:()=>ds,waitForOverlayAction:()=>Rs,waitForShortcut:()=>ss,waitForVrEvent:()=>ys,writeLibrary:()=>Na});c();var wi=require("crypto"),v=require("electron"),p=require("fs"),bi=require("https"),f=require("path");c();var z=require("fs"),Lr=require("http"),Vr=require("https"),Fr=require("os"),ot=require("path"),Dr=34765,No=6,Nr=256*1024,Uo=2e3,Go=1500,$o="127.0.0.1",zo=2999,Wo="gamestate_integration_clipper.cfg",re=null,_e=0,Rt="",De=null,rt=[],jo=12,it=[],Oe=[],Le={cs2:!1,league:!1};function Mt(t){rt.length>=jo||rt.includes(t)||rt.push(t)}var _t=Promise.resolve();function et(t){let e=Oe.shift();if(e){e(t);return}it.push(t),it.length>16&&it.shift()}var S={kills:-1,deaths:-1,round:-1,roundKills:0,announced:0};function Ur(){S={kills:-1,deaths:-1,round:-1,roundKills:0,announced:0}}function Bo(t){return t>=5?"an ace in Counter-Strike 2":t===4?"a 4K in Counter-Strike 2":"a 3K in Counter-Strike 2"}function Ho(t){let e=t.provider?.steamid,{player:n}=t;if(!n||!e||!n.steamid||n.steamid!==e)return;let r=n.match_stats;if(!r||typeof r.kills!="number"||typeof r.deaths!="number")return;let i=typeof t.map?.round=="number"?t.map.round:S.round;(r.kills<S.kills||r.deaths<S.deaths)&&Ur();let o=S.kills<0;i!==S.round&&(S.round=i,S.roundKills=0,S.announced=0);let a=r.kills-Math.max(0,S.kills),s=r.deaths-Math.max(0,S.deaths);if(S.kills=r.kills,S.deaths=r.deaths,o)return;a>0&&(S.roundKills+=a,S.roundKills>=3&&S.roundKills>S.announced?(S.announced=S.roundKills,et({kind:"multikill",note:Bo(S.roundKills)})):et({kind:"kill",note:a>1?"a double kill in Counter-Strike 2":"a kill in Counter-Strike 2"})),s>0&&et({kind:"death",note:"your death in Counter-Strike 2"});let l=t.round?.win_team;l&&n.team&&l===n.team&&t.round?.phase==="over"&&S.roundKills>0&&et({kind:"roundwin",note:"a round you won in Counter-Strike 2"})}function Ko(){return new Promise(t=>{let e=0,n=(0,Lr.createServer)((r,i)=>{if(r.method!=="POST"){i.writeHead(405).end();return}let o="",a=!1;r.setEncoding("utf8"),r.on("data",s=>{a||(o+=s,o.length>Nr&&(a=!0,o="",r.destroy()))}),r.on("end",()=>{if(i.writeHead(200).end(),!a)try{Ho(JSON.parse(o))}catch{}}),r.on("error",()=>{})});n.on("error",r=>{if(r.code==="EADDRINUSE"&&++e<No){n.listen(Dr+e,"127.0.0.1");return}Mt(`The Counter-Strike listener could not open a port (${r.code??r.message})`);try{n.close()}catch{}re===n&&(re=null,_e=0,Le={...Le,cs2:!1}),t(0)}),n.on("listening",()=>{re=n,t(n.address().port)}),n.listen(Dr,"127.0.0.1")})}function Zo(){let t=[],e=(0,Fr.homedir)();{let r=[process.env["ProgramFiles(x86)"],process.env.ProgramW6432,process.env.ProgramFiles];for(let i of r)i&&t.push((0,ot.join)(i,"Steam"))}let n=[];for(let r of t)if((0,z.existsSync)(r)){n.push(r);try{let i=(0,z.readFileSync)((0,ot.join)(r,"steamapps","libraryfolders.vdf"),"utf8");for(let o of i.matchAll(/"path"\s+"([^"]+)"/g)){let a=o[1].replace(/\\\\/g,"\\");a&&!n.includes(a)&&n.push(a)}}catch{}}return n}function qo(){for(let t of Zo()){let e=(0,ot.join)(t,"steamapps","common","Counter-Strike Global Offensive","game","csgo","cfg");if((0,z.existsSync)(e))return e}return""}function Yo(t){let e=qo();if(!e)return Mt("Counter-Strike 2 is not installed where Steam usually puts it, so its config was not written"),"";let n=(0,ot.join)(e,Wo),r=`"Clipper"
{
    "uri"       "http://127.0.0.1:${t}/"
    "timeout"   "5.0"
    "buffer"    "0.1"
    "throttle"  "0.5"
    "heartbeat" "60.0"
    "auth"      { }
    "data"
    {
        "provider"           "1"
        "player_id"          "1"
        "player_state"       "1"
        "player_match_stats" "1"
        "map"                "1"
        "round"              "1"
    }
}
`;try{return(0,z.mkdirSync)(e,{recursive:!0}),(0,z.writeFileSync)(n,r,"utf8"),n}catch(i){return Mt(`Counter-Strike 2's config could not be written (${i.message})`),""}}function Jo(){let t=Rt;if(Rt="",!!t)try{(0,z.unlinkSync)(t)}catch{}}var tt="",Me=-1,vn=!1,Ct=!1;function nt(t){return t.split("#")[0].trim().toLowerCase()}function Or(t){return new Promise(e=>{let n=(0,Vr.get)({host:$o,port:zo,path:t,rejectUnauthorized:!1,timeout:Go},r=>{if(r.statusCode!==200){r.resume(),e(null);return}let i="";r.setEncoding("utf8"),r.on("data",o=>{i+=o,i.length>Nr&&n.destroy()}),r.on("end",()=>{try{e(JSON.parse(i))}catch{e(null)}})});n.on("timeout",()=>n.destroy()),n.on("error",()=>e(null))})}function Xo(t,e){let n=t.EventName??"",r=nt(t.KillerName??"");switch(n){case"ChampionKill":return r===e?{kind:"kill",note:"a kill in League of Legends"}:nt(t.VictimName??"")===e?{kind:"death",note:"your death in League of Legends"}:null;case"Multikill":return r!==e?null:{kind:"multikill",note:`a ${t.KillStreak??3}-kill run in League of Legends`};case"Ace":return nt(t.Acer??"")!==e?null:{kind:"multikill",note:"an ace in League of Legends"};case"FirstBlood":return nt(t.Recipient??"")!==e?null:{kind:"kill",note:"first blood in League of Legends"};case"DragonKill":return r!==e?null:{kind:"objective",note:`${t.DragonType?`the ${t.DragonType.toLowerCase()} dragon`:"a dragon"} in League of Legends`};case"BaronKill":return r!==e?null:{kind:"objective",note:"baron in League of Legends"};case"HeraldKill":return r!==e?null:{kind:"objective",note:"the herald in League of Legends"};case"TurretKilled":case"InhibKilled":return r!==e?null:{kind:"objective",note:"a structure in League of Legends"};default:return null}}async function Qo(){if(!Ct){Ct=!0;try{if(!tt){let r=await Or("/liveclientdata/activeplayername");if(typeof r!="string"||!r)return;tt=nt(r),Me=-1}let t=await Or("/liveclientdata/eventdata");if(!t?.Events){tt="";return}let e=Me<0,n=Me;for(let r of t.Events){let i=typeof r.EventID=="number"?r.EventID:-1;if(i<=Me||(n=Math.max(n,i),e))continue;let o=Xo(r,tt);o&&et(o)}Me=n}finally{Ct=!1}}}function ea(){tt="",Me=-1,Ct=!1,De=setInterval(()=>{Qo().catch(t=>{vn||(vn=!0,Mt(`League of Legends could not be read (${t.message})`))})},Uo)}function ta(t){return t.cs2!==Le.cs2||t.league!==Le.league?!1:(!t.cs2||re!==null)&&(!t.league||De!==null)}function Gr(t){let e=_t.then(async()=>(ta(t)||($r(),rt=[],t.cs2&&(Ur(),_e=await Ko(),_e&&(Rt=Yo(_e))),t.league&&ea(),Le={cs2:t.cs2&&re!==null,league:t.league}),Dt()));return _t=e.catch(()=>{}),e}function $r(){if(Le={cs2:!1,league:!1},De&&clearInterval(De),De=null,vn=!1,re)try{re.close()}catch{}re=null,_e=0,Jo(),it=[];let t=Oe;Oe=[];for(let e of t)e(null)}function yn(){let t=_t.then(()=>$r());return _t=t.catch(()=>{}),t}function Dt(){return{port:_e,configPath:Rt,league:De!==null,problems:[...rt]}}function zr(t){let e=it.shift();return e?Promise.resolve(e):new Promise(n=>{let r=!1,i=a=>{r||(r=!0,clearTimeout(o),n(a))},o=setTimeout(()=>{Oe=Oe.filter(a=>a!==i),i(null)},t);Oe.push(i)})}c();var ie=require("electron"),Vt=require("fs"),st=require("path"),Wr=require("url"),Ot=24,jr=2600,Lt=220,na=300,ra=56,wn=!0;function Ft(){return wn}var ve=null,me=null,at=null,ge=null;function ia(){return!!ve&&!ve.isDestroyed()}function ye(){me&&(clearTimeout(me),me=null);let t=ve;ve=null,t&&!t.isDestroyed()&&t.destroy()}function Ve(){ge&&(clearTimeout(ge),ge=null);let t=at;at=null,t&&!t.isDestroyed()&&t.destroy()}function oa(t,e,n){let i=ie.screen.getDisplayNearestPoint(ie.screen.getCursorScreenPoint()).workArea,o=t==="top-left"||t==="bottom-left",a=t==="top-left"||t==="top-right";return{x:Math.round(o?i.x+Ot:i.x+i.width-e-Ot),y:Math.round(a?i.y+Ot:i.y+i.height-n-Ot)}}function lt(t,e){let n=(0,st.join)(ie.app.getPath("userData"),"clipper-overlay");(0,Vt.mkdirSync)(n,{recursive:!0});let r=(0,st.join)(n,t);return(0,Vt.writeFileSync)(r,e,"utf8"),r}function Br(t,e,n,r){let{x:i,y:o}=oa(r,e,n),a=new ie.BrowserWindow({width:e,height:n,x:i,y:o,frame:!1,transparent:!0,backgroundColor:"#00000000",resizable:!1,movable:!1,minimizable:!1,maximizable:!1,fullscreenable:!1,skipTaskbar:!0,focusable:!1,hasShadow:!1,alwaysOnTop:!0,show:!1,webPreferences:{nodeIntegration:!1,contextIsolation:!0,sandbox:!0,backgroundThrottling:!1}});return a.setAlwaysOnTop(!0,"screen-saver"),a.setVisibleOnAllWorkspaces(!0,{visibleOnFullScreen:!0}),a.setIgnoreMouseEvents(!0,{forward:!0}),a.loadFile(t).then(()=>{a.isDestroyed()||a.showInactive()}).catch(()=>{a.isDestroyed()||a.destroy()}),a}function Hr(t){return`<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src file:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
    html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
    .card {
        position: absolute; inset: 0; border-radius: 12px; overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.14); box-shadow: 0 10px 34px rgba(0, 0, 0, 0.6);
        opacity: 0; transform: scale(0.96); transition: opacity ${Lt}ms ease, transform ${Lt}ms ease;
    }
    .card.up { opacity: 1; transform: none; }
    ${t}
</style>`}function B(t){return JSON.stringify(t).replace(/</g,"\\u003c")}function aa(t,e){return`<!doctype html>
<html>
<head>
${Hr(`.card { background: #000; }
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
    var look = ${B(e)};
    var video = document.getElementById("video");
    var card = document.getElementById("card");
    document.getElementById("tag").textContent = ${B((0,st.basename)(t))};

    var leaving = false;
    function leave() {
        if (leaving) return;
        leaving = true;
        card.classList.remove("up");
        setTimeout(function () { window.close(); }, ${Lt});
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

    video.src = ${B((0,Wr.pathToFileURL)(t).href)};

    // Autoplay with sound is only allowed after a gesture, and this window
    // never gets one. Muted playback is always allowed, so it is the fallback
    // rather than a reason to show nothing.
    video.play().catch(function () {
        video.muted = true;
        video.play().catch(leave);
    });
</script>
</body>
</html>`}function sa(t,e){return`<!doctype html>
<html>
<head>
${Hr(`.card {
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
    document.getElementById("title").textContent = ${B(t)};
    document.getElementById("note").textContent = ${B(e)};

    requestAnimationFrame(function () { card.classList.add("up"); });

    setTimeout(function () {
        card.classList.remove("up");
        setTimeout(function () { window.close(); }, ${Lt});
    }, ${jr});
</script>
</body>
</html>`}function Kr(t,e){if(!wn)return!1;ye(),Ve();let n=Math.max(200,Math.round(e.width)),r=Math.round(n*9/16),i=Br(lt("clip.html",aa(t,e)),n,r,e.corner);ve=i,i.on("closed",()=>{ve===i&&(ve=null,me&&(clearTimeout(me),me=null))});let o=(e.seconds>0?e.seconds:300)+10;return me=setTimeout(()=>ye(),o*1e3),!0}function Zr(t,e,n){if(!wn||ia())return!1;Ve();let r=Br(lt("toast.html",sa(t,e)),na,ra,n);return at=r,r.on("closed",()=>{at===r&&(at=null,ge&&(clearTimeout(ge),ge=null))}),ge=setTimeout(()=>Ve(),jr+4e3),!0}ie.app.on("will-quit",()=>{ye(),Ve()});c();var H=require("electron"),qr=require("url");var bn="VencordClipperOverlayAction",Yr="VencordClipperOverlayReply",la=108,R=null;function Sn(){return!!R&&!R.isDestroyed()}function ut(){let t=R;R=null,t&&!t.isDestroyed()&&t.destroy()}var Fe=[],ct=[];function ca(t){let e=Fe.shift();if(e){e(t);return}ct.push(t),ct.length>4&&ct.shift()}function Jr(t){let e=ct.shift();return e?Promise.resolve(e):new Promise(n=>{let r=!1,i=a=>{r||(r=!0,clearTimeout(o),n(a))},o=setTimeout(()=>{Fe=Fe.filter(a=>a!==i),i(null)},t);Fe.push(i)})}function Xr(){ct=[];let t=Fe;Fe=[];for(let e of t)e(null)}function Qr(t){!R||R.isDestroyed()||R.webContents.send(Yr,t)}H.ipcMain.removeAllListeners(bn);H.ipcMain.on(bn,(t,e,n)=>{if(!R||R.isDestroyed()||t.sender!==R.webContents)return;let r=String(e??"");if(r==="close"){ut();return}if(r!=="cut"&&r!=="send"&&r!=="delete"&&r!=="open")return;let i=n??{},o=Number(i.from),a=Number(i.to);ca({kind:r,clip:String(i.clip??""),from:Number.isFinite(o)?Math.max(0,o):0,to:Number.isFinite(a)?Math.max(0,a):0})});function ua(t,e){let{workArea:n}=H.screen.getDisplayNearestPoint(H.screen.getCursorScreenPoint());return{x:Math.round(n.x+(n.width-t)/2),y:Math.round(n.y+(n.height-e)/2)}}var da=`"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("clipper", {
    act(kind, payload) {
        ipcRenderer.send(${B(bn)}, String(kind), payload);
    },
    onReply(handler) {
        ipcRenderer.on(${B(Yr)}, (_event, reply) => handler(reply));
    }
});
`;function pa(t,e){return`<!doctype html>
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
    var clip = ${B({name:t.name,url:(0,qr.pathToFileURL)(t.path).href,markers:t.markers})};
    var look = ${B(e)};
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
</html>`}function ei(t,e){if(!Ft())return!1;ut(),ye(),Ve();let n=Math.max(360,Math.round(e.width)),r=Math.round(n*9/16)+la,{x:i,y:o}=ua(n,r),a=lt("studio-preload.js",da),s=lt("studio.html",pa(t,e)),l=new H.BrowserWindow({width:n,height:r,x:i,y:o,frame:!1,transparent:!0,backgroundColor:"#00000000",resizable:!1,movable:!1,minimizable:!1,maximizable:!1,fullscreenable:!1,skipTaskbar:!0,hasShadow:!1,alwaysOnTop:!0,show:!1,webPreferences:{preload:a,nodeIntegration:!1,contextIsolation:!0,sandbox:!0,backgroundThrottling:!1}});return R=l,l.setAlwaysOnTop(!0,"screen-saver"),l.setVisibleOnAllWorkspaces(!0,{visibleOnFullScreen:!0}),l.on("closed",()=>{R===l&&(R=null)}),l.loadFile(s).then(()=>{l.isDestroyed()||(l.show(),l.focus())}).catch(()=>{l.isDestroyed()||l.destroy()}),!0}H.app.on("will-quit",()=>ut());c();function dt(t){return`${t.replace(/\.(webm|mp4)$/i,"")}.thumb.jpg`}c();var ci=require("child_process"),ui=require("electron"),In=require("fs"),gt=require("path");c();var fa=`
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace Clipper
{
    public static class Bridge
    {
        [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Ansi)]
        private static extern IntPtr LoadLibrary(string path);

        [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Ansi)]
        private static extern IntPtr GetProcAddress(IntPtr module, string name);

        [DllImport("kernel32", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool FreeLibrary(IntPtr module);

        // The six flat exports. Everything else lives behind GetGenericInterface.
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr InitInternal(ref int error, int applicationType);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate void ShutdownInternal();
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr GetGenericInterface([MarshalAs(UnmanagedType.LPStr)] string version, ref int error);

        // IVRSystem
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate void GetPoses(int origin, float secondsAhead, IntPtr poses, uint count);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate uint IndexForRole(int role);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate IntPtr RuntimeVersion();

        // IVRInput
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int SetManifest([MarshalAs(UnmanagedType.LPStr)] string path);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int GetHandle([MarshalAs(UnmanagedType.LPStr)] string name, out ulong handle);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int UpdateState([In] ActiveActionSet[] sets, uint sizeOfOne, uint count);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int DigitalData(ulong action, ref DigitalActionData data, uint size, ulong restrictTo);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int BindingUI([MarshalAs(UnmanagedType.LPStr)] string appKey, ulong actionSet, ulong device, [MarshalAs(UnmanagedType.I1)] bool onDesktop);

        // IVROverlay
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int MakeOverlay([MarshalAs(UnmanagedType.LPStr)] string key, [MarshalAs(UnmanagedType.LPStr)] string name, ref ulong handle);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int DropOverlay(ulong overlay);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr OverlayErrorName(int error);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int OverlayWidth(ulong overlay, float metres);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int OverlayFollow(ulong overlay, uint device, ref Matrix34 place);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int OverlayPixels(ulong overlay, IntPtr buffer, uint width, uint height, uint bytesPerPixel);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int OverlayShow(ulong overlay);

        // IVRApplications
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int AddManifest([MarshalAs(UnmanagedType.LPStr)] string path, [MarshalAs(UnmanagedType.I1)] bool temporary);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int Identify(uint pid, [MarshalAs(UnmanagedType.LPStr)] string appKey);

        [StructLayout(LayoutKind.Sequential)]
        private struct ActiveActionSet
        {
            public ulong ActionSet;
            public ulong RestrictedToDevice;
            public ulong SecondaryActionSet;
            public uint Padding;
            public int Priority;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct DigitalActionData
        {
            [MarshalAs(UnmanagedType.I1)] public bool Active;
            public ulong ActiveOrigin;
            [MarshalAs(UnmanagedType.I1)] public bool State;
            [MarshalAs(UnmanagedType.I1)] public bool Changed;
            public float UpdateTime;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct DevicePose
        {
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 12)] public float[] DeviceToAbsolute;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 3)] public float[] Velocity;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 3)] public float[] AngularVelocity;
            public int TrackingResult;
            [MarshalAs(UnmanagedType.I1)] public bool PoseIsValid;
            [MarshalAs(UnmanagedType.I1)] public bool DeviceIsConnected;
        }

        /*
         * HmdMatrix34_t: three rows of four, laid out one after another.
         *
         * Written as twelve fields rather than as an array, because a struct
         * holding a managed array has to be told how to marshal it and gets it
         * wrong quietly if the attribute is missed. Twelve plain floats can
         * only be laid out one way, and its size is checked at startup with
         * the three below it.
         */
        [StructLayout(LayoutKind.Sequential)]
        private struct Matrix34
        {
            public float M00, M01, M02, M03;
            public float M10, M11, M12, M13;
            public float M20, M21, M22, M23;
        }

        private const int ApplicationBackground = 3;
        private const int UniverseStanding = 1;
        private const int MaxDevices = 64;
        private const int RoleLeftHand = 1;
        private const int RoleRightHand = 2;

        /*
         * How long to leave SteamVR alone between attempts to attach, and how
         * many failed updates in a row mean it has gone away underneath us.
         *
         * Five seconds rather than the fifteen the supervisor used to wait,
         * because an attempt now costs one failed function call instead of a
         * process and a C# compile. Fifty ticks is one second of the loop
         * below: long enough that a hiccup is not mistaken for a shutdown.
         */
        private const int RetrySeconds = 5;
        private const int LostLimit = 50;

        /*
         * Where the panel hangs, relative to the headset.
         *
         * A metre out and thirty centimetres down, which in a headset is below
         * whatever the player is actually looking at and well inside the field
         * of view - the same place a car puts its instruments, and for the same
         * reason. Tilted back fifteen degrees so it faces the eyes rather than
         * the floor.
         *
         * Attached to the headset rather than left in the room, because this is
         * a notice that somebody has a second or two to read: a panel left
         * hanging where the player was looking a minute ago is a panel nobody
         * ever sees.
         */
        private const float PanelForward = -1.0f;
        private const float PanelDown = -0.30f;
        private const float PanelTilt = 0.26f;
        private const float PanelMetres = 0.55f;

        /** The largest picture the plugin may hand over, in pixels either way. */
        private const int PanelLimit = 2048;

        private static readonly object Gate = new object();
        private static readonly Queue<string> _commands = new Queue<string>();
        private static bool _stopped;

        private static T Entry<T>(IntPtr table, int index)
        {
            IntPtr fn = Marshal.ReadIntPtr(table, index * IntPtr.Size);
            if (fn == IntPtr.Zero) throw new EntryPointNotFoundException("Nothing at index " + index + " of an OpenVR function table");

            return (T) (object) Marshal.GetDelegateForFunctionPointer(fn, typeof(T));
        }

        /*
         * One string, made safe to sit inside the JSON written by hand above.
         *
         * The control characters are replaced rather than escaped, because
         * every message that comes through here is a sentence meant for a
         * person and none of them mean anything as a tab or a newline. What
         * matters is that none of them survive: a raw control character inside
         * a JSON string makes the whole line unparseable, and an unparseable
         * line is dropped in silence at the other end. For an error line that
         * means a bridge which gave its reason and had it thrown away, leaving
         * the plugin to work out three bridges later that something is wrong.
         */
        private static string Esc(string text)
        {
            if (text == null) return "";

            StringBuilder built = new StringBuilder(text.Length);

            foreach (char c in text)
            {
                if (c == '\\\\') built.Append("\\\\\\\\");
                else if (c == '"') built.Append("\\\\\\"");
                else if (c < ' ' || c == (char) 127) built.Append(' ');
                else built.Append(c);
            }

            return built.ToString();
        }

        private static void Say(string line)
        {
            Console.Out.WriteLine(line);
            Console.Out.Flush();
        }

        /*
         * Something went wrong that no amount of retrying fixes: a SteamVR too
         * old for the interfaces, a manifest it will not take, a bridge that
         * will not compile at all. The plugin keeps it, repeats it in the
         * toolbox, and stops starting new bridges.
         *
         * That is the whole of what an error line means here, and it is why
         * there is no flag on it saying so. Anything that is only true for now -
         * SteamVR off, the headset on the desk - is a waiting line instead and
         * never comes through here.
         */
        private static void Fail(string message)
        {
            Say("{\\"t\\":\\"error\\",\\"message\\":\\"" + Esc(message) + "\\"}");
        }

        /*
         * Something is wrong with a session that is otherwise working.
         *
         * Deliberately not an error: an error is a thing the plugin stops
         * starting bridges over, and this session is up and delivering presses.
         * The one that goes through here is a set SteamVR knows with actions in
         * it that it does not, which leaves buttons that can never be bound and
         * nothing anywhere saying why - worth saying, not worth giving up over,
         * and above all not worth refusing to start the next bridge over after
         * a crash that had nothing to do with it.
         */
        private static void Warn(string message)
        {
            Say("{\\"t\\":\\"warning\\",\\"message\\":\\"" + Esc(message) + "\\"}");
        }

        /*
         * Why there is no session, in words somebody can act on.
         *
         * The headset codes say nothing about whether SteamVR is running, and an
         * earlier version of this said they did. The presence check happens
         * before the server is ever contacted, so 126 comes back on a machine
         * with SteamVR shut down and no headset plugged in - which is most
         * machines, most of the time, and was being told SteamVR was running.
         */
        private static string Explain(int error)
        {
            if (error == 108 || error == 125 || error == 126) return "No headset is connected";
            if (error == 109 || error == 119 || error == 121) return "SteamVR is not running";
            if (error >= 100 && error <= 103) return "SteamVR is installed but not working (error " + error + ")";
            if (error == 115 || error == 117) return "SteamVR is still starting up";

            return "SteamVR is not ready (error " + error + ")";
        }

        /*
         * The same thing for an error that will not come right.
         *
         * Explain() is for things somebody can wait out, and its wording says
         * so. "Not ready" reads as "give it a minute" for a refusal that will
         * still be a refusal tomorrow, which is worse than saying nothing.
         */
        private static string Refused(int error)
        {
            string what;

            if (error == 123) what = "SteamVR has decided this is a utility application, and does not give those a session";
            else if (error == 130) what = "SteamVR does not accept the kind of application the bridge asks to be";
            else what = "SteamVR refused the connection outright";

            return what + " (error " + error + "), and waiting will not change that";
        }

        /*
         * Whether an init error can ever come right on its own.
         *
         * Almost none of them are worth giving up over: a headset gets plugged
         * in, SteamVR gets started, and the same call succeeds a moment later.
         * The three here are ways of asking for something this application is
         * not, which no amount of waiting changes.
         */
        private static bool Fatal(int error)
        {
            return error == 123 || error == 130 || error == 131;
        }

        private static string Num(double value)
        {
            return value.ToString("0.###", CultureInfo.InvariantCulture);
        }

        private static double Magnitude(float[] v)
        {
            if (v == null || v.Length < 3) return 0;
            return Math.Sqrt((double) v[0] * v[0] + (double) v[1] * v[1] + (double) v[2] * v[2]);
        }

        // Takes the next thing the plugin asked for, or null if it has not asked.
        private static string TakeCommand()
        {
            lock (Gate)
            {
                return _commands.Count == 0 ? null : _commands.Dequeue();
            }
        }

        /*
         * Throws away anything asked for while there was nothing to ask.
         *
         * A request for the binding panel is only worth acting on while somebody
         * is still looking at the button they clicked it with. Left in the queue,
         * it opened SteamVR's binding panel over whatever they were playing the
         * next time a headset went on, which could be hours later.
         */
        private static void Drain()
        {
            lock (Gate) { _commands.Clear(); }
        }

        /** Whether the plugin has asked to stop, or has gone away. */
        private static bool Stopping()
        {
            lock (Gate) { return _stopped; }
        }

        /*
         * Sleeps, but notices a stop while it does.
         *
         * A plain Sleep would leave a bridge asked to shut down sitting there
         * for the rest of its wait, and the plugin kills it after two seconds -
         * which loses the tidy SteamVR shutdown the pipe closing is for.
         */
        private static void Wait(int seconds)
        {
            for (int i = 0; i < seconds * 10 && !Stopping(); i++) Thread.Sleep(100);
        }

        private static void ReadCommands()
        {
            while (true)
            {
                string line = Console.In.ReadLine();

                // The plugin closed the pipe: it is gone, and so are we. Without
                // this a bridge outlives a client that crashed, holding a
                // SteamVR application registration nothing will ever clear.
                if (line == null) { lock (Gate) { _stopped = true; } return; }

                line = line.Trim();
                if (line.Length == 0) continue;

                if (line == "stop") { lock (Gate) { _stopped = true; } return; }

                // Queued rather than held in one slot: a stop arriving straight
                // after a request for the binding panel used to overwrite it, so
                // the panel never opened. Bounded, because a plugin that asks
                // faster than this can act is a bug, not a backlog to keep.
                lock (Gate) { if (_commands.Count < 8) _commands.Enqueue(line); }
            }
        }

        /*
         * One process for as long as the setting is on, whether SteamVR is there
         * or not.
         *
         * The plugin used to start one of these every fifteen seconds while it
         * waited, and every start recompiled the C# above - a full csc run, a
         * little over a second of it, all day, on a machine that is also running
         * a game. So the waiting happens in here now, where it costs a sleeping
         * thread, and the supervisor on the other end only has to restart this
         * if it actually dies.
         */
        public static void Run(string apiPath, string actionsPath, string manifestPath, string appKey, string actionList)
        {
            IntPtr library = LoadLibrary(apiPath);
            if (library == IntPtr.Zero) { Fail("openvr_api.dll could not be loaded from " + apiPath); return; }

            try
            {
                IntPtr initAddress = GetProcAddress(library, "VR_InitInternal");
                IntPtr shutdownAddress = GetProcAddress(library, "VR_ShutdownInternal");
                IntPtr interfaceAddress = GetProcAddress(library, "VR_GetGenericInterface");

                if (initAddress == IntPtr.Zero || shutdownAddress == IntPtr.Zero || interfaceAddress == IntPtr.Zero)
                {
                    Fail("openvr_api.dll is not the library it claims to be: the entry points are missing");
                    return;
                }

                /*
                 * The sizes the header says these are, checked rather than
                 * trusted. A struct laid out differently than OpenVR expects
                 * does not crash: it reads neighbouring bytes as floats, and the
                 * motion detector acts on the result. Wrong numbers that look
                 * like numbers are the worst outcome available here.
                 */
                if (Marshal.SizeOf(typeof(ActiveActionSet)) != 32
                    || Marshal.SizeOf(typeof(DigitalActionData)) != 24
                    || Marshal.SizeOf(typeof(DevicePose)) != 80
                    || Marshal.SizeOf(typeof(Matrix34)) != 48)
                {
                    Fail("The OpenVR structures are not the size they are supposed to be, refusing to call into them");
                    return;
                }

                InitInternal init = (InitInternal) Marshal.GetDelegateForFunctionPointer(initAddress, typeof(InitInternal));
                ShutdownInternal shutdown = (ShutdownInternal) Marshal.GetDelegateForFunctionPointer(shutdownAddress, typeof(ShutdownInternal));
                GetGenericInterface get = (GetGenericInterface) Marshal.GetDelegateForFunctionPointer(interfaceAddress, typeof(GetGenericInterface));

                Thread reader = new Thread(ReadCommands);
                reader.IsBackground = true;
                reader.Start();

                // What was last said about not being attached, so the same line
                // is not printed twelve times a minute at a plugin that already
                // knows. Cleared on every attach, so taking a headset off and
                // putting it back on says both things again.
                string said = "";

                while (!Stopping())
                {
                    // Before the attempt, so that neither a wait nor a session
                    // starts holding something asked for a long time ago.
                    Drain();

                    int error = 0;

                    /*
                     * Background, not Overlay. An overlay application starts
                     * SteamVR if it is not already running, and Discord
                     * launching SteamVR because a setting is on would be
                     * indefensible. Background attaches to a session that
                     * exists and fails cleanly when there is none.
                     */
                    init(ref error, ApplicationBackground);

                    if (error != 0)
                    {
                        // Called even though the init failed: OpenVR keeps state
                        // per process from a half-finished attempt, and the next
                        // attempt would inherit it.
                        shutdown();

                        if (Fatal(error)) { Fail(Refused(error)); return; }

                        string reason = Explain(error);
                        if (reason != said)
                        {
                            Say("{\\"t\\":\\"waiting\\",\\"reason\\":\\"" + Esc(reason) + "\\"}");
                            said = reason;
                        }

                        Wait(RetrySeconds);
                        continue;
                    }

                    said = "";

                    bool again = Session(get, appKey, actionsPath, manifestPath, actionList);
                    shutdown();

                    if (!again) return;
                }
            }
            finally
            {
                FreeLibrary(library);
            }
        }

        /*
         * One attached session, from the interfaces to SteamVR going away again.
         *
         * Returns true if it is worth waiting for SteamVR to come back, false if
         * the bridge is done - asked to stop, or stopped by something no retry
         * fixes.
         */
        private static bool Session(GetGenericInterface get, string appKey, string actionsPath, string manifestPath, string actionList)
        {
            int error = 0;

            IntPtr system = get("FnTable:IVRSystem_026", ref error);
            if (system == IntPtr.Zero) { Fail("This SteamVR is too old: it has no IVRSystem_026"); return false; }

            IntPtr input = get("FnTable:IVRInput_011", ref error);
            if (input == IntPtr.Zero) { Fail("This SteamVR is too old: it has no IVRInput_011"); return false; }

            IntPtr apps = get("FnTable:IVRApplications_008", ref error);
            if (apps == IntPtr.Zero) { Fail("This SteamVR is too old: it has no IVRApplications_008"); return false; }

            /*
             * The overlay is the one interface allowed to be absent.
             *
             * Everything above this is what the binds are made of, and a
             * SteamVR without it is a SteamVR the plugin cannot work on at all.
             * The panel is a nicety on top: a runtime too old to draw it should
             * cost the player the picture and nothing else, so a missing
             * interface here warns and carries on with a zero handle, which
             * every panel command below checks for.
             */
            IntPtr overlay = get("FnTable:IVROverlay_028", ref error);
            ulong panel = 0;

            if (overlay == IntPtr.Zero) Warn("This SteamVR has no IVROverlay_028, so the binds will work but nothing will be drawn in the headset");
            else if (!MakePanel(overlay, appKey, ref panel)) overlay = IntPtr.Zero;

            // IVRSystem index 49, GetRuntimeVersion, the last entry but one.
            // Reached correctly only if every index before it was counted
            // right, which is the whole point of asking.
            IntPtr versionPtr = Entry<RuntimeVersion>(system, 49)();
            string version = versionPtr == IntPtr.Zero ? "" : Marshal.PtrToStringAnsi(versionPtr);

            if (string.IsNullOrEmpty(version) || version.Length > 64)
            {
                Fail("The OpenVR function tables are not laid out as expected, refusing to call into them");
                return false;
            }

            // IVRApplications index 0, AddApplicationManifest. Temporary, so
            // nothing is left in SteamVR's application list afterwards.
            Entry<AddManifest>(apps, 0)(manifestPath, true);

            // IVRApplications index 11, IdentifyApplication. This is what
            // makes the binding panel say Clipper rather than powershell.
            Entry<Identify>(apps, 11)((uint) System.Diagnostics.Process.GetCurrentProcess().Id, appKey);

            // IVRInput index 0, SetActionManifestPath.
            int failed = Entry<SetManifest>(input, 0)(actionsPath);
            if (failed != 0) { Fail("SteamVR rejected the action manifest (error " + failed + ")"); return false; }

            // IVRInput index 1, GetActionSetHandle; index 2, GetActionHandle.
            GetHandle setHandles = Entry<GetHandle>(input, 1);
            GetHandle actionHandles = Entry<GetHandle>(input, 2);

            // The set, then every action in it, separated by pipes: one
            // argument rather than a variable number of them.
            string[] parts = actionList.Split('|');

            ulong setHandle = 0;
            failed = setHandles(parts[0], out setHandle);
            if (failed != 0) { Fail("SteamVR does not know the action set (error " + failed + ")"); return false; }

            string[] names = new string[parts.Length - 1];
            ulong[] actions = new ulong[parts.Length - 1];
            string missing = "";
            int usable = 0;

            for (int i = 1; i < parts.Length; i++)
            {
                ulong handle = 0;

                // Checked, not assumed. An action SteamVR does not recognise
                // comes back as a zero handle and is skipped in the loop below,
                // which used to mean a button that quietly did nothing for ever
                // with nothing anywhere saying why.
                if (actionHandles(parts[0] + "/in/" + parts[i], out handle) != 0 || handle == 0)
                {
                    missing = missing.Length == 0 ? parts[i] : missing + ", " + parts[i];
                    handle = 0;
                }
                else usable++;

                names[i - 1] = parts[i];
                actions[i - 1] = handle;
            }

            if (usable == 0)
            {
                Fail("SteamVR did not recognise any of the plugin's actions, so no controller button can reach it");
                return false;
            }

            ActiveActionSet[] active = new ActiveActionSet[1];
            active[0].ActionSet = setHandle;

            UpdateState update = Entry<UpdateState>(input, 4);
            DigitalData digital = Entry<DigitalData>(input, 5);
            BindingUI openBindings = Entry<BindingUI>(input, 32);
            GetPoses poses = Entry<GetPoses>(system, 12);
            IndexForRole role = Entry<IndexForRole>(system, 18);

            uint setSize = (uint) Marshal.SizeOf(typeof(ActiveActionSet));
            uint dataSize = (uint) Marshal.SizeOf(typeof(DigitalActionData));
            int stride = Marshal.SizeOf(typeof(DevicePose));
            IntPtr buffer = Marshal.AllocHGlobal(stride * MaxDevices);

            Say("{\\"t\\":\\"ready\\",\\"runtime\\":\\"" + Esc(version) + "\\"}");

            // After the ready line rather than before it, because the plugin
            // clears the last problem when a bridge attaches - and this one is
            // still true of the bridge that just did. Said again after every
            // re-attach, for the same reason.
            if (missing.Length > 0) Warn("SteamVR did not recognise these actions, and nothing can be bound to them: " + missing);

            try
            {
                int tick = 0;
                int lost = 0;
                DateTime until = DateTime.MinValue;

                while (!Stopping())
                {
                    // Null nearly every time round: nothing has been asked
                    // for. Checked once here rather than at each branch, because
                    // the branches below are not all plain comparisons, and a
                    // comparison is the only thing null survives.
                    string command = TakeCommand();

                    if (command != null)
                    {
                        // IVRInput index 32, OpenBindingUI: SteamVR's own
                        // binding panel, opened on our action set. Shown on the
                        // desktop as well as in the headset, because the person
                        // who just clicked the button in Discord is looking at
                        // a monitor.
                        if (command == "bindings") openBindings(appKey, setHandle, 0, true);

                        // A picture to put in front of the player's eyes,
                        // painted in the browser and left in a file because a
                        // few hundred kilobytes of pixels do not belong on a
                        // line-by-line pipe.
                        else if (command.StartsWith("panel ")) until = ShowPanel(overlay, panel, command);
                        else if (command == "panelhide") { HidePanel(overlay, panel); until = DateTime.MinValue; }
                    }

                    /*
                     * The countdown is kept here rather than in the plugin.
                     *
                     * Whatever asked for the panel is a renderer that can be
                     * busy, reloaded or closed in the seconds between showing
                     * it and taking it away, and none of those should be able
                     * to leave a picture nailed across somebody's view of the
                     * game. The side that draws it is the side that can always
                     * be counted on to hide it.
                     */
                    if (until != DateTime.MinValue && DateTime.UtcNow >= until)
                    {
                        HidePanel(overlay, panel);
                        until = DateTime.MinValue;
                    }

                    /*
                     * The return value is the only warning that SteamVR has
                     * gone: it does not kill this process, the calls simply
                     * start failing. A second of them in a row is treated as a
                     * shutdown and sends the outer loop back to waiting, so
                     * taking a headset off and putting it on again costs
                     * nothing and starts nothing.
                     */
                    if (update(active, setSize, 1) != 0)
                    {
                        if (++lost >= LostLimit) return true;

                        Thread.Sleep(20);
                        continue;
                    }

                    lost = 0;

                    for (int i = 0; i < actions.Length; i++)
                    {
                        if (actions[i] == 0) continue;

                        DigitalActionData data = new DigitalActionData();
                        if (digital(actions[i], ref data, dataSize, 0) != 0) continue;

                        // Changed as well as State: held down is one press,
                        // not fifty a second.
                        if (data.Active && data.State && data.Changed)
                        {
                            Say("{\\"t\\":\\"action\\",\\"name\\":\\"" + Esc(names[i]) + "\\"}");
                        }
                    }

                    // Poses ten times a second rather than fifty. Hands do not
                    // change direction meaningfully faster than that, and the
                    // line is being parsed by a browser.
                    if (++tick >= 5)
                    {
                        tick = 0;
                        poses(UniverseStanding, 0f, buffer, MaxDevices);

                        DevicePose head = (DevicePose) Marshal.PtrToStructure(buffer, typeof(DevicePose));
                        double hands = 0;

                        uint left = role(RoleLeftHand);
                        uint right = role(RoleRightHand);

                        if (left < MaxDevices) hands = Math.Max(hands, HandSpeed(buffer, stride, left));
                        if (right < MaxDevices) hands = Math.Max(hands, HandSpeed(buffer, stride, right));

                        double turn = head.PoseIsValid ? Magnitude(head.AngularVelocity) : 0;

                        Say("{\\"t\\":\\"motion\\",\\"hands\\":" + Num(hands) + ",\\"head\\":" + Num(turn) + "}");
                    }

                    Thread.Sleep(20);
                }
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);

                // IVROverlay index 3, DestroyOverlay. SteamVR would drop it
                // when the process goes, but this process is meant to outlive
                // several SteamVR sessions: leaving them behind would put one
                // more dead overlay in the compositor on every re-attach.
                if (overlay != IntPtr.Zero && panel != 0) Entry<DropOverlay>(overlay, 3)(panel);
            }

            return false;
        }

        /**
         * Makes the panel, and puts it where the player can read it.
         *
         * The canary first: index 8 turns an error number back into its own
         * name, so calling it with zero and getting "VROverlayError_None" says
         * that this table is laid out where the header says it is - before
         * anything is created, and without a single call that could be a
         * different function taking different arguments.
         */
        private static bool MakePanel(IntPtr overlay, string appKey, ref ulong panel)
        {
            IntPtr namePtr;

            try { namePtr = Entry<OverlayErrorName>(overlay, 8)(0); }
            catch { namePtr = IntPtr.Zero; }

            string none = namePtr == IntPtr.Zero ? "" : Marshal.PtrToStringAnsi(namePtr);

            if (none != "VROverlayError_None")
            {
                Warn("The IVROverlay function table is not laid out as expected, so nothing will be drawn in the headset");
                return false;
            }

            // IVROverlay index 1, CreateOverlay. The key is what SteamVR
            // identifies it by and has to be unique across everything running;
            // the name is what a person sees in the compositor's own lists.
            int failed = Entry<MakeOverlay>(overlay, 1)(appKey + ".panel", "Clipper", ref panel);

            if (failed != 0 || panel == 0)
            {
                Warn("SteamVR refused to make the overlay (error " + failed + "), so nothing will be drawn in the headset");
                return false;
            }

            // IVROverlay index 22, SetOverlayWidthInMeters. Height follows from
            // the picture's own shape, so only the width is ever set.
            Entry<OverlayWidth>(overlay, 22)(panel, PanelMetres);

            /*
             * A rotation about x, then the offset, in the headset's own frame.
             *
             * Row-major three by four: the left three columns turn, the last
             * one moves. Negative z is forward in OpenVR, so the panel sits a
             * metre in front and a little below, pitched up towards the eyes by
             * the same angle it was put down by.
             */
            double c = Math.Cos(PanelTilt);
            double s = Math.Sin(PanelTilt);

            Matrix34 place = new Matrix34();
            place.M00 = 1f; place.M03 = 0f;
            place.M11 = (float) c; place.M12 = (float) -s; place.M13 = PanelDown;
            place.M21 = (float) s; place.M22 = (float) c; place.M23 = PanelForward;

            // IVROverlay index 35, SetOverlayTransformTrackedDeviceRelative,
            // on device 0 - the headset, which OpenVR reserves that index for.
            Entry<OverlayFollow>(overlay, 35)(panel, 0, ref place);

            return true;
        }

        /**
         * Draws one picture and shows it, returning when it should go away.
         *
         * The command is: panel, then width, height, milliseconds and the path,
         * in that order. The numbers come first so that the path can be the
         * whole of the rest of the line: it is a Windows path out of a folder
         * under the user's profile, and those have spaces in them often
         * enough to be worth never thinking about.
         */
        private static DateTime ShowPanel(IntPtr overlay, ulong panel, string command)
        {
            if (overlay == IntPtr.Zero || panel == 0) return DateTime.MinValue;

            string[] parts = command.Split(new char[] { ' ' }, 5);
            if (parts.Length < 5) return DateTime.MinValue;

            int width, height, ms;

            if (!int.TryParse(parts[1], out width) || !int.TryParse(parts[2], out height) || !int.TryParse(parts[3], out ms)) return DateTime.MinValue;
            if (width <= 0 || height <= 0 || width > PanelLimit || height > PanelLimit || ms <= 0) return DateTime.MinValue;

            byte[] pixels;

            /*
             * Read once, then delete, whatever happened next.
             *
             * The file is this side's to dispose of: the plugin writes it into
             * the temporary directory and forgets it, because the moment it has
             * handed the path over it has no way of knowing when the picture
             * has been read and the file is safe to remove.
             */
            try { pixels = File.ReadAllBytes(parts[4]); }
            catch { return DateTime.MinValue; }
            finally { try { File.Delete(parts[4]); } catch { } }

            // Four bytes to the pixel, and exactly as many as were promised: a
            // buffer shorter than its stated size is read past the end of by
            // the compositor rather than refused.
            if (pixels.Length != width * height * 4) return DateTime.MinValue;

            GCHandle pinned = GCHandle.Alloc(pixels, GCHandleType.Pinned);

            try
            {
                // IVROverlay index 62, SetOverlayRaw. Plain RGBA out of main
                // memory, which is why none of this needs a graphics device.
                if (Entry<OverlayPixels>(overlay, 62)(panel, pinned.AddrOfPinnedObject(), (uint) width, (uint) height, 4) != 0) return DateTime.MinValue;
            }
            finally
            {
                pinned.Free();
            }

            // IVROverlay index 43, ShowOverlay.
            Entry<OverlayShow>(overlay, 43)(panel);

            return DateTime.UtcNow.AddMilliseconds(ms);
        }

        /** IVROverlay index 44, HideOverlay. Harmless on one already hidden. */
        private static void HidePanel(IntPtr overlay, ulong panel)
        {
            if (overlay == IntPtr.Zero || panel == 0) return;

            Entry<OverlayShow>(overlay, 44)(panel);
        }

        private static double HandSpeed(IntPtr buffer, int stride, uint index)
        {
            DevicePose pose = (DevicePose) Marshal.PtrToStructure(new IntPtr(buffer.ToInt64() + (long) stride * index), typeof(DevicePose));
            return pose.PoseIsValid ? Magnitude(pose.Velocity) : 0;
        }
    }
}
`,ti=`# Vencord Clipper - SteamVR bridge. Generated; edits are overwritten.
param(
    [Parameter(Mandatory = $true)][string] $Api,
    [Parameter(Mandatory = $true)][string] $Actions,
    [Parameter(Mandatory = $true)][string] $Manifest,
    [Parameter(Mandatory = $true)][string] $AppKey,
    [Parameter(Mandatory = $true)][string] $ActionList
)

$ErrorActionPreference = "Stop"

# Before anything is written, including the compile failure below.
#
# A pipe gets whatever [Console]::OutputEncoding says, and on a machine that is
# not set to English that is the OEM code page rather than UTF-8: every accented
# character in a message from Windows or from PowerShell itself arrives at the
# plugin as a replacement character, and the one place those messages are ever
# read is a settings row explaining why the bridge is not running.
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }

$source = @'
${fa}
'@

try {
    Add-Type -TypeDefinition $source -Language CSharp
} catch {
    Write-Output ('{"t":"error","message":"The bridge could not be compiled: ' + ($_.Exception.Message -replace '["\\\\]', ' ' -replace '\\s+', ' ') + '"}')
    exit 1
}

# Wrapped, because nothing else catches this. An exception on the way out of Run
# - a function table slot that is not where the header says it is, a pointer that
# is not what it claims - would otherwise reach PowerShell, be printed to standard
# error, and leave the plugin holding a dead bridge it thinks is worth starting
# again every fifteen seconds, compiling all of the above each time.
try {
    [Clipper.Bridge]::Run($Api, $Actions, $Manifest, $AppKey, $ActionList)
} catch {
    Write-Output ('{"t":"error","message":"The bridge stopped: ' + ($_.Exception.Message -replace '["\\\\]', ' ' -replace '\\s+', ' ') + '"}')
    exit 1
}
`;c();var ri=require("electron"),F=require("fs"),V=require("path"),Nt="vencord.clipper",oe="/actions/clipper",pt=["save","mark","toggle","pov"],ha=["save","mark"],ma={save:"Save a clip",mark:"Drop a marker",toggle:"Start / stop the clip buffer",pov:"Ask the call for their angle"};function xn(){let t=(0,V.join)(ri.app.getPath("userData"),"clipper-vr");return(0,F.mkdirSync)(t,{recursive:!0}),t}function ga(){let t=(0,V.join)(process.env.LOCALAPPDATA??"","openvr","openvrpaths.vrpath");try{let n=JSON.parse((0,F.readFileSync)(t,"utf8")).runtime;if(Array.isArray(n)){for(let r of n)if(typeof r=="string"&&(0,F.existsSync)((0,V.join)(r,"bin","win64","openvr_api.dll")))return r}}catch{}let e=(0,V.join)(process.env["ProgramFiles(x86)"]??"C:\\Program Files (x86)","Steam","steamapps","common","SteamVR");return(0,F.existsSync)((0,V.join)(e,"bin","win64","openvr_api.dll"))?e:null}function ii(){let t=ga();return t&&(0,V.join)(t,"bin","win64","openvr_api.dll")}var va=.4,ya={save:"double",mark:"long"};function wa(t,e,n){return{path:t,mode:"button",inputs:{[e]:{output:`${oe}/in/${n}`}},parameters:e==="long"?{long_press_delay:va}:{}}}function ni(t,e){return{app_key:Nt,controller_type:t,description:"Where Clipper's two default binds start out. Change them here, and add the rest.",name:"Clipper defaults",action_manifest_version:0,bindings:{[oe]:{sources:ha.map(n=>wa(e[n],ya[n],n))}}}}function oi(){let t=xn(),e={language_tag:"en_US",[oe]:"Clipper"};for(let o of pt)e[`${oe}/in/${o}`]=ma[o];let n={default_bindings:[{controller_type:"knuckles",binding_url:"bindings_knuckles.json"},{controller_type:"oculus_touch",binding_url:"bindings_oculus_touch.json"}],action_sets:[{name:oe,usage:"leftright"}],actions:pt.map(o=>({name:`${oe}/in/${o}`,type:"boolean",requirement:"optional"})),localization:[e]},r={save:"/user/hand/right/input/b",mark:"/user/hand/right/input/a"};(0,F.writeFileSync)((0,V.join)(t,"bindings_knuckles.json"),JSON.stringify(ni("knuckles",r),null,4),"utf8"),(0,F.writeFileSync)((0,V.join)(t,"bindings_oculus_touch.json"),JSON.stringify(ni("oculus_touch",r),null,4),"utf8");let i=(0,V.join)(t,"actions.json");return(0,F.writeFileSync)(i,JSON.stringify(n,null,4),"utf8"),i}function ai(t){let e={source:"builtin",applications:[{app_key:Nt,launch_type:"binary",binary_path_windows:t,is_dashboard_overlay:!1,strings:{en_us:{name:"Clipper",description:"Clip what just happened, from the controller."}}}]},n=(0,V.join)(xn(),"clipper.vrmanifest");return(0,F.writeFileSync)(n,JSON.stringify(e,null,4),"utf8"),n}function kn(){return(0,V.join)(xn(),"bridge.ps1")}var ba=15e3,Sa=45e3,si=3,xa=3,ka=2e3,_=null,mt=!1,J="",M="",we="",be=!1,Tn=0,di=0,Ne=null,ft=[],ht=null,ae=[],Ut=Promise.resolve();function li(t){let e=ae.shift();if(e){e(t);return}if(t.kind==="motion"){ht=t;return}ft.push(t.action),ft.length>8&&ft.shift()}function Ea(t){let e=t.trim();if(!e.startsWith("{"))return!1;let n;try{n=JSON.parse(e)}catch{return!1}if(n.t==="ready")return J=String(n.runtime??""),M="",we="",be=!1,!0;if(n.t==="waiting")return J="",M="",we=String(n.reason??""),!0;if(n.t==="warning")return M=String(n.message??"The SteamVR bridge reported something wrong without saying what"),!0;if(n.t==="error")return M=String(n.message??"The SteamVR bridge failed for a reason it did not give"),be=!J||++di>=xa,!0;if(n.t==="action"){let r=pt.find(i=>i===n.name);return r&&li({kind:"action",action:r}),!1}return n.t==="motion"&&li({kind:"motion",hands:Number(n.hands)||0,head:Number(n.head)||0}),!1}function En(){Ne||!mt||be||(Ne=setTimeout(()=>{Ne=null,mt&&pi()},ba))}function pi(){if(_)return Promise.resolve();let t=ii();if(!t)return En(),Promise.resolve();let e;try{let n=kn();(0,In.writeFileSync)(n,ti,"utf8");let r=(0,gt.join)(process.env.SystemRoot??"C:\\Windows","System32","WindowsPowerShell","v1.0","powershell.exe");e=(0,ci.spawn)(r,["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",n,"-Api",t,"-Actions",oi(),"-Manifest",ai(r),"-AppKey",Nt,"-ActionList",[oe,...pt].join("|")],{windowsHide:!0,stdio:["pipe","pipe","pipe"]})}catch(n){return M=`The SteamVR bridge could not be started (${n.message}).`,En(),Promise.resolve()}return _=e,J="",we="",be=!1,new Promise(n=>{let r=!1,i=()=>{r||(r=!0,clearTimeout(o),n())},o=setTimeout(()=>{M="The SteamVR bridge did not come up. Compiling it may have failed; nothing else is affected.",i()},Sa),a="";e.stdout?.on("data",s=>{a+=s.toString("utf8");let l=a.split(`
`);a=l.pop()??"";for(let h of l)Ea(h)&&i()}),e.stderr?.on("data",s=>{M||(M=s.toString("utf8").trim().slice(0,300))}),e.on("error",s=>{M=`The SteamVR bridge could not be started (${s.message}).`,i()}),e.on("exit",()=>{_===e&&(!J&&!we&&!be?++Tn>=si&&(be=!0,M||(M=`The SteamVR bridge stopped ${si} times without saying why. Switch the VR controls off and on again to try it once more.`)):Tn=0,_=null,J="",we="");let s=ae;ae=[];for(let l of s)l(null);i(),En()})})}function fi(){Ne&&(clearTimeout(Ne),Ne=null);let t=_;_=null,J="",we="",be=!1,Tn=0,di=0,ft=[],ht=null;let e=ae;ae=[];for(let r of e)r(null);if(!t)return;try{t.stdin?.end()}catch{}let n=setTimeout(()=>{try{t.kill()}catch{}},ka);t.on("exit",()=>clearTimeout(n))}function hi(t){let e=Ut.then(async()=>(mt=t,t?(await pi(),Gt()):(fi(),M="",Gt())));return Ut=e.catch(()=>{}),e}function Pn(){let t=Ut.then(()=>{mt=!1,fi()});return Ut=t.catch(()=>{}),t}function Gt(){return{running:_!==null&&J!=="",wanted:mt,runtime:J,problem:M,waiting:we}}function mi(){if(!_?.stdin?.writable)return!1;try{return _.stdin.write(`bindings
`),!0}catch{return!1}}var Ta=0;function gi(t,e,n,r){if(!_?.stdin?.writable||e<=0||n<=0||t.length!==e*n*4)return!1;let i=(0,gt.join)((0,gt.dirname)(kn()),`panel-${Ta++%8}.rgba`);try{return(0,In.writeFileSync)(i,t),_.stdin.write(`panel ${e} ${n} ${Math.round(r)} ${i}
`),!0}catch{return!1}}function vi(){if(!_?.stdin?.writable)return!1;try{return _.stdin.write(`panelhide
`),!0}catch{return!1}}function yi(t=3e4){let e=ft.shift();if(e)return Promise.resolve({kind:"action",action:e});if(ht){let n=ht;return ht=null,Promise.resolve(n)}return new Promise(n=>{let r=!1,i=a=>{r||(r=!0,clearTimeout(o),n(a))},o=setTimeout(()=>{ae=ae.filter(a=>a!==i),i(null)},t);ae.push(i)})}ui.app.on("will-quit",()=>{Pn()});var Si=!0,_n=!1,xi=/vesktop|equibop/i.test(v.app.getName());function x(t){let e=t?.trim();return e&&(0,f.isAbsolute)(e)?e:(0,f.join)(v.app.getPath("videos"),"DiscordClips")}function $e(t){let n=(0,f.basename)(String(t??"").replace(/[\\/]/g,"_")).trim().replace(/[<>:"|?*\x00-\x1f]/g,"_").replace(/^\.+/,""),r=/^([\w.\-+ ()[\]]{1,120})\.(webm|mp4|png|jpg|gif)$/i.exec(n);return r?`${r[1]}.${r[2].toLowerCase()}`:null}function ze(t){return $e(t)??`clip-${Date.now()}.webm`}function Dn(t,e){let n=(0,f.extname)(e),r=e.slice(0,e.length-n.length),i=(0,f.join)(t,e);for(let o=2;(0,p.existsSync)(i)&&o<1e3;o++)i=(0,f.join)(t,`${r} (${o})${n}`);return i}function Ia(t,e,n,r,i=!1){let o=x(e);(0,p.mkdirSync)(o,{recursive:!0});let a=ze(n),s=i?Dn(o,a):(0,f.join)(o,a);return(0,p.writeFileSync)(s,Buffer.from(r)),s}function Pa(t,e,n){let r=x(e);return(0,p.mkdirSync)(r,{recursive:!0}),Dn(r,ze(n))}var $t="voices";function Aa(t,e){let n=$e(t);return!n||!/^\d{1,25}$/.test(String(e??""))?null:`${n.slice(0,n.length-(0,f.extname)(n).length)}.${e}.webm`}function Ca(t,e){let n=$e(e);if(!n)return[];let r=(0,f.join)(x(t),$t);if(!(0,p.existsSync)(r))return[];let i=`${n.slice(0,n.length-(0,f.extname)(n).length)}.`,o=[];for(let a of(0,p.readdirSync)(r,{withFileTypes:!0})){if(!a.isFile()||!a.name.startsWith(i)||!a.name.toLowerCase().endsWith(".webm"))continue;let s=a.name.slice(i.length,a.name.length-5);/^\d{1,25}$/.test(s)&&o.push({userId:s,file:a.name})}return o}function Ra(t,e,n,r,i){let o=Aa(n,r);if(!o)return null;let a=(0,f.join)(x(e),$t);(0,p.mkdirSync)(a,{recursive:!0});let s=(0,f.join)(a,o);return(0,p.writeFileSync)(s,Buffer.from(i)),s}function Ma(t,e,n){let r=(0,f.basename)(String(n??"").replace(/[\\/]/g,"_"));if(!r.toLowerCase().endsWith(".webm")||r.includes(".."))throw new Error("not a voice track");return new Uint8Array((0,p.readFileSync)((0,f.join)(x(e),$t,r)))}function _a(t,e){let n=(0,f.join)(x(t),$t);for(let{file:r}of Ca(t,e))try{(0,p.unlinkSync)((0,f.join)(n,r))}catch{}}function Da(t,e){let n=x(e);if(!(0,p.existsSync)(n))return[];let r=[],i=new Set,o=(0,p.readdirSync)(n,{withFileTypes:!0});for(let a of o)a.isFile()&&i.add(a.name);for(let a of o){if(!a.isFile()||!/\.(webm|mp4)$/i.test(a.name))continue;let s=(0,f.join)(n,a.name);try{let l=(0,p.statSync)(s),h=dt(a.name);r.push({name:a.name,path:s,size:l.size,modified:l.mtimeMs,...i.has(h)?{thumb:h}:{}})}catch{}}return r.sort((a,s)=>s.modified-a.modified)}function Oa(t,e,n){let r=(0,f.join)(x(e),ze(n));return new Uint8Array((0,p.readFileSync)(r))}async function La(t,e,n){let r=x(e),i=ze(n),o=(0,f.join)(r,i);try{await v.shell.trashItem(o)}catch{(0,p.unlinkSync)(o)}_a(e,i);let a=(0,f.join)(r,dt(i));if((0,p.existsSync)(a))try{await v.shell.trashItem(a)}catch{try{(0,p.unlinkSync)(a)}catch{}}}function Va(t,e,n,r){let i=x(e),o=ze(n),a=(0,f.join)(i,o),s=(0,f.extname)(o),l=$e(r.toLowerCase().endsWith(s)?r:r+s);if(!l)throw new Error("That name cannot be used. Keep it under 120 characters, with letters, digits, spaces or - _ . + ( ) [ ]");if(l===o)return o;let d=l.toLowerCase()===o.toLowerCase()?(0,f.join)(i,l):Dn(i,l);(0,p.renameSync)(a,d);let u=(0,f.join)(i,dt(o));if((0,p.existsSync)(u))try{(0,p.renameSync)(u,(0,f.join)(i,dt((0,f.basename)(d))))}catch{}return(0,f.basename)(d)}var ki="clipper-library.json";function Fa(t,e){let n=(0,f.join)(x(e),ki);if(!(0,p.existsSync)(n))return"";try{return(0,p.readFileSync)(n,"utf8")}catch{return""}}function Na(t,e,n){let r=x(e);(0,p.mkdirSync)(r,{recursive:!0});let i=(0,f.join)(r,ki),o=`${i}.tmp`;(0,p.writeFileSync)(o,String(n??""),"utf8"),(0,p.renameSync)(o,i)}async function Ua(t){let e=await v.dialog.showOpenDialog({title:"Add videos to the timeline",properties:["openFile","multiSelections"],filters:[{name:"Video",extensions:["mp4","webm","mkv","mov","m4v"]}]});return e.canceled?[]:e.filePaths}var Ga=512*1024*1024;function $a(t,e){if(!(0,f.isAbsolute)(e)||!/\.(mp4|webm|mkv|mov|m4v)$/i.test(e))throw new Error("Not a video file");let n=(0,p.statSync)(e);if(n.size>Ga){let r=Math.round(n.size/1048576);throw new Error(`That video is ${r} MB; imports are capped at 512 MB. Trim it or lower its bitrate first.`)}return new Uint8Array((0,p.readFileSync)(e))}async function za(t){let e=await v.dialog.showOpenDialog({title:"Add sounds to the timeline",properties:["openFile","multiSelections"],filters:[{name:"Audio",extensions:["mp3","wav","ogg","opus","m4a","aac","flac","webm"]}]});return e.canceled?[]:e.filePaths}var Wa=64*1024*1024;function ja(t,e){if(!(0,f.isAbsolute)(e)||!/\.(mp3|wav|ogg|opus|m4a|aac|flac|webm)$/i.test(e))throw new Error("Not an audio file");let n=(0,p.statSync)(e);if(n.size>Wa){let r=Math.round(n.size/1048576);throw new Error(`That sound is ${r} MB; the timeline caps them at 64 MB.`)}return new Uint8Array((0,p.readFileSync)(e))}async function Ba(t){let e=await v.dialog.showOpenDialog({title:"Add pictures and clips to the montage",properties:["openFile","multiSelections"],filters:[{name:"Pictures and clips",extensions:["png","jpg","jpeg","webp","gif","avif","bmp","mp4","webm"]},{name:"Pictures",extensions:["png","jpg","jpeg","webp","gif","avif","bmp"]},{name:"Clips",extensions:["mp4","webm"]}]});return e.canceled?[]:e.filePaths}var Ha=24*1024*1024,Ka=64*1024*1024;function Za(t,e){if(!(0,f.isAbsolute)(e)||!/\.(png|jpe?g|webp|gif|avif|bmp|mp4|webm)$/i.test(e))throw new Error("Not a picture or a clip");let n=/\.(mp4|webm)$/i.test(e),r=n?Ka:Ha,i=(0,p.statSync)(e);if(i.size>r){let o=Math.round(i.size/1048576),a=Math.round(r/(1024*1024));throw new Error(`That ${n?"clip":"picture"} is ${o} MB; the montage caps them at ${a} MB.`)}return new Uint8Array((0,p.readFileSync)(e))}function qa(t,e,n){v.shell.showItemInFolder((0,f.join)(x(e),ze(n)))}function Ya(t,e){return x(e)}async function Ja(t,e){let n=await v.dialog.showOpenDialog({title:"Where should clips be saved?",defaultPath:x(e),properties:["openDirectory","createDirectory"]});return n.canceled?"":n.filePaths[0]??""}function Xa(t,e){let n=x(e);(0,p.mkdirSync)(n,{recursive:!0}),v.shell.openPath(n)}function Qa(t){return{platform:"win32",wayland:_n,vesktop:xi,overlay:Ft()}}var se=new Set;async function es(t,e=!0){if(_n)return[];let n=await v.desktopCapturer.getSources({types:["screen","window"],thumbnailSize:e?{width:320,height:180}:{width:0,height:0},fetchWindowIcons:!1});if(se.size){let i=new Set(n.map(o=>o.id));for(let o of se)i.has(o)||se.delete(o)}let r=[];for(let i of n){let o=i.id.startsWith("screen:");if(!e){if(!o&&se.has(i.id))continue;r.push({id:i.id,name:i.name,thumbnail:""});continue}let a=i.thumbnail.isEmpty();if(Si&&!o&&a){se.add(i.id);continue}se.delete(i.id),r.push({id:i.id,name:i.name,thumbnail:a?"":i.thumbnail.toDataURL(),capturable:!0})}return r}async function ts(t){try{return v.app.getAppMetrics().map(e=>({type:e.serviceName||e.type,mb:Math.round((e.memory?.workingSetSize??0)/1024)})).filter(e=>e.mb>0).sort((e,n)=>n.mb-e.mb)}catch{return[]}}async function ns(t){if(_n)return"";let e=await v.desktopCapturer.getSources({types:["screen"],thumbnailSize:{width:0,height:0}});if(!e.length)return"";try{let n=v.screen.getDisplayNearestPoint(v.screen.getCursorScreenPoint()),r=e.find(i=>i.display_id===String(n.id));if(r)return r.id}catch{}return e[0].id}var An="",Cn=!1;function rs(t,e,n=!0){return!n||xi?!1:(An=e??"",Cn=!0,v.session.defaultSession.setDisplayMediaRequestHandler(async(r,i)=>{let o=await v.desktopCapturer.getSources({types:["screen","window"],thumbnailSize:{width:0,height:0}}),a=o.find(h=>h.id===An),l=(a&&!se.has(a.id)?a:void 0)??o.find(h=>h.id.startsWith("screen:"))??o.find(h=>!se.has(h.id));if(!l){i({});return}i(Si&&l.id.startsWith("screen:")?{video:l,audio:"loopback"}:{video:l})},{useSystemPicker:!1}),!0)}function is(t){An="",Cn&&(Cn=!1,v.session.defaultSession.setDisplayMediaRequestHandler(null))}var Rn=new Map,Ue=[],vt=[];function os(t){let e=Ue.shift();if(e){e(t);return}vt.push(t),vt.length>8&&vt.shift()}function as(t,e){On();let n=[];for(let[r,i]of Object.entries(e)){if(!i)continue;let o=!1;try{o=v.globalShortcut.register(i,()=>os(r))}catch{o=!1}o?Rn.set(r,i):n.push(i)}return n}function On(t){for(let n of Rn.values())try{v.globalShortcut.unregister(n)}catch{}Rn.clear(),vt=[];let e=Ue;Ue=[];for(let n of e)n(null)}function ss(t,e=3e4){let n=vt.shift();return n?Promise.resolve(n):new Promise(r=>{let i=!1,o=s=>{i||(i=!0,clearTimeout(a),r(s))},a=setTimeout(()=>{Ue=Ue.filter(s=>s!==o),o(null)},e);Ue.push(o)})}v.app.on("will-quit",()=>On());function ls(t,e){return Gr(e)}function cs(t){return yn()}function us(t){return Dt()}function ds(t,e=3e4){return zr(e)}function ps(t,e){return hi(e)}function fs(t){return Pn()}function hs(t){return Gt()}function ms(t){return mi()}function gs(t,e,n,r,i){return gi(new Uint8Array(e),n,r,i)}function vs(t){return vi()}function ys(t,e=3e4){return yi(e)}v.app.on("will-quit",()=>{yn()});var ws=["top-left","top-right","bottom-left","bottom-right"];function Ge(t,e,n,r){let i=Number(t);return Number.isFinite(i)?Math.min(n,Math.max(e,Math.round(i))):r}function Ei(t){return ws.includes(t)?t:"bottom-right"}function bs(t){return{corner:Ei(t?.corner),width:Ge(t?.width,200,1280,420),volume:Ge(t?.volume,0,100,0),seconds:Ge(t?.seconds,0,300,10)}}function Mn(t,e){return String(t??"").replace(/\s+/g," ").trim().slice(0,e)}function Ss(t,e,n,r){let i=$e(n);if(!i)return!1;let o=(0,f.join)(x(e),i);return(0,p.existsSync)(o)?Kr(o,bs(r)):!1}function xs(t,e,n,r){return v.BrowserWindow.getFocusedWindow()||Sn()?!1:Zr(Mn(e,60),Mn(n,90),Ei(r))}function ks(t){ye()}var Es=200;function Ts(t){return Array.isArray(t)?t.map(Number).filter(e=>Number.isFinite(e)&&e>=0).slice(0,Es):[]}function Is(t){return{width:Ge(t?.width,360,1600,720),volume:Ge(t?.volume,0,100,0)}}function Ps(t,e,n,r,i){let o=$e(n);if(!o)return!1;let a=(0,f.join)(x(e),o);return(0,p.existsSync)(a)?ei({name:o,path:a,markers:Ts(r)},Is(i)):!1}function As(t){ut()}function Cs(t){return Sn()}function Rs(t,e=3e4){return Jr(Ge(e,1e3,12e4,3e4))}function Ms(t){Xr()}function _s(t,e,n,r){Qr({ok:!!e,message:Mn(n,120),close:!!r})}function Ds(t){let e=v.BrowserWindow.fromWebContents(t.sender);!e||e.isDestroyed()||(e.isMinimized()&&e.restore(),e.show(),e.focus())}var yt="kebab1337420/vencord-clipper",Os=`VencordClipper (+https://github.com/${yt})`,Ls=["patcher.js","patcher.js.LEGAL.txt","preload.js","renderer.css","renderer.js","renderer.js.LEGAL.txt","vencordDesktopMain.js","vencordDesktopMain.js.LEGAL.txt","vencordDesktopPreload.js","vencordDesktopRenderer.css","vencordDesktopRenderer.js","vencordDesktopRenderer.js.LEGAL.txt"];function zt(t,e=0){return new Promise((n,r)=>{let i=(0,bi.get)(t,{headers:{"User-Agent":Os,Accept:"*/*"}},o=>{let a=o.statusCode??0,{location:s}=o.headers;if(a>=300&&a<400&&s){o.resume(),e>=5?r(new Error(`Too many redirects for ${t}`)):n(zt(new URL(s,t).toString(),e+1));return}let l=[];o.on("data",h=>l.push(h)),o.on("end",()=>n({status:a,body:Buffer.concat(l)})),o.on("error",r)});i.setTimeout(6e4,()=>i.destroy(new Error(`${t} timed out`))),i.on("error",r)})}async function Vs(t){let{status:e,body:n}=await zt(t);if(e!==200)throw new Error(`${t} answered ${e}`);return n}function Ti(){return __dirname}function Ii(t){return(0,p.existsSync)((0,f.join)(t,"patcher.js"))&&(0,p.existsSync)((0,f.join)(t,"renderer.js"))}function Pi(t){try{return(0,p.accessSync)(t,p.constants.W_OK),!0}catch{return!1}}function Fs(t,e){let n=o=>o.replace(/^v/i,"").split(/[.\-+]/).map(a=>Number(a)||0),r=n(t),i=n(e);for(let o=0;o<3;o++)if((r[o]??0)!==(i[o]??0))return(r[o]??0)>(i[o]??0);return!1}async function Ns(t,e){let n=await Vs(`https://api.github.com/repos/${yt}/releases/latest`),r=JSON.parse(n.toString("utf8")),i=String(r.tag_name??""),o=i.replace(/^v/i,""),a=Ti();return{version:o,tag:i,available:!!o&&Fs(o,e),notes:String(r.body??"").trim().slice(0,1200),url:String(r.html_url??`https://github.com/${yt}/releases`),directory:a,writable:Ii(a)&&Pi(a)}}async function Us(t){let{status:e,body:n}=await zt(`https://raw.githubusercontent.com/${yt}/${t}/prebuilt/build-info.json`);if(e===404)return null;if(e!==200)throw new Error(`The release's file list answered ${e}, so there is nothing to check the bundle against`);let r;try{({files:r}=JSON.parse(n.toString("utf8")))}catch{throw new Error("The release's file list could not be read, so there is nothing to check the bundle against")}if(!r||typeof r!="object")throw new Error("The release's file list names no files");return r}async function Gs(t,e){if(!/^[\w.-]{1,40}$/.test(e))throw new Error(`Refusing to fetch a release named ${e}`);let n=Ti();if(!Ii(n))throw new Error(`No installed bundle at ${n}`);if(!Pi(n))throw new Error(`${n} is read-only`);let r=await Us(e),i=r?Object.keys(r):Ls,o=(0,f.join)(n,".clipper-update");(0,p.rmSync)(o,{recursive:!0,force:!0}),(0,p.mkdirSync)(o,{recursive:!0});try{let a=[];for(let d of i){if(d!==(0,f.basename)(d)||d.startsWith("."))throw new Error(`Refusing a release file named ${d}`);let{status:u,body:y}=await zt(`https://raw.githubusercontent.com/${yt}/${e}/prebuilt/dist/${d}`);if(u===404&&!r)continue;if(u!==200)throw new Error(`${d} answered ${u}`);if(y.length===0)throw new Error(`${d} came back empty`);let T=r?.[d];if(T?.size!==void 0&&y.length!==T.size)throw new Error(`${d} is ${y.length} bytes, the release says ${T.size}`);if(T?.sha256&&(0,wi.createHash)("sha256").update(y).digest("hex").toLowerCase()!==T.sha256.toLowerCase())throw new Error(`${d} does not match its hash`);(0,p.writeFileSync)((0,f.join)(o,d),y),a.push(d)}if(a.length===0)throw new Error(`There is no bundle published under ${e}`);for(let d of["renderer.js","patcher.js"])if(!a.includes(d))throw new Error(`The release carries no ${d}`);if(!(0,p.readFileSync)((0,f.join)(o,"renderer.js")).includes("Clipper"))throw new Error("There is no Clipper in that release's renderer");let s=(0,f.join)(o,".previous");(0,p.mkdirSync)(s,{recursive:!0});let l=[],h=[];try{for(let d of a){let u=(0,f.join)(n,d);(0,p.existsSync)(u)&&((0,p.renameSync)(u,(0,f.join)(s,d)),l.push(d)),(0,p.renameSync)((0,f.join)(o,d),u),h.push(d)}}catch(d){for(let u of h)try{(0,p.unlinkSync)((0,f.join)(n,u))}catch{}for(let u of l)try{(0,p.renameSync)((0,f.join)(s,u),(0,f.join)(n,u))}catch{}throw new Error(`The update could not be put in place (${d.message}). The bundle that was there has been put back.`)}return a}finally{(0,p.rmSync)(o,{recursive:!0,force:!0})}}function $s(t){v.app.relaunch(),v.app.quit(),setTimeout(()=>v.app.exit(0),3e3)}var Ai={AppleMusicRichPresence:on,ConsoleShortcuts:an,FixSpotifyEmbeds:Er,FixYoutubeEmbeds:Ir,OpenInApp:pn,Translate:fn,VoiceMessages:hn,XSOverlay:mn,YoutubeAdblock:_r,Clipper:Ln};var Ci={};for(let[t,e]of Object.entries(Ai)){let n=Object.entries(e);if(!n.length)continue;let r=Ci[t]={};for(let[i,o]of n){let a=`VencordPluginNative_${t}_${i}`;Vn.ipcMain.handle(a,o),r[i]=a}}Vn.ipcMain.on("VencordGetPluginIpcMethodMap",t=>{t.returnValue=Ci});c();function Fn(t,e=300){let n;return function(...r){clearTimeout(n),n=setTimeout(()=>{t(...r)},e)}}Ae();var b=require("electron");c();var Ri="PCFkb2N0eXBlIGh0bWw+PGh0bWwgbGFuZz0iZW4iPjxoZWFkPjxtZXRhIGNoYXJzZXQ9InV0Zi04Ij48dGl0bGU+VmVuY29yZCBRdWlja0NTUyBFZGl0b3I8L3RpdGxlPjxsaW5rIHJlbD0ic3R5bGVzaGVldCIgaHJlZj0iaHR0cHM6Ly9jZG4uanNkZWxpdnIubmV0L25wbS9tb25hY28tZWRpdG9yQDAuNTAuMC9taW4vdnMvZWRpdG9yL2VkaXRvci5tYWluLmNzcyIgaW50ZWdyaXR5PSJzaGEyNTYtdGlKUFEyTzA0ei9wWi9Bd2R5SWdock9NemV3ZitQSXZFbDFZS2JRdnNaaz0iIGNyb3Nzb3JpZ2luPSJhbm9ueW1vdXMiIHJlZmVycmVycG9saWN5PSJuby1yZWZlcnJlciI+PHN0eWxlPiNjb250YWluZXIsYm9keSxodG1se3Bvc2l0aW9uOmFic29sdXRlO2xlZnQ6MDt0b3A6MDt3aWR0aDoxMDAlO2hlaWdodDoxMDAlO21hcmdpbjowO3BhZGRpbmc6MDtvdmVyZmxvdzpoaWRkZW59PC9zdHlsZT48L2hlYWQ+PGJvZHk+PGRpdiBpZD0iY29udGFpbmVyIj48L2Rpdj48c2NyaXB0IHNyYz0iaHR0cHM6Ly9jZG4uanNkZWxpdnIubmV0L25wbS9tb25hY28tZWRpdG9yQDAuNTAuMC9taW4vdnMvbG9hZGVyLmpzIiBpbnRlZ3JpdHk9InNoYTI1Ni1LY1U0OFRHcjg0cjd1bkY3SjVJZ0JvOTVhZVZyRWJyR2UwNFM3VGNGVWpzPSIgY3Jvc3NvcmlnaW49ImFub255bW91cyIgcmVmZXJyZXJwb2xpY3k9Im5vLXJlZmVycmVyIj48L3NjcmlwdD48c2NyaXB0PnJlcXVpcmUuY29uZmlnKHtwYXRoczp7dnM6Imh0dHBzOi8vY2RuLmpzZGVsaXZyLm5ldC9ucG0vbW9uYWNvLWVkaXRvckAwLjUwLjAvbWluL3ZzIn19KSxyZXF1aXJlKFsidnMvZWRpdG9yL2VkaXRvci5tYWluIl0sKCgpPT57Z2V0Q3VycmVudENzcygpLnRoZW4oKGU9Pnt2YXIgdD1tb25hY28uZWRpdG9yLmNyZWF0ZShkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiY29udGFpbmVyIikse3ZhbHVlOmUsbGFuZ3VhZ2U6ImNzcyIsdGhlbWU6Z2V0VGhlbWUoKX0pO3Qub25EaWRDaGFuZ2VNb2RlbENvbnRlbnQoKCgpPT5zZXRDc3ModC5nZXRWYWx1ZSgpKSkpLHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCJyZXNpemUiLCgoKT0+e3QubGF5b3V0KCl9KSl9KSl9KSk8L3NjcmlwdD48L2JvZHk+PC9odG1sPg==";var Se=require("fs"),ce=require("fs/promises"),Gi=require("os"),Wn=require("path");c();Ae();var We=require("electron");c();var Nn=require("electron"),W=["connect-src"],N=[...W,"img-src"],Di=["style-src","font-src"],Mi=[...N,"media-src"],k=[...N,...Di],_i=[...k,"script-src","worker-src"],Gn={"http://localhost:*":k,"http://127.0.0.1:*":k,"localhost:*":k,"127.0.0.1:*":k,"*.github.io":k,"github.com":k,"raw.githubusercontent.com":k,"*.gitlab.io":k,"gitlab.com":k,"*.codeberg.page":k,"codeberg.org":k,"*.githack.com":k,"jsdelivr.net":k,"fonts.googleapis.com":Di,"i.imgur.com":N,"i.ibb.co":N,"i.pinimg.com":N,"files.catbox.moe":k,"cdn.discordapp.com":k,"media.discordapp.net":N,"cdnjs.cloudflare.com":_i,"cdn.jsdelivr.net":_i,"api.github.com":W,"ws.audioscrobbler.com":W,"musicbrainz.org":W,"*.listenbrainz.org":W,"coverartarchive.org":W,"archive.org":W,"*.archive.org":W,"translate-pa.googleapis.com":W,"*.vencord.dev":N,"manti.vendicated.dev":N,"decor.fieryflames.dev":W,"ugc.decor.fieryflames.dev":N,"sponsor.ajay.app":W,"dearrow-thumb.ajay.app":N,"usrbg.is-hardly.online":N,"icons.duckduckgo.com":N,"*.tenor.com":Mi,"*.tenor.co":Mi},Un=(t,e)=>Object.keys(t).find(n=>n.toLowerCase()===e),zs=t=>{let e={};return t.split(";").forEach(n=>{let[r,...i]=n.trim().split(/\s+/g);r&&!Object.prototype.hasOwnProperty.call(e,r)&&(e[r]=i)}),e},Ws=t=>Object.entries(t).filter(([,e])=>e?.length).map(e=>e.flat().join(" ")).join("; "),js=t=>{let e=Un(t,"content-security-policy-report-only");e&&delete t[e];let n=Un(t,"content-security-policy");if(n){let r=zs(t[n][0]),i=(o,...a)=>{r[o]??=[...r["default-src"]??[]],r[o].push(...a)};i("style-src","'unsafe-inline'"),i("script-src","'unsafe-inline'","'unsafe-eval'");for(let o of["style-src","connect-src","img-src","font-src","media-src","worker-src"])i(o,"blob:","data:","vencord:","vesktop:");for(let[o,a]of Object.entries(j.store.customCspRules))for(let s of a)i(s,o);for(let[o,a]of Object.entries(Gn))for(let s of a)i(s,o);t[n]=[Ws(r)]}};function Oi(){Nn.session.defaultSession.webRequest.onHeadersReceived(({responseHeaders:t,resourceType:e},n)=>{if(t&&(e==="mainFrame"&&js(t),e==="stylesheet")){let r=Un(t,"content-type");r&&(t[r]=["text/css"])}n({cancel:!1,responseHeaders:t})}),Nn.session.defaultSession.webRequest.onHeadersReceived=()=>{}}function Li(){We.ipcMain.handle("VencordCspRemoveOverride",Zs),We.ipcMain.handle("VencordCspRequestAddOverride",Ks),We.ipcMain.handle("VencordCspIsDomainAllowed",qs)}function Bs(t,e){try{let{host:n}=new URL(t);if(/[;'"\\]/.test(n))return!1}catch{return!1}return!(e.length===0||e.some(n=>!k.includes(n)))}function Hs(t,e,n){let r=new URL(t).host,i=`${n} wants to allow connections to ${r}`,o=`Unless you recognise and fully trust ${r}, you should cancel this request!

You will have to fully close and restart Vesktop for the changes to take effect.`;if(e.length===1&&e[0]==="connect-src")return{message:i,detail:o};let a=e.filter(s=>s!=="connect-src").map(s=>{switch(s){case"img-src":return"Images";case"style-src":return"CSS & Themes";case"font-src":return"Fonts";default:throw new Error(`Illegal CSP directive: ${s}`)}}).sort().join(", ");return o=`The following types of content will be allowed to load from ${r}:
${a}

${o}`,{message:i,detail:o}}async function Ks(t,e,n,r){if(!Bs(e,n))return"invalid";let i=new URL(e).host;if(i in j.store.customCspRules)return"conflict";let{checkboxChecked:o,response:a}=await We.dialog.showMessageBox({...Hs(e,n,r),type:r?"info":"warning",title:"Vencord Host Permissions",buttons:["Cancel","Allow"],defaultId:0,cancelId:0,checkboxLabel:`I fully trust ${i} and understand the risks of allowing connections to it.`,checkboxChecked:!1});return a!==1?"cancelled":o?(j.store.customCspRules[i]=n,"ok"):"unchecked"}function Zs(t,e){return e in j.store.customCspRules?(delete j.store.customCspRules[e],!0):!1}function qs(t,e,n){try{let r=new URL(e).host,i=Gn[r]??j.store.customCspRules[r];return i?n.every(o=>i.includes(o)):!1}catch{return!1}}c();var Ys=/[^\S\r\n]*?\r?(?:\r\n|\n)[^\S\r\n]*?\*[^\S\r\n]?/,Js=/^\\@/;function $n(t,e={}){return{fileName:t,name:e.name??t.replace(/\.css$/i,""),author:e.author??"Unknown Author",description:e.description??"A Discord Theme.",version:e.version,license:e.license,source:e.source,website:e.website,invite:e.invite}}function Vi(t){return t.charCodeAt(0)===65279&&(t=t.slice(1)),t}function Fi(t,e){if(!t)return $n(e);let n=t.split("/**",2)?.[1]?.split("*/",1)?.[0];if(!n)return $n(e);let r={},i="",o="";for(let a of n.split(Ys))if(a.length!==0)if(a.charAt(0)==="@"&&a.charAt(1)!==" "){r[i]=o.trim();let s=a.indexOf(" ");i=a.substring(1,s),o=a.substring(s+1)}else o+=" "+a.replace("\\n",`
`).replace(Js,"@");return r[i]=o.trim(),delete r[""],$n(e,r)}c();var je=require("path");function le(t,e){let n=(0,je.normalize)(t+"/"),r=(0,je.join)(t,e),i=(0,je.normalize)(r);return i===(0,je.normalize)(t)||i.startsWith(n)?i:null}c();var Ni=require("electron");function Ui(t){t.webContents.setWindowOpenHandler(({url:e})=>{switch(e){case"about:blank":case"https://discord.com/popout":case"https://ptb.discord.com/popout":case"https://canary.discord.com/popout":return{action:"allow"}}try{var{protocol:n}=new URL(e)}catch{return{action:"deny"}}switch(n){case"http:":case"https:":case"mailto:":case"steam:":case"spotify:":Ni.shell.openExternal(e)}return{action:"deny"}})}var Xs=(0,Wn.join)(__dirname,"vencordDesktopRenderer.css");(0,Se.mkdirSync)(ne,{recursive:!0});Li();function $i(){return(0,ce.readFile)(Re,"utf-8").catch(()=>"")}async function Qs(){let t=await(0,ce.readdir)(ne).catch(()=>[]),e=[];for(let n of t){if(!n.endsWith(".css"))continue;let r=await zi(n).then(Vi).catch(()=>null);r!=null&&e.push(Fi(r,n))}return e}function zi(t){t=t.replace(/\?v=\d+$/,"");let e=le(ne,t);return e?(0,ce.readFile)(e,"utf-8"):Promise.reject(`Unsafe path ${t}`)}b.ipcMain.handle("VencordOpenQuickCss",()=>b.shell.openPath(Re));b.ipcMain.handle("VencordOpenExternal",(t,e)=>{try{var{protocol:n}=new URL(e)}catch{throw"Malformed URL"}if(!br.includes(n))throw"Disallowed protocol.";b.shell.openExternal(e).catch(r=>console.error("[Vencord] Failed to open external link",e,r))});b.ipcMain.handle("VencordGetQuickCss",()=>$i());b.ipcMain.handle("VencordSetQuickCss",(t,e)=>(0,Se.writeFileSync)(Re,e));b.ipcMain.handle("VencordGetThemesList",()=>Qs());b.ipcMain.handle("VencordGetThemeData",(t,e)=>zi(e));b.ipcMain.handle("VencordGetThemeSystemValues",()=>{let t=b.systemPreferences.getAccentColor?.()??"";return t.length&&t[0]!=="#"&&(t=`#${t}`),{"os-accent-color":t}});b.ipcMain.handle("VencordOpenThemesFolder",()=>b.shell.openPath(ne));b.ipcMain.handle("VencordOpenSettingsFolder",()=>b.shell.openPath(fe));var zn=[];b.ipcMain.handle("VencordInitFileWatchers",({sender:t})=>{zn.forEach(i=>i.close());let e,n;(0,ce.open)(Re,"a+").then(i=>{i.close(),e=(0,Se.watch)(Re,{persistent:!1},Fn(async()=>{t.postMessage("VencordQuickCssUpdate",await $i())},50))}).catch(()=>{});let r=(0,Se.watch)(ne,{persistent:!1},Fn(()=>{t.postMessage("VencordThemeUpdate",void 0)}));zn=[e,r,n].filter(Boolean),t.once("destroyed",()=>{e?.close(),r.close(),n?.close(),zn=[]})});b.ipcMain.on("VencordGetMonacoTheme",t=>{t.returnValue=b.nativeTheme.shouldUseDarkColors?"vs-dark":"vs-light"});b.ipcMain.handle("VencordOpenMonacoEditor",async()=>{let t="Vencord QuickCSS Editor",e=b.BrowserWindow.getAllWindows().find(r=>r.title===t);if(e&&!e.isDestroyed()){e.focus();return}let n=new b.BrowserWindow({title:t,autoHideMenuBar:!0,darkTheme:!0,backgroundColor:b.nativeTheme.shouldUseDarkColors?"#1e1e1e":"white",webPreferences:{preload:(0,Wn.join)(__dirname,"vencordDesktopPreload.js"),contextIsolation:!0,nodeIntegration:!1,sandbox:!1}});Ui(n),await n.loadURL(`data:text/html;base64,${Ri}`)});b.ipcMain.handle("VencordGetRendererCss",()=>(0,ce.readFile)(Xs,"utf-8"));b.ipcMain.on("VencordSupportsWindowsMaterial",t=>{t.returnValue=Number((0,Gi.release)().split(".")[2])>=22621});var ke=require("electron"),uo=require("path"),Xn=require("url");c();var qt=require("electron");c();var Bi=require("module"),el=(0,Bi.createRequire)("/"),Be,jt,Bn,tl=";var __w=require('worker_threads');__w.parentPort.on('message',function(m){onmessage({data:m})}),postMessage=function(m,t){__w.parentPort.postMessage(m,t)},close=process.exit;self=global";try{Be=el("worker_threads"),jt=Be.Worker,Bn=Be.isMarkedAsUntransferable}catch{}var nl=jt?function(t,e,n,r,i){var o=!1,a=new jt(t+tl,{eval:!0}).on("error",function(s){return i(s,null)}).on("message",function(s){return i(null,s)}).on("exit",function(s){s&&!o&&i(new Error("exited with code "+s),null)});return Bn&&(r=r.filter(function(s){return!Bn(s)})),a.postMessage(n,r),a.terminate=function(){return o=!0,jt.prototype.terminate.call(a)},a}:function(t,e,n,r,i){setImmediate(function(){return i(new Error("async operations unsupported - update to Node 12+ (or Node 10-11 with the --experimental-worker CLI flag)"),null)});var o=function(){};return{terminate:o,postMessage:o}},A=Uint8Array,xe=Uint16Array,Hi=Int32Array,Kn=new A([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0,0,0,0]),Zn=new A([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13,0,0]),Ki=new A([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]),Zi=function(t,e){for(var n=new xe(31),r=0;r<31;++r)n[r]=e+=1<<t[r-1];for(var i=new Hi(n[30]),r=1;r<30;++r)for(var o=n[r];o<n[r+1];++o)i[o]=o-n[r]<<5|r;return{b:n,r:i}},Be=Zi(Kn,2),qn=Be.b,rl=Be.r;qn[28]=258,rl[258]=28;var qi=Zi(Zn,0),Yi=qi.b,ku=qi.r,Kt=new xe(32768);for(w=0;w<32768;++w)X=(w&43690)>>1|(w&21845)<<1,X=(X&52428)>>2|(X&13107)<<2,X=(X&61680)>>4|(X&3855)<<4,Kt[w]=((X&65280)>>8|(X&255)<<8)>>1;var X,w,He=(function(t,e,n){for(var r=t.length,i=0,o=new xe(e);i<r;++i)t[i]&&++o[t[i]-1];var a=new xe(e);for(i=1;i<e;++i)a[i]=a[i-1]+o[i-1]<<1;var s;if(n){s=new xe(1<<e);var l=15-e;for(i=0;i<r;++i)if(t[i])for(var h=i<<4|t[i],d=e-t[i],u=a[t[i]-1]++<<d,y=u|(1<<d)-1;u<=y;++u)s[Kt[u]>>l]=h}else for(s=new xe(r),i=0;i<r;++i)t[i]&&(s[i]=Kt[a[t[i]-1]++]>>15-t[i]);return s}),wt=new A(288);for(w=0;w<144;++w)wt[w]=8;var w;for(w=144;w<256;++w)wt[w]=9;var w;for(w=256;w<280;++w)wt[w]=7;var w;for(w=280;w<288;++w)wt[w]=8;var w,Ji=new A(32);for(w=0;w<32;++w)Ji[w]=5;var w;var Xi=He(wt,9,1);var Qi=He(Ji,5,1),Bt=function(t){for(var e=t[0],n=1;n<t.length;++n)t[n]>e&&(e=t[n]);return e},U=function(t,e,n){var r=e/8|0;return(t[r]|t[r+1]<<8)>>(e&7)&n},Ht=function(t,e){var n=e/8|0;return(t[n]|t[n+1]<<8|t[n+2]<<16)>>(e&7)},eo=function(t){return(t+7)/8|0},Zt=function(t,e,n){return(e==null||e<0)&&(e=0),(n==null||n>t.length)&&(n=t.length),new A(t.subarray(e,n))};var to=["unexpected EOF","invalid block type","invalid length/literal","invalid distance","stream finished","no stream handler",,"no callback","invalid UTF-8 data","extra field too long","date not in range 1980-2099","filename too long","stream finishing","invalid zip data"],I=function(t,e,n){var r=new Error(e||to[t]);if(r.code=t,Error.captureStackTrace&&Error.captureStackTrace(r,I),!n)throw r;return r},no=function(t,e,n,r){var i=t.length,o=r?r.length:0;if(!i||e.f&&!e.l)return n||new A(0);var a=!n,s=a||e.i!=2,l=e.i;a&&(n=new A(i*3));var h=function(ir){var or=n.length;if(ir>or){var ar=new A(Math.max(or*2,ir));ar.set(n),n=ar}},d=e.f||0,u=e.p||0,y=e.b||0,T=e.l,ue=e.d,q=e.m,D=e.n,O=i*8;do{if(!T){d=U(t,u,1);var Q=U(t,u+1,3);if(u+=3,Q)if(Q==1)T=Xi,ue=Qi,q=9,D=5;else if(Q==2){var Ke=U(t,u,31)+257,bt=U(t,u+10,15)+4,de=Ke+U(t,u+5,31)+1;u+=14;for(var L=new A(de),Te=new A(19),E=0;E<bt;++E)Te[Ki[E]]=U(t,u+E*3,7);u+=bt*3;for(var Ze=Bt(Te),po=(1<<Ze)-1,fo=He(Te,Ze,1),E=0;E<de;){var Qn=fo[U(t,u,po)];u+=Qn&15;var P=Qn>>4;if(P<16)L[E++]=P;else{var Ie=0,St=0;for(P==16?(St=3+U(t,u,3),u+=2,Ie=L[E-1]):P==17?(St=3+U(t,u,7),u+=3):P==18&&(St=11+U(t,u,127),u+=7);St--;)L[E++]=Ie}}var er=L.subarray(0,Ke),ee=L.subarray(Ke);q=Bt(er),D=Bt(ee),T=He(er,q,1),ue=He(ee,D,1)}else I(1);else{var P=eo(u)+4,Y=t[P-4]|t[P-3]<<8,Ee=P+Y;if(Ee>i){l&&I(0);break}s&&h(y+Y),n.set(t.subarray(P,Ee),y),e.b=y+=Y,e.p=u=Ee*8,e.f=d;continue}if(u>O){l&&I(0);break}}s&&h(y+131072);for(var ho=(1<<q)-1,mo=(1<<D)-1,Yt=u;;Yt=u){var Ie=T[Ht(t,u)&ho],Pe=Ie>>4;if(u+=Ie&15,u>O){l&&I(0);break}if(Ie||I(2),Pe<256)n[y++]=Pe;else if(Pe==256){Yt=u,T=null;break}else{var tr=Pe-254;if(Pe>264){var E=Pe-257,qe=Kn[E];tr=U(t,u,(1<<qe)-1)+qn[E],u+=qe}var Jt=ue[Ht(t,u)&mo],Xt=Jt>>4;Jt||I(3),u+=Jt&15;var ee=Yi[Xt];if(Xt>3){var qe=Zn[Xt];ee+=Ht(t,u)&(1<<qe)-1,u+=qe}if(u>O){l&&I(0);break}s&&h(y+131072);var nr=y+tr;if(y<ee){var rr=o-ee,go=Math.min(ee,nr);for(rr+y<0&&I(3);y<go;++y)n[y]=r[rr+y]}for(;y<nr;++y)n[y]=n[y-ee]}}e.l=T,e.p=Yt,e.b=y,e.f=d,T&&(d=1,e.m=q,e.d=ue,e.n=D)}while(!d);return y!=n.length&&a?Zt(n,0,y):n.subarray(0,y)};var il=new A(0);var ol=function(t,e){var n={};for(var r in t)n[r]=t[r];for(var r in e)n[r]=e[r];return n},Wi=function(t,e,n){for(var r=t(),i=t.toString(),o=i.slice(i.indexOf("[")+1,i.lastIndexOf("]")).replace(/\s+/g,"").split(","),a=0;a<r.length;++a){var s=r[a],l=o[a];if(typeof s=="function"){e+=";"+l+"=";var h=s.toString();if(s.prototype)if(h.indexOf("[native code]")!=-1){var d=h.indexOf(" ",8)+1;e+=h.slice(d,h.indexOf("(",d))}else{e+=h;for(var u in s.prototype)e+=";"+l+".prototype."+u+"="+s.prototype[u].toString()}else e+=h}else n[l]=s}return e},Wt=[],al=function(t){var e=[];for(var n in t)t[n].buffer&&e.push((t[n]=new t[n].constructor(t[n])).buffer);return e},sl=function(t,e,n,r){if(!Wt[n]){for(var i="",o={},a=t.length-1,s=0;s<a;++s)i=Wi(t[s],i,o);Wt[n]={c:Wi(t[a],i,o),e:o}}var l=ol({},Wt[n].e);return nl(Wt[n].c+";onmessage=function(e){for(var k in e.data)self[k]=e.data[k];onmessage="+e.toString()+"}",n,l,al(l),r)},ll=function(){return[A,xe,Hi,Kn,Zn,Ki,qn,Yi,Xi,Qi,Kt,to,He,Bt,U,Ht,eo,Zt,I,no,Yn,ro,io]};var ro=function(t){return postMessage(t,[t.buffer])},io=function(t){return t&&{out:t.size&&new A(t.size),dictionary:t.dictionary}},cl=function(t,e,n,r,i,o){var a=sl(n,r,i,function(s,l){a.terminate(),o(s,l)});return a.postMessage([t,e],e.consume?[t.buffer]:[]),function(){a.terminate()}};var K=function(t,e){return t[e]|t[e+1]<<8},G=function(t,e){return(t[e]|t[e+1]<<8|t[e+2]<<16|t[e+3]<<24)>>>0},jn=function(t,e){return G(t,e)+G(t,e+4)*4294967296};function ul(t,e,n){return n||(n=e,e={}),typeof n!="function"&&I(7),cl(t,e,[ll],function(r){return ro(Yn(r.data[0],io(r.data[1])))},1,n)}function Yn(t,e){return no(t,{i:2},e&&e.out,e&&e.dictionary)}var Hn=typeof TextDecoder<"u"&&new TextDecoder,dl=0;try{Hn.decode(il,{stream:!0}),dl=1}catch{}var pl=function(t){for(var e="",n=0;;){var r=t[n++],i=(r>127)+(r>223)+(r>239);if(n+i>t.length)return{s:e,r:Zt(t,n-1)};i?i==3?(r=((r&15)<<18|(t[n++]&63)<<12|(t[n++]&63)<<6|t[n++]&63)-65536,e+=String.fromCharCode(55296|r>>10,56320|r&1023)):i&1?e+=String.fromCharCode((r&31)<<6|t[n++]&63):e+=String.fromCharCode((r&15)<<12|(t[n++]&63)<<6|t[n++]&63):e+=String.fromCharCode(r)}};function fl(t,e){if(e){for(var n="",r=0;r<t.length;r+=16384)n+=String.fromCharCode.apply(null,t.subarray(r,r+16384));return n}else{if(Hn)return Hn.decode(t);var i=pl(t),o=i.s,n=i.r;return n.length&&I(8),o}}var hl=function(t,e){return e+30+K(t,e+26)+K(t,e+28)},ml=function(t,e,n){var r=K(t,e+28),i=K(t,e+30),o=fl(t.subarray(e+46,e+46+r),!(K(t,e+8)&2048)),a=e+46+r,s=gl(t,a,i,n,G(t,e+20),G(t,e+24),G(t,e+42)),l=s[0],h=s[1],d=s[2];return[K(t,e+10),l,h,o,a+i+K(t,e+32),d]},gl=function(t,e,n,r,i,o,a){var s=i==4294967295,l=o==4294967295,h=a==4294967295,d=e+n,u=s+l+h;if(r&&u){for(;e+4<d;e+=4+K(t,e+2))if(K(t,e)==1)return[s?jn(t,e+4+8*l):i,l?jn(t,e+4):o,h?jn(t,e+4+8*(l+s)):a,1];r<2&&I(13)}return[i,o,a,0]};var ji=typeof queueMicrotask=="function"?queueMicrotask:typeof setTimeout=="function"?setTimeout:function(t){t()};function oo(t,e,n){n||(n=e,e={}),typeof n!="function"&&I(7);var r=[],i=function(){for(var D=0;D<r.length;++D)r[D]()},o={},a=function(D,O){ji(function(){n(D,O)})};ji(function(){a=n});for(var s=t.length-22;G(t,s)!=101010256;--s)if(!s||t.length-s>65558)return a(I(13,0,1),null),i;var l=K(t,s+8);if(l){var h=l,d=G(t,s+16),u=G(t,s-20)==117853008;if(u){var y=G(t,s-12);u=G(t,y)==101075792,u&&(h=l=G(t,y+32),d=G(t,y+48))}for(var T=e&&e.filter,ue=function(D){var O=ml(t,d,u),Q=O[0],P=O[1],Y=O[2],Ee=O[3],Ke=O[4],bt=O[5],de=hl(t,bt);d=Ke;var L=function(E,Ze){E?(i(),a(E,null)):(Ze&&(o[Ee]=Ze),--l||a(null,o))};if(!T||T({name:Ee,size:P,originalSize:Y,compression:Q}))if(!Q)L(null,Zt(t,de,de+P));else if(Q==8){var Te=t.subarray(de,de+P);if(Y<524288||P>.8*Y)try{L(null,Yn(Te,{out:new A(Y)}))}catch(E){L(E,null)}else r.push(ul(Te,{size:Y},L))}else L(I(14,"unknown compression type "+Q,1),null);else L(null,null)},q=0;q<h;++q)ue(q)}else a(null,{});return i}var lo=require("fs"),Z=require("fs/promises"),Jn=require("path");c();function ao(t){function e(a,s,l,h){let d=0;return d+=a<<0,d+=s<<8,d+=l<<16,d+=h<<24>>>0,d}if(t[0]===80&&t[1]===75&&t[2]===3&&t[3]===4)return t;if(t[0]!==67||t[1]!==114||t[2]!==50||t[3]!==52)throw new Error("Invalid header: Does not start with Cr24");let n=t[4]===3,r=t[4]===2;if(!r&&!n||t[5]||t[6]||t[7])throw new Error("Unexpected crx format version number.");if(r){let a=e(t[8],t[9],t[10],t[11]),s=e(t[12],t[13],t[14],t[15]),l=16+a+s;return t.subarray(l,t.length)}let o=12+e(t[8],t[9],t[10],t[11]);return t.subarray(o,t.length)}c();var vl=require("original-fs");async function yl(t,e){try{var n=await fetch(t,e)}catch(i){throw i instanceof Error&&i.cause&&(i=i.cause),new Error(`${e?.method??"GET"} ${t} failed: ${i}`)}if(n.ok)return n;let r=`${e?.method??"GET"} ${t}: ${n.status} ${n.statusText}`;try{let i=await n.text();r+=`
${i}`}catch{}throw new Error(r)}async function so(t,e){let r=await(await yl(t,e)).arrayBuffer();return Buffer.from(r)}var wl=(0,Jn.join)(Et,"ExtensionCache");async function bl(t,e){return await(0,Z.mkdir)(e,{recursive:!0}),new Promise((n,r)=>{oo(t,(i,o)=>{if(i)return void r(i);Promise.all(Object.keys(o).map(async a=>{if(a.startsWith("_metadata/"))return;if(a.includes("\0"))throw new Error(`Invalid filename: "${a}"`);if(a.endsWith("/")){let u=le(e,a);if(!u)throw new Error(`Path traversal detected: "${a}"`);return void await(0,Z.mkdir)(u,{recursive:!0})}let l=a.split("/").slice(0,-1).join("/"),h=le(e,l);if(!h)throw new Error(`Path traversal detected: "${a}"`);let d=le(e,a);if(!d)throw new Error(`Path traversal detected: "${a}"`);l&&await(0,Z.mkdir)(h,{recursive:!0}),await(0,Z.writeFile)(d,o[a])})).then(()=>n()).catch(a=>{(0,Z.rm)(e,{recursive:!0,force:!0}),r(a)})})})}async function co(t){let e=(0,Jn.join)(wl,t);try{await(0,Z.access)(e,lo.constants.F_OK)}catch{let r=`https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3&x=id%3D${t}%26uc&prodversion=${process.versions.chrome}`,i=await so(r,{headers:{"User-Agent":`Electron ${process.versions.electron} ~ Vencord (https://github.com/Vendicated/Vencord)`}});await bl(ao(i),e).catch(o=>console.error(`Failed to extract extension ${t}`,o))}qt.session.defaultSession.extensions?qt.session.defaultSession.extensions.loadExtension(e):qt.session.defaultSession.loadExtension(e)}ke.app.whenReady().then(()=>{ke.protocol.handle("vencord",({url:t})=>{let e=decodeURI(t).slice(10).replace(/\?v=\d+$/,"");if(e.endsWith("/")&&(e=e.slice(0,-1)),e.startsWith("/themes/")){let n=e.slice(8),r=le(ne,n);return r?ke.net.fetch((0,Xn.pathToFileURL)(r).toString()):new Response(null,{status:404})}switch(e){case"renderer.js.map":case"vencordDesktopRenderer.js.map":case"preload.js.map":case"vencordDesktopPreload.js.map":case"patcher.js.map":case"vencordDesktopMain.js.map":return ke.net.fetch((0,Xn.pathToFileURL)((0,uo.join)(__dirname,e)).toString());default:return new Response(null,{status:404})}});try{C.store.enableReactDevtools&&co("fmkadmapgofadopljbjfkapdkoienihi").then(()=>console.info("[Vencord] Installed React Developer Tools")).catch(t=>console.error("[Vencord] Failed to install React Developer Tools",t))}catch{}Oi()});
//# sourceURL=file:///VencordDesktopMain
//# sourceMappingURL=vencord://vencordDesktopMain.js.map
/*! For license information please see vencordDesktopMain.js.LEGAL.txt */
