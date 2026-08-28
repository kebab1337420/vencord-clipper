// Vencord ef29bbe
// Standalone: false
// Platform: win32
// Updater Disabled: false
"use strict";var mi=Object.create;var et=Object.defineProperty;var vi=Object.getOwnPropertyDescriptor;var gi=Object.getOwnPropertyNames;var yi=Object.getPrototypeOf,wi=Object.prototype.hasOwnProperty;var U=(t,e,r)=>()=>{if(r)throw r[0];try{return t&&(e=t(t=0)),e}catch(n){throw r=[n],n}};var le=(t,e)=>{for(var r in e)et(t,r,{get:e[r],enumerable:!0})},kr=(t,e,r,n)=>{if(e&&typeof e=="object"||typeof e=="function")for(let i of gi(e))!wi.call(t,i)&&i!==r&&et(t,i,{get:()=>e[i],enumerable:!(n=vi(e,i))||n.enumerable});return t};var Tr=(t,e,r)=>(r=t!=null?mi(yi(t)):{},kr(e||!t||!t.__esModule?et(r,"default",{value:t,enumerable:!0}):r,t)),Tt=t=>kr(et({},"__esModule",{value:!0}),t);var l=U(()=>{"use strict"});var Se=U(()=>{"use strict";l()});function Ve(t){return async function(){try{return{ok:!0,value:await t(...arguments)}}catch(e){return{ok:!1,error:e instanceof Error?{...e,message:e.message,name:e.name,stack:e.stack}:e}}}}var Ar=U(()=>{"use strict";l()});var ki={};function Ee(...t){let e={cwd:Rr};return It?At("flatpak-spawn",["--host","git",...t],e):At("git",t,e)}async function bi(){return(await Ee("remote","get-url","origin")).stdout.trim().replace(/git@(.+):/,"https://$1/").replace(/\.git$/,"")}async function xi(){await Ee("fetch");let t=(await Ee("branch","--show-current")).stdout.trim();if(!((await Ee("ls-remote","origin",t)).stdout.length>0))return[];let n=(await Ee("log",`HEAD...origin/${t}`,"--pretty=format:%an/%h/%s")).stdout.trim();return n?n.split(`
`).map(i=>{let[o,s,...a]=i.split("/");return{hash:s,author:o,message:a.join("/").split(`
`)[0]}}):[]}async function Si(){return(await Ee("pull")).stdout.includes("Fast-forward")}async function Ei(){return!(await At(It?"flatpak-spawn":"node",It?["--host","node","scripts/build/build.mjs"]:["scripts/build/build.mjs"],{cwd:Rr})).stderr.includes("Build failed")}var Ir,$e,Pr,Dr,Rr,At,It,Cr=U(()=>{"use strict";l();Se();Ir=require("child_process"),$e=require("electron"),Pr=require("path"),Dr=require("util");Ar();Rr=(0,Pr.join)(__dirname,".."),At=(0,Dr.promisify)(Ir.execFile),It=!1;$e.ipcMain.handle("VencordGetRepo",Ve(bi));$e.ipcMain.handle("VencordGetUpdates",Ve(xi));$e.ipcMain.handle("VencordUpdate",Ve(Si));$e.ipcMain.handle("VencordBuild",Ve(Ei))});var _t,Ur,ze,Fr=U(()=>{"use strict";l();_t=Symbol("SettingsStore.isProxy"),Ur=Symbol("SettingsStore.getRawTarget"),ze=class{pathListeners=new Map;prefixListeners=new Map;globalListeners=new Set;proxyContexts=new WeakMap;proxyHandler=(()=>{let e=this;return{get(r,n,i){if(n===_t)return!0;if(n===Ur)return r;let o=Reflect.get(r,n,i),s=e.proxyContexts.get(r);if(s==null)return o;let{root:a,path:c}=s;if(!(n in r)&&e.getDefaultValue!=null&&(o=e.getDefaultValue({target:r,key:n,root:a,path:c})),typeof o=="object"&&o!==null&&!o[_t]){let p=`${c}${c&&"."}${n}`;return e.makeProxy(o,a,p)}return o},set(r,n,i){if(i?.[_t]&&(i=i[Ur]),r[n]===i)return!0;if(!Reflect.set(r,n,i))return!1;let o=e.proxyContexts.get(r);if(o==null)return!0;let{root:s,path:a}=o,c=`${a}${a&&"."}${n}`;return e.notifyListeners(c,i,s),!0},deleteProperty(r,n){if(!Reflect.deleteProperty(r,n))return!1;let i=e.proxyContexts.get(r);if(i==null)return!0;let{root:o,path:s}=i,a=`${s}${s&&"."}${n}`;return e.notifyListeners(a,void 0,o),!0}}})();constructor(e,r={}){this.plain=e,this.store=this.makeProxy(e),Object.assign(this,r)}makeProxy(e,r=e,n=""){return this.proxyContexts.set(e,{root:r,path:n}),new Proxy(e,this.proxyHandler)}notifyPrefixListeners(e,r,n){for(let i=1;i<=r.length;i++){let o=r.slice(0,i).join(".");this.prefixListeners.get(o)?.forEach(s=>s(n,e))}}notifyListeners(e,r,n){let i=e.split(".");if(i.length>3&&i[0]==="plugins"){let o=i.slice(0,3),s=o.join("."),a=o.reduce((c,p)=>c[p],n);this.globalListeners.forEach(c=>c(n,s)),this.pathListeners.get(s)?.forEach(c=>c(a))}else this.globalListeners.forEach(o=>o(n,e));this.pathListeners.get(e)?.forEach(o=>o(r)),this.notifyPrefixListeners(e,i,r)}setData(e,r){if(this.readOnly)throw new Error("SettingsStore is read-only");if(this.plain=e,this.store=this.makeProxy(e),r){let n=e,i=r.split(".");for(let o of i){if(!n){console.warn(`Settings#setData: Path ${r} does not exist in new data. Not dispatching update`);return}n=n[o]}this.pathListeners.get(r)?.forEach(o=>o(n)),this.notifyPrefixListeners(r,i,n)}this.markAsChanged()}addGlobalChangeListener(e){this.globalListeners.add(e)}addChangeListener(e,r){let n=this.pathListeners.get(e)??new Set;n.add(r),this.pathListeners.set(e,n)}addPrefixChangeListener(e,r){let n=this.prefixListeners.get(e)??new Set;n.add(r),this.prefixListeners.set(e,n)}removeGlobalChangeListener(e){this.globalListeners.delete(e)}removeChangeListener(e,r){let n=this.pathListeners.get(e);n&&(n.delete(r),n.size||this.pathListeners.delete(e))}removePrefixChangeListener(e,r){let n=this.prefixListeners.get(e);n&&(n.delete(r),n.size||this.prefixListeners.delete(e))}markAsChanged(){this.globalListeners.forEach(e=>e(this.plain,""))}}});function Mt(t,e){for(let r in e){let n=e[r];typeof n=="object"&&!Array.isArray(n)?(t[r]??={},Mt(t[r],n)):t[r]??=n}return t}var Vr=U(()=>{"use strict";l()});var $r,ee,rt,ue,te,ke,Ot,Lt,zr,nt,Te=U(()=>{"use strict";l();$r=require("electron"),ee=require("path"),rt=process.env.VENCORD_USER_DATA_DIR??(process.env.DISCORD_USER_DATA_DIR?(0,ee.join)(process.env.DISCORD_USER_DATA_DIR,"..","VencordData"):(0,ee.join)($r.app.getPath("userData"),"..","Vencord")),ue=(0,ee.join)(rt,"settings"),te=(0,ee.join)(rt,"themes"),ke=(0,ee.join)(ue,"quickCss.css"),Ot=(0,ee.join)(ue,"settings.json"),Lt=(0,ee.join)(ue,"native-settings.json"),zr=["https:","http:","steam:","spotify:","com.epicgames.launcher:","tidal:","itunes:"],nt=process.argv.includes("--vanilla")});function Wr(t,e){try{return JSON.parse((0,fe.readFileSync)(e,"utf-8"))}catch(r){return r?.code!=="ENOENT"&&console.error(`Failed to read ${t} settings`,r),{}}}var Nt,fe,I,Pi,Gr,z,q=U(()=>{"use strict";l();Se();Fr();Vr();Nt=require("electron"),fe=require("fs");Te();(0,fe.mkdirSync)(ue,{recursive:!0});I=new ze(Wr("renderer",Ot));I.addGlobalChangeListener(()=>{try{(0,fe.writeFileSync)(Ot,JSON.stringify(I.plain,null,4))}catch(t){console.error("Failed to write renderer settings",t)}});Nt.ipcMain.on("VencordGetSettings",t=>t.returnValue=I.plain);Nt.ipcMain.handle("VencordSetSettings",(t,e,r)=>{I.setData(e,r)});Pi={plugins:{},customCspRules:{}},Gr=Wr("native",Lt);Mt(Gr,Pi);z=new ze(Gr);z.addGlobalChangeListener(()=>{try{(0,fe.writeFileSync)(Lt,JSON.stringify(z.plain,null,4))}catch(t){console.error("Failed to write native settings",t)}})});function ii(t,e,r){let n=e;if(e in t)return void r(t[n]);Object.defineProperty(t,e,{set(i){delete t[n],t[n]=i,r(i)},configurable:!0,enumerable:!1})}var oi=U(()=>{"use strict";l()});var Os={};function _s(t,e){let r=t.slice(4).split(".").map(Number),n=e.slice(4).split(".").map(Number);for(let i=0;i<n.length;i++){if(r[i]>n[i])return!0;if(r[i]<n[i])return!1}return!1}function Ms(){if(!process.env.DISABLE_UPDATER_AUTO_PATCHING)try{let t=(0,$.dirname)(process.execPath),e=(0,$.basename)(t),r=(0,$.join)(t,".."),n=(0,H.readdirSync)(r).reduce((p,d)=>d.startsWith("app-")&&_s(d,p)?d:p,e);if(n===e)return;let i=(0,$.join)(r,e,"resources"),o=(0,$.join)(i,"app.asar"),s=(0,$.join)(r,n,"resources"),a=(0,$.join)(s,"app.asar"),c=(0,$.join)(s,"_app.asar");if(!(0,H.existsSync)(o)||!(0,H.existsSync)(a)||(0,H.existsSync)(c))return;console.info(`[Vencord] Detected Host Update (${e} -> ${n}). Repatching...`),(0,H.renameSync)(a,c),(0,H.copyFileSync)(o,a)}catch(t){console.error("[Vencord] Failed to repatch latest host update",t)}}var si,H,$,ai=U(()=>{"use strict";l();si=require("electron"),H=require("original-fs"),$=require("path");si.app.on("before-quit",Ms)});var Fs={};var T,se,Ls,Ns,hr,Us,ci=U(()=>{"use strict";l();oi();T=Tr(require("electron")),se=require("path");q();Te();console.log("[Vencord] Starting up...");Ls=require.main.filename,Ns=require.main.path.endsWith("app.asar")?"_app.asar":"app.asar",hr=(0,se.join)((0,se.dirname)(Ls),"..",Ns),Us=require((0,se.join)(hr,"package.json"));require.main.filename=(0,se.join)(hr,Us.main);T.app.setAppPath(hr);if(nt)console.log("[Vencord] Running in vanilla mode. Not loading Vencord");else{let t=I.store;if(ai(),t.winCtrlQ){let i=T.Menu.buildFromTemplate;T.Menu.buildFromTemplate=function(o){if(o[0]?.label==="&File"){let{submenu:s}=o[0];Array.isArray(s)&&s.push({label:"Quit (Hidden)",visible:!1,acceleratorWorksWhenHidden:!0,accelerator:"Control+Q",click:()=>T.app.quit()})}return i.call(this,o)}}class e extends T.default.BrowserWindow{constructor(o){if(!o?.webPreferences?.preload||!o.title){super(o);return}let{frameless:s,winNativeTitleBar:a,disableMinSize:c,transparent:p,macosVibrancyStyle:d,windowsMaterial:u}=t,w=o.webPreferences.preload;o.webPreferences.preload=(0,se.join)(__dirname,"preload.js"),o.webPreferences.sandbox=!1,o.webPreferences.backgroundThrottling=!1,s?o.frame=!1:a&&delete o.frame,c&&(o.minWidth=0,o.minHeight=0),p&&(o.transparent=!0,o.backgroundColor="#00000000"),u&&u!=="none"&&(o.backgroundMaterial=u,o.backgroundColor="#00000000"),process.env.DISCORD_PRELOAD=w,super(o),c&&(this.setMinimumSize=(N,ae)=>{})}}Object.assign(e,T.default.BrowserWindow),Object.defineProperty(e,"name",{value:"BrowserWindow",configurable:!0});let r=require.resolve("electron");delete require.cache[r].exports,require.cache[r].exports={...T.default,BrowserWindow:e},ii(global,"appSettings",i=>{i.set("DANGEROUS_ENABLE_DEVTOOLS_ONLY_ENABLE_IF_YOU_KNOW_WHAT_YOURE_DOING",!0)}),process.env.DATA_DIR=(0,se.join)(T.app.getPath("userData"),"..","Vencord");let n=T.app.commandLine.appendSwitch;T.app.commandLine.appendSwitch=function(...i){if(i[0]==="disable-features"){let o=new Set((i[1]??"").split(","));o.add("UseEcoQoSForBackgroundProcess"),i[1]+=[...o].join(",")}return n.apply(this,i)},T.app.commandLine.appendSwitch("disable-renderer-backgrounding"),T.app.commandLine.appendSwitch("disable-background-timer-throttling"),T.app.commandLine.appendSwitch("disable-backgrounding-occluded-windows")}console.log("[Vencord] Loading original Discord app.asar");require(require.main.filename)});l();l();l();Cr();l();Se();var Qt=require("electron");l();var Rt={};le(Rt,{fetchTrackData:()=>Ai});l();l();l();var _r="ef29bbe";l();var Pt="Vendicated/Vencord";var Mr=`Vencord/${_r}${Pt?` (https://github.com/${Pt})`:""}`;var Or=require("child_process"),Lr=require("util"),Nr=(0,Lr.promisify)(Or.execFile);async function Dt(t){let{stdout:e}=await Nr("osascript",t.map(r=>["-e",r]).flat());return e}var F=null;async function Ti({id:t,name:e,artist:r,album:n}){if(t===F?.id){if("data"in F)return F.data;if("failures"in F&&F.failures>=5)return null}try{let i=new URL("https://itunes.apple.com/search");i.searchParams.set("term",`${e} ${r} ${n}`),i.searchParams.set("media","music"),i.searchParams.set("entity","song");let o=await fetch(i,{headers:{"user-agent":Mr}}).then(a=>a.json()).then(a=>a.results.find(c=>c.collectionName===n)||a.results[0]),s=await fetch(o.artistViewUrl).then(a=>a.text()).then(a=>{let c=a.match(/<meta property="og:image" content="(.+?)">/);return c?c[1].replace(/[0-9]+x.+/,"220x220bb-60.png"):void 0}).catch(()=>{});return F={id:t,data:{appleMusicLink:o.trackViewUrl,appleMusicArtistLink:o.artistViewUrl,songLink:`https://song.link/i/${new URL(o.trackViewUrl).searchParams.get("i")}`,albumArtwork:o.artworkUrl100.replace("100x100","512x512"),artistArtwork:s}},F.data}catch(i){return console.error("[AppleMusicRichPresence] Failed to fetch remote data:",i),F={id:t,failures:(t===F?.id&&"failures"in F?F.failures:0)+1},null}}async function Ai(){try{await Nr("pgrep",["^Music$"])}catch{return null}if(await Dt(['tell application "Music"',"get player state","end tell"]).then(d=>d.trim())!=="playing")return null;let e=await Dt(['tell application "Music"',"get player position","end tell"]).then(d=>Number.parseFloat(d.trim())),r=await Dt(['set output to ""','tell application "Music"',"set t_id to database id of current track","set t_name to name of current track","set t_album to album of current track","set t_artist to artist of current track","set t_duration to duration of current track",'set output to "" & t_id & "\\n" & t_name & "\\n" & t_album & "\\n" & t_artist & "\\n" & t_duration',"end tell","return output"]),[n,i,o,s,a]=r.split(`
`).filter(d=>!!d),c=Number.parseFloat(a),p=await Ti({id:n,name:i,artist:s,album:o});return{name:i,album:o,artist:s,playerPosition:e,duration:c,...p}}var Ct={};le(Ct,{initDevtoolsOpenEagerLoad:()=>Ii});l();function Ii(t){let e=()=>t.sender.executeJavaScript("Vencord.Plugins.plugins.ConsoleShortcuts.eagerLoad(true)");t.sender.isDevToolsOpened()?e():t.sender.once("devtools-opened",()=>e())}var Br={};l();q();var ot=require("electron"),it=[];function jr(){let t=[];for(let e=it.length-1;e>=0;e--){let{processId:r,routingId:n}=it[e],i=ot.webFrameMain.fromId(r,n);if(!i){it.splice(e,1);continue}t.push(i)}return t}ot.app.on("browser-window-created",(t,e)=>{e.webContents.on("frame-created",(r,{frame:n})=>{n?.once("dom-ready",()=>{if(n.url.startsWith("https://open.spotify.com/embed/")){jr();let{routingId:i,processId:o}=n;it.push({routingId:i,processId:o});let s=I.store.plugins?.FixSpotifyEmbeds;if(!s?.enabled)return;n.executeJavaScript(`
                    globalThis._vcVolume = ${s.volume/100};
                    const original = Audio.prototype.play;
                    Audio.prototype.play = function() {
                        this.volume = _vcVolume;
                        return original.apply(this, arguments);
                    }
                `)}})})});I.addChangeListener("plugins.FixSpotifyEmbeds.volume",t=>{try{jr().forEach(e=>e.executeJavaScript(`globalThis._vcVolume = ${t/100}`))}catch(e){console.error("FixSpotifyEmbeds: Failed to update volume",e)}});var Zr={};l();q();var Hr=require("electron");Hr.app.on("browser-window-created",(t,e)=>{e.webContents.on("frame-created",(r,{frame:n})=>{n?.once("dom-ready",()=>{if(n.url.startsWith("https://www.youtube.com/")){if(!I.store.plugins?.FixYoutubeEmbeds?.enabled)return;n.executeJavaScript(`
                new MutationObserver(() => {
                    if(
                        document.querySelector('div.ytp-error-content-wrap-subreason a[href*="www.youtube.com/watch?v="]')
                    ) location.reload()
                }).observe(document.body, { childList: true, subtree:true });
                `)}})})});var Ut={};le(Ut,{resolveRedirect:()=>Ri});l();var Kr=require("https"),Di=/^https:\/\/(spotify\.link|s\.team)\/.+$/;function qr(t){return new Promise((e,r)=>{let n=(0,Kr.request)(new URL(t),{method:"HEAD"},i=>{e(i.headers.location?qr(i.headers.location):t)});n.on("error",r),n.end()})}async function Ri(t,e){return Di.test(e)?qr(e):e}var Ft={};le(Ft,{makeDeeplTranslateRequest:()=>Ci,makeKagiTranslateRequest:()=>_i});l();async function Ci(t,e,r,n){let i=e?"https://api.deepl.com/v2/translate":"https://api-free.deepl.com/v2/translate";try{let o=await fetch(i,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`DeepL-Auth-Key ${r}`},body:n}),s=await o.text();return{status:o.status,data:s}}catch(o){return{status:-1,data:String(o)}}}async function _i(t,e,r,n,i){let o="https://translate.kagi.com/api/translate";try{let s=await fetch(o,{method:"POST",headers:{"Content-Type":"application/json",Cookie:`kagi_session=${e}`},body:JSON.stringify({text:r,from:n,to:i,model:"standard"})}),a=await s.json();return{status:s.status,data:a}}catch(s){return{status:-1,data:String(s)}}}var Vt={};le(Vt,{readRecording:()=>Mi});l();var Yr=require("electron"),st=require("fs/promises"),We=require("path");async function Mi(t,e){e=(0,We.normalize)(e);let r=(0,We.basename)(e),n=(0,We.normalize)(Yr.app.getPath("userData")+"/");if(!/^\d*recording\.ogg$/.test(r)||!e.startsWith(n))return null;try{let i=await(0,st.readFile)(e);return(0,st.rm)(e).catch(()=>{}),new Uint8Array(i.buffer)}catch{return null}}var $t={};le($t,{closeSocket:()=>Li,sendToOverlay:()=>Oi});l();var Jr=require("dgram"),at=null;function Oi(t,e){e.messageType=e.type;let r=JSON.stringify(e);at??=(0,Jr.createSocket)("udp4"),at.send(r,42069,"127.0.0.1")}function Li(){at?.close(),at=null}var Qr={};l();q();var Xr=require("electron");l();var zt=`"use strict";(()=>{if(window.adguardInjected)return;window.adguardInjected=!0;const c=["#__ffYoutube1","#__ffYoutube2","#__ffYoutube3","#__ffYoutube4","#feed-pyv-container","#feedmodule-PRO","#homepage-chrome-side-promo","#merch-shelf","#offer-module",'#pla-shelf > ytd-pla-shelf-renderer[class="style-scope ytd-watch"]',"#pla-shelf","#premium-yva","#promo-info","#promo-list","#promotion-shelf","#related > ytd-watch-next-secondary-results-renderer > #items > ytd-compact-promoted-video-renderer.ytd-watch-next-secondary-results-renderer","#search-pva","#shelf-pyv-container","#video-masthead","#watch-branded-actions","#watch-buy-urls","#watch-channel-brand-div","#watch7-branded-banner","#YtKevlarVisibilityIdentifier","#YtSparklesVisibilityIdentifier",".carousel-offer-url-container",".companion-ad-container",".GoogleActiveViewElement",'.list-view[style="margin: 7px 0pt;"]',".promoted-sparkles-text-search-root-container",".promoted-videos",".searchView.list-view",".sparkles-light-cta",".watch-extra-info-column",".watch-extra-info-right",".ytd-carousel-ad-renderer",".ytd-compact-promoted-video-renderer",".ytd-companion-slot-renderer",".ytd-merch-shelf-renderer",".ytd-player-legacy-desktop-watch-ads-renderer",".ytd-promoted-sparkles-text-search-renderer",".ytd-promoted-video-renderer",".ytd-search-pyv-renderer",".ytd-video-masthead-ad-v3-renderer",".ytp-ad-action-interstitial-background-container",".ytp-ad-action-interstitial-slot",".ytp-ad-image-overlay",".ytp-ad-overlay-container",".ytp-ad-progress",".ytp-ad-progress-list",'[class*="ytd-display-ad-"]','[layout*="display-ad-"]','a[href^="http://www.youtube.com/cthru?"]','a[href^="https://www.youtube.com/cthru?"]',"ytd-action-companion-ad-renderer","ytd-banner-promo-renderer","ytd-compact-promoted-video-renderer","ytd-companion-slot-renderer","ytd-display-ad-renderer","ytd-promoted-sparkles-text-search-renderer","ytd-promoted-sparkles-web-renderer","ytd-search-pyv-renderer","ytd-single-option-survey-renderer","ytd-video-masthead-ad-advertiser-info-renderer","ytd-video-masthead-ad-v3-renderer","YTM-PROMOTED-VIDEO-RENDERER"],l=()=>{const e=c;if(!e)return;const t=e.join(", ")+" { display: none!important; }",r=document.createElement("style");r.textContent=t,document.head.appendChild(r)},p=e=>{new MutationObserver(r=>{e(r)}).observe(document.documentElement,{childList:!0,subtree:!0})},a=()=>{const e=document.querySelectorAll("#contents > ytd-rich-item-renderer ytd-display-ad-renderer");e.length!==0&&e.forEach(t=>{if(t.parentNode&&t.parentNode.parentNode){const r=t.parentNode.parentNode;r.localName==="ytd-rich-item-renderer"&&(r.style.display="none")}})},s=()=>{if(document.querySelector(".ad-showing")){const e=document.querySelector("video");e&&e.duration&&(e.currentTime=e.duration,setTimeout(()=>{const t=document.querySelector("button.ytp-ad-skip-button");t&&t.click()},100))}},d=(e,t,r)=>{if(!e)return!1;let n=!1;for(const o in e)e.hasOwnProperty(o)&&o===t?(e[o]=r,n=!0):e.hasOwnProperty(o)&&typeof e[o]=="object"&&d(e[o],t,r)&&(n=!0);return n},i=(e,t)=>{const r=JSON.parse;JSON.parse=(...n)=>{const o=r.apply(this,n);return d(o,e,t),o},Response.prototype.json=new Proxy(Response.prototype.json,{async apply(...n){const o=await Reflect.apply(...n);return d(o,e,t),o}})};i("adPlacements",[]),i("playerAds",[]),l(),a(),s(),p(()=>{a(),s()})})();
`;Xr.app.on("browser-window-created",(t,e)=>{e.webContents.on("frame-created",(r,{frame:n})=>{n?.once("dom-ready",()=>{I.store.plugins?.YoutubeAdblock?.enabled&&(n.url.includes("youtube.com/embed/")?n.executeJavaScript(zt):n.parent?.url.includes("youtube.com/embed/")&&n.parent.executeJavaScript(zt))})})});var Xt={};le(Xt,{answerOverlayAction:()=>Go,armDisplayMedia:()=>To,checkUpdate:()=>qo,closeStudioOverlay:()=>Vo,deleteClip:()=>ro,disarmDisplayMedia:()=>Ao,downloadUpdate:()=>Jo,dropOverlayWaiters:()=>Wo,focusClient:()=>jo,getActiveScreen:()=>ko,getCaptureSources:()=>So,getClipDirectory:()=>yo,getMemoryReport:()=>Eo,getPlatformInfo:()=>xo,hideClipOverlay:()=>Oo,listClips:()=>eo,notifyClipSaved:()=>Mo,openClipDirectory:()=>bo,openStudioOverlay:()=>Fo,pickAudioFiles:()=>lo,pickClipDirectory:()=>wo,pickImageFiles:()=>po,pickVideoFiles:()=>so,readAudioFile:()=>fo,readClip:()=>to,readImageFile:()=>vo,readLibrary:()=>io,readVideoFile:()=>co,readVoiceTrack:()=>Xi,registerShortcuts:()=>Po,relaunchClient:()=>Xo,renameClip:()=>no,reserveClipPath:()=>Ki,revealClip:()=>go,saveClip:()=>Zi,saveVoiceTrack:()=>Ji,showClipOverlay:()=>_o,studioOverlayUp:()=>$o,unregisterShortcuts:()=>Jt,waitForOverlayAction:()=>zo,waitForShortcut:()=>Do,writeLibrary:()=>oo});l();var dn=require("crypto"),g=require("electron"),f=require("fs"),hn=require("https"),h=require("path");l();var re=require("electron"),ut=require("fs"),je=require("path"),en=require("url"),ct=24,tn=2600,lt=220,Ni=300,Ui=56,Wt=!0;function ft(){return Wt}var he=null,pe=null,Ge=null,de=null;function Fi(){return!!he&&!he.isDestroyed()}function me(){pe&&(clearTimeout(pe),pe=null);let t=he;he=null,t&&!t.isDestroyed()&&t.destroy()}function Ae(){de&&(clearTimeout(de),de=null);let t=Ge;Ge=null,t&&!t.isDestroyed()&&t.destroy()}function Vi(t,e,r){let i=re.screen.getDisplayNearestPoint(re.screen.getCursorScreenPoint()).workArea,o=t==="top-left"||t==="bottom-left",s=t==="top-left"||t==="top-right";return{x:Math.round(o?i.x+ct:i.x+i.width-e-ct),y:Math.round(s?i.y+ct:i.y+i.height-r-ct)}}function Be(t,e){let r=(0,je.join)(re.app.getPath("userData"),"clipper-overlay");(0,ut.mkdirSync)(r,{recursive:!0});let n=(0,je.join)(r,t);return(0,ut.writeFileSync)(n,e,"utf8"),n}function rn(t,e,r,n){let{x:i,y:o}=Vi(n,e,r),s=new re.BrowserWindow({width:e,height:r,x:i,y:o,frame:!1,transparent:!0,backgroundColor:"#00000000",resizable:!1,movable:!1,minimizable:!1,maximizable:!1,fullscreenable:!1,skipTaskbar:!0,focusable:!1,hasShadow:!1,alwaysOnTop:!0,show:!1,webPreferences:{nodeIntegration:!1,contextIsolation:!0,sandbox:!0,backgroundThrottling:!1}});return s.setAlwaysOnTop(!0,"screen-saver"),s.setVisibleOnAllWorkspaces(!0,{visibleOnFullScreen:!0}),s.setIgnoreMouseEvents(!0,{forward:!0}),s.loadFile(t).then(()=>{s.isDestroyed()||s.showInactive()}).catch(()=>{s.isDestroyed()||s.destroy()}),s}function nn(t){return`<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src file:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
    html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
    .card {
        position: absolute; inset: 0; border-radius: 12px; overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.14); box-shadow: 0 10px 34px rgba(0, 0, 0, 0.6);
        opacity: 0; transform: scale(0.96); transition: opacity ${lt}ms ease, transform ${lt}ms ease;
    }
    .card.up { opacity: 1; transform: none; }
    ${t}
</style>`}function W(t){return JSON.stringify(t).replace(/</g,"\\u003c")}function $i(t,e){return`<!doctype html>
<html>
<head>
${nn(`.card { background: #000; }
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
    var look = ${W(e)};
    var video = document.getElementById("video");
    var card = document.getElementById("card");
    document.getElementById("tag").textContent = ${W((0,je.basename)(t))};

    var leaving = false;
    function leave() {
        if (leaving) return;
        leaving = true;
        card.classList.remove("up");
        setTimeout(function () { window.close(); }, ${lt});
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

    video.src = ${W((0,en.pathToFileURL)(t).href)};

    // Autoplay with sound is only allowed after a gesture, and this window
    // never gets one. Muted playback is always allowed, so it is the fallback
    // rather than a reason to show nothing.
    video.play().catch(function () {
        video.muted = true;
        video.play().catch(leave);
    });
</script>
</body>
</html>`}function zi(t,e){return`<!doctype html>
<html>
<head>
${nn(`.card {
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
    document.getElementById("title").textContent = ${W(t)};
    document.getElementById("note").textContent = ${W(e)};

    requestAnimationFrame(function () { card.classList.add("up"); });

    setTimeout(function () {
        card.classList.remove("up");
        setTimeout(function () { window.close(); }, ${lt});
    }, ${tn});
</script>
</body>
</html>`}function on(t,e){if(!Wt)return!1;me(),Ae();let r=Math.max(200,Math.round(e.width)),n=Math.round(r*9/16),i=rn(Be("clip.html",$i(t,e)),r,n,e.corner);he=i,i.on("closed",()=>{he===i&&(he=null,pe&&(clearTimeout(pe),pe=null))});let o=(e.seconds>0?e.seconds:300)+10;return pe=setTimeout(()=>me(),o*1e3),!0}function sn(t,e,r){if(!Wt||Fi())return!1;Ae();let n=rn(Be("toast.html",zi(t,e)),Ni,Ui,r);return Ge=n,n.on("closed",()=>{Ge===n&&(Ge=null,de&&(clearTimeout(de),de=null))}),de=setTimeout(()=>Ae(),tn+4e3),!0}re.app.on("will-quit",()=>{me(),Ae()});l();var G=require("electron"),an=require("url");var Gt="VencordClipperOverlayAction",cn="VencordClipperOverlayReply",Wi=108,D=null;function jt(){return!!D&&!D.isDestroyed()}function Ze(){let t=D;D=null,t&&!t.isDestroyed()&&t.destroy()}var Ie=[],He=[];function Gi(t){let e=Ie.shift();if(e){e(t);return}He.push(t),He.length>4&&He.shift()}function ln(t){let e=He.shift();return e?Promise.resolve(e):new Promise(r=>{let n=!1,i=s=>{n||(n=!0,clearTimeout(o),r(s))},o=setTimeout(()=>{Ie=Ie.filter(s=>s!==i),i(null)},t);Ie.push(i)})}function un(){He=[];let t=Ie;Ie=[];for(let e of t)e(null)}function fn(t){!D||D.isDestroyed()||D.webContents.send(cn,t)}G.ipcMain.removeAllListeners(Gt);G.ipcMain.on(Gt,(t,e,r)=>{if(!D||D.isDestroyed()||t.sender!==D.webContents)return;let n=String(e??"");if(n==="close"){Ze();return}if(n!=="cut"&&n!=="send"&&n!=="delete"&&n!=="open")return;let i=r??{},o=Number(i.from),s=Number(i.to);Gi({kind:n,clip:String(i.clip??""),from:Number.isFinite(o)?Math.max(0,o):0,to:Number.isFinite(s)?Math.max(0,s):0})});function ji(t,e){let{workArea:r}=G.screen.getDisplayNearestPoint(G.screen.getCursorScreenPoint());return{x:Math.round(r.x+(r.width-t)/2),y:Math.round(r.y+(r.height-e)/2)}}var Bi=`"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("clipper", {
    act(kind, payload) {
        ipcRenderer.send(${W(Gt)}, String(kind), payload);
    },
    onReply(handler) {
        ipcRenderer.on(${W(cn)}, (_event, reply) => handler(reply));
    }
});
`;function Hi(t,e){return`<!doctype html>
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
    var clip = ${W({name:t.name,url:(0,an.pathToFileURL)(t.path).href,markers:t.markers})};
    var look = ${W(e)};
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
</html>`}function pn(t,e){if(!ft())return!1;Ze(),me(),Ae();let r=Math.max(360,Math.round(e.width)),n=Math.round(r*9/16)+Wi,{x:i,y:o}=ji(r,n),s=Be("studio-preload.js",Bi),a=Be("studio.html",Hi(t,e)),c=new G.BrowserWindow({width:r,height:n,x:i,y:o,frame:!1,transparent:!0,backgroundColor:"#00000000",resizable:!1,movable:!1,minimizable:!1,maximizable:!1,fullscreenable:!1,skipTaskbar:!0,hasShadow:!1,alwaysOnTop:!0,show:!1,webPreferences:{preload:s,nodeIntegration:!1,contextIsolation:!0,sandbox:!0,backgroundThrottling:!1}});return D=c,c.setAlwaysOnTop(!0,"screen-saver"),c.setVisibleOnAllWorkspaces(!0,{visibleOnFullScreen:!0}),c.on("closed",()=>{D===c&&(D=null)}),c.loadFile(a).then(()=>{c.isDestroyed()||(c.show(),c.focus())}).catch(()=>{c.isDestroyed()||c.destroy()}),!0}G.app.on("will-quit",()=>Ze());l();function Ke(t){return`${t.replace(/\.(webm|mp4)$/i,"")}.thumb.jpg`}var mn=!0,qt=!1,vn=/vesktop|equibop/i.test(g.app.getName());function x(t){let e=t?.trim();return e&&(0,h.isAbsolute)(e)?e:(0,h.join)(g.app.getPath("videos"),"DiscordClips")}function Re(t){let r=(0,h.basename)(String(t??"").replace(/[\\/]/g,"_")).trim().replace(/[<>:"|?*\x00-\x1f]/g,"_").replace(/^\.+/,""),n=/^([\w.\-+ ()[\]]{1,120})\.(webm|mp4|png|jpg|gif)$/i.exec(r);return n?`${n[1]}.${n[2].toLowerCase()}`:null}function Ce(t){return Re(t)??`clip-${Date.now()}.webm`}function Yt(t,e){let r=(0,h.extname)(e),n=e.slice(0,e.length-r.length),i=(0,h.join)(t,e);for(let o=2;(0,f.existsSync)(i)&&o<1e3;o++)i=(0,h.join)(t,`${n} (${o})${r}`);return i}function Zi(t,e,r,n,i=!1){let o=x(e);(0,f.mkdirSync)(o,{recursive:!0});let s=Ce(r),a=i?Yt(o,s):(0,h.join)(o,s);return(0,f.writeFileSync)(a,Buffer.from(n)),a}function Ki(t,e,r){let n=x(e);return(0,f.mkdirSync)(n,{recursive:!0}),Yt(n,Ce(r))}var pt="voices";function qi(t,e){let r=Re(t);return!r||!/^\d{1,25}$/.test(String(e??""))?null:`${r.slice(0,r.length-(0,h.extname)(r).length)}.${e}.webm`}function Yi(t,e){let r=Re(e);if(!r)return[];let n=(0,h.join)(x(t),pt);if(!(0,f.existsSync)(n))return[];let i=`${r.slice(0,r.length-(0,h.extname)(r).length)}.`,o=[];for(let s of(0,f.readdirSync)(n,{withFileTypes:!0})){if(!s.isFile()||!s.name.startsWith(i)||!s.name.toLowerCase().endsWith(".webm"))continue;let a=s.name.slice(i.length,s.name.length-5);/^\d{1,25}$/.test(a)&&o.push({userId:a,file:s.name})}return o}function Ji(t,e,r,n,i){let o=qi(r,n);if(!o)return null;let s=(0,h.join)(x(e),pt);(0,f.mkdirSync)(s,{recursive:!0});let a=(0,h.join)(s,o);return(0,f.writeFileSync)(a,Buffer.from(i)),a}function Xi(t,e,r){let n=(0,h.basename)(String(r??"").replace(/[\\/]/g,"_"));if(!n.toLowerCase().endsWith(".webm")||n.includes(".."))throw new Error("not a voice track");return new Uint8Array((0,f.readFileSync)((0,h.join)(x(e),pt,n)))}function Qi(t,e){let r=(0,h.join)(x(t),pt);for(let{file:n}of Yi(t,e))try{(0,f.unlinkSync)((0,h.join)(r,n))}catch{}}function eo(t,e){let r=x(e);if(!(0,f.existsSync)(r))return[];let n=[],i=new Set,o=(0,f.readdirSync)(r,{withFileTypes:!0});for(let s of o)s.isFile()&&i.add(s.name);for(let s of o){if(!s.isFile()||!/\.(webm|mp4)$/i.test(s.name))continue;let a=(0,h.join)(r,s.name);try{let c=(0,f.statSync)(a),p=Ke(s.name);n.push({name:s.name,path:a,size:c.size,modified:c.mtimeMs,...i.has(p)?{thumb:p}:{}})}catch{}}return n.sort((s,a)=>a.modified-s.modified)}function to(t,e,r){let n=(0,h.join)(x(e),Ce(r));return new Uint8Array((0,f.readFileSync)(n))}async function ro(t,e,r){let n=x(e),i=Ce(r),o=(0,h.join)(n,i);try{await g.shell.trashItem(o)}catch{(0,f.unlinkSync)(o)}Qi(e,i);let s=(0,h.join)(n,Ke(i));if((0,f.existsSync)(s))try{await g.shell.trashItem(s)}catch{try{(0,f.unlinkSync)(s)}catch{}}}function no(t,e,r,n){let i=x(e),o=Ce(r),s=(0,h.join)(i,o),a=(0,h.extname)(o),c=Re(n.toLowerCase().endsWith(a)?n:n+a);if(!c)throw new Error("That name cannot be used. Keep it under 120 characters, with letters, digits, spaces or - _ . + ( ) [ ]");if(c===o)return o;let d=c.toLowerCase()===o.toLowerCase()?(0,h.join)(i,c):Yt(i,c);(0,f.renameSync)(s,d);let u=(0,h.join)(i,Ke(o));if((0,f.existsSync)(u))try{(0,f.renameSync)(u,(0,h.join)(i,Ke((0,h.basename)(d))))}catch{}return(0,h.basename)(d)}var gn="clipper-library.json";function io(t,e){let r=(0,h.join)(x(e),gn);if(!(0,f.existsSync)(r))return"";try{return(0,f.readFileSync)(r,"utf8")}catch{return""}}function oo(t,e,r){let n=x(e);(0,f.mkdirSync)(n,{recursive:!0});let i=(0,h.join)(n,gn),o=`${i}.tmp`;(0,f.writeFileSync)(o,String(r??""),"utf8"),(0,f.renameSync)(o,i)}async function so(t){let e=await g.dialog.showOpenDialog({title:"Add videos to the timeline",properties:["openFile","multiSelections"],filters:[{name:"Video",extensions:["mp4","webm","mkv","mov","m4v"]}]});return e.canceled?[]:e.filePaths}var ao=512*1024*1024;function co(t,e){if(!(0,h.isAbsolute)(e)||!/\.(mp4|webm|mkv|mov|m4v)$/i.test(e))throw new Error("Not a video file");let r=(0,f.statSync)(e);if(r.size>ao){let n=Math.round(r.size/1048576);throw new Error(`That video is ${n} MB; imports are capped at 512 MB. Trim it or lower its bitrate first.`)}return new Uint8Array((0,f.readFileSync)(e))}async function lo(t){let e=await g.dialog.showOpenDialog({title:"Add sounds to the timeline",properties:["openFile","multiSelections"],filters:[{name:"Audio",extensions:["mp3","wav","ogg","opus","m4a","aac","flac","webm"]}]});return e.canceled?[]:e.filePaths}var uo=64*1024*1024;function fo(t,e){if(!(0,h.isAbsolute)(e)||!/\.(mp3|wav|ogg|opus|m4a|aac|flac|webm)$/i.test(e))throw new Error("Not an audio file");let r=(0,f.statSync)(e);if(r.size>uo){let n=Math.round(r.size/1048576);throw new Error(`That sound is ${n} MB; the timeline caps them at 64 MB.`)}return new Uint8Array((0,f.readFileSync)(e))}async function po(t){let e=await g.dialog.showOpenDialog({title:"Add pictures and clips to the montage",properties:["openFile","multiSelections"],filters:[{name:"Pictures and clips",extensions:["png","jpg","jpeg","webp","gif","avif","bmp","mp4","webm"]},{name:"Pictures",extensions:["png","jpg","jpeg","webp","gif","avif","bmp"]},{name:"Clips",extensions:["mp4","webm"]}]});return e.canceled?[]:e.filePaths}var ho=24*1024*1024,mo=64*1024*1024;function vo(t,e){if(!(0,h.isAbsolute)(e)||!/\.(png|jpe?g|webp|gif|avif|bmp|mp4|webm)$/i.test(e))throw new Error("Not a picture or a clip");let r=/\.(mp4|webm)$/i.test(e),n=r?mo:ho,i=(0,f.statSync)(e);if(i.size>n){let o=Math.round(i.size/1048576),s=Math.round(n/(1024*1024));throw new Error(`That ${r?"clip":"picture"} is ${o} MB; the montage caps them at ${s} MB.`)}return new Uint8Array((0,f.readFileSync)(e))}function go(t,e,r){g.shell.showItemInFolder((0,h.join)(x(e),Ce(r)))}function yo(t,e){return x(e)}async function wo(t,e){let r=await g.dialog.showOpenDialog({title:"Where should clips be saved?",defaultPath:x(e),properties:["openDirectory","createDirectory"]});return r.canceled?"":r.filePaths[0]??""}function bo(t,e){let r=x(e);(0,f.mkdirSync)(r,{recursive:!0}),g.shell.openPath(r)}function xo(t){return{platform:"win32",wayland:qt,vesktop:vn,overlay:ft()}}var ne=new Set;async function So(t,e=!0){if(qt)return[];let r=await g.desktopCapturer.getSources({types:["screen","window"],thumbnailSize:e?{width:320,height:180}:{width:0,height:0},fetchWindowIcons:!1});if(ne.size){let i=new Set(r.map(o=>o.id));for(let o of ne)i.has(o)||ne.delete(o)}let n=[];for(let i of r){let o=i.id.startsWith("screen:");if(!e){if(!o&&ne.has(i.id))continue;n.push({id:i.id,name:i.name,thumbnail:""});continue}let s=i.thumbnail.isEmpty();if(mn&&!o&&s){ne.add(i.id);continue}ne.delete(i.id),n.push({id:i.id,name:i.name,thumbnail:s?"":i.thumbnail.toDataURL(),capturable:!0})}return n}async function Eo(t){try{return g.app.getAppMetrics().map(e=>({type:e.serviceName||e.type,mb:Math.round((e.memory?.workingSetSize??0)/1024)})).filter(e=>e.mb>0).sort((e,r)=>r.mb-e.mb)}catch{return[]}}async function ko(t){if(qt)return"";let e=await g.desktopCapturer.getSources({types:["screen"],thumbnailSize:{width:0,height:0}});if(!e.length)return"";try{let r=g.screen.getDisplayNearestPoint(g.screen.getCursorScreenPoint()),n=e.find(i=>i.display_id===String(r.id));if(n)return n.id}catch{}return e[0].id}var Bt="",Ht=!1;function To(t,e,r=!0){return!r||vn?!1:(Bt=e??"",Ht=!0,g.session.defaultSession.setDisplayMediaRequestHandler(async(n,i)=>{let o=await g.desktopCapturer.getSources({types:["screen","window"],thumbnailSize:{width:0,height:0}}),s=o.find(p=>p.id===Bt),c=(s&&!ne.has(s.id)?s:void 0)??o.find(p=>p.id.startsWith("screen:"))??o.find(p=>!ne.has(p.id));if(!c){i({});return}i(mn&&c.id.startsWith("screen:")?{video:c,audio:"loopback"}:{video:c})},{useSystemPicker:!1}),!0)}function Ao(t){Bt="",Ht&&(Ht=!1,g.session.defaultSession.setDisplayMediaRequestHandler(null))}var Zt=new Map,Pe=[],qe=[];function Io(t){let e=Pe.shift();if(e){e(t);return}qe.push(t),qe.length>8&&qe.shift()}function Po(t,e){Jt();let r=[];for(let[n,i]of Object.entries(e)){if(!i)continue;let o=!1;try{o=g.globalShortcut.register(i,()=>Io(n))}catch{o=!1}o?Zt.set(n,i):r.push(i)}return r}function Jt(t){for(let r of Zt.values())try{g.globalShortcut.unregister(r)}catch{}Zt.clear(),qe=[];let e=Pe;Pe=[];for(let r of e)r(null)}function Do(t,e=3e4){let r=qe.shift();return r?Promise.resolve(r):new Promise(n=>{let i=!1,o=a=>{i||(i=!0,clearTimeout(s),n(a))},s=setTimeout(()=>{Pe=Pe.filter(a=>a!==o),o(null)},e);Pe.push(o)})}g.app.on("will-quit",()=>Jt());var Ro=["top-left","top-right","bottom-left","bottom-right"];function De(t,e,r,n){let i=Number(t);return Number.isFinite(i)?Math.min(r,Math.max(e,Math.round(i))):n}function yn(t){return Ro.includes(t)?t:"bottom-right"}function Co(t){return{corner:yn(t?.corner),width:De(t?.width,200,1280,420),volume:De(t?.volume,0,100,0),seconds:De(t?.seconds,0,300,10)}}function Kt(t,e){return String(t??"").replace(/\s+/g," ").trim().slice(0,e)}function _o(t,e,r,n){let i=Re(r);if(!i)return!1;let o=(0,h.join)(x(e),i);return(0,f.existsSync)(o)?on(o,Co(n)):!1}function Mo(t,e,r,n){return g.BrowserWindow.getFocusedWindow()||jt()?!1:sn(Kt(e,60),Kt(r,90),yn(n))}function Oo(t){me()}var Lo=200;function No(t){return Array.isArray(t)?t.map(Number).filter(e=>Number.isFinite(e)&&e>=0).slice(0,Lo):[]}function Uo(t){return{width:De(t?.width,360,1600,720),volume:De(t?.volume,0,100,0)}}function Fo(t,e,r,n,i){let o=Re(r);if(!o)return!1;let s=(0,h.join)(x(e),o);return(0,f.existsSync)(s)?pn({name:o,path:s,markers:No(n)},Uo(i)):!1}function Vo(t){Ze()}function $o(t){return jt()}function zo(t,e=3e4){return ln(De(e,1e3,12e4,3e4))}function Wo(t){un()}function Go(t,e,r,n){fn({ok:!!e,message:Kt(r,120),close:!!n})}function jo(t){let e=g.BrowserWindow.fromWebContents(t.sender);!e||e.isDestroyed()||(e.isMinimized()&&e.restore(),e.show(),e.focus())}var Ye="kebab1337420/vencord-clipper",Bo=`VencordClipper (+https://github.com/${Ye})`,Ho=["patcher.js","patcher.js.LEGAL.txt","preload.js","renderer.css","renderer.js","renderer.js.LEGAL.txt","vencordDesktopMain.js","vencordDesktopMain.js.LEGAL.txt","vencordDesktopPreload.js","vencordDesktopRenderer.css","vencordDesktopRenderer.js","vencordDesktopRenderer.js.LEGAL.txt"];function dt(t,e=0){return new Promise((r,n)=>{let i=(0,hn.get)(t,{headers:{"User-Agent":Bo,Accept:"*/*"}},o=>{let s=o.statusCode??0,{location:a}=o.headers;if(s>=300&&s<400&&a){o.resume(),e>=5?n(new Error(`Too many redirects for ${t}`)):r(dt(new URL(a,t).toString(),e+1));return}let c=[];o.on("data",p=>c.push(p)),o.on("end",()=>r({status:s,body:Buffer.concat(c)})),o.on("error",n)});i.setTimeout(6e4,()=>i.destroy(new Error(`${t} timed out`))),i.on("error",n)})}async function Zo(t){let{status:e,body:r}=await dt(t);if(e!==200)throw new Error(`${t} answered ${e}`);return r}function wn(){return __dirname}function bn(t){return(0,f.existsSync)((0,h.join)(t,"patcher.js"))&&(0,f.existsSync)((0,h.join)(t,"renderer.js"))}function xn(t){try{return(0,f.accessSync)(t,f.constants.W_OK),!0}catch{return!1}}function Ko(t,e){let r=o=>o.replace(/^v/i,"").split(/[.\-+]/).map(s=>Number(s)||0),n=r(t),i=r(e);for(let o=0;o<3;o++)if((n[o]??0)!==(i[o]??0))return(n[o]??0)>(i[o]??0);return!1}async function qo(t,e){let r=await Zo(`https://api.github.com/repos/${Ye}/releases/latest`),n=JSON.parse(r.toString("utf8")),i=String(n.tag_name??""),o=i.replace(/^v/i,""),s=wn();return{version:o,tag:i,available:!!o&&Ko(o,e),notes:String(n.body??"").trim().slice(0,1200),url:String(n.html_url??`https://github.com/${Ye}/releases`),directory:s,writable:bn(s)&&xn(s)}}async function Yo(t){let{status:e,body:r}=await dt(`https://raw.githubusercontent.com/${Ye}/${t}/prebuilt/build-info.json`);if(e!==200)return null;try{let{files:n}=JSON.parse(r.toString("utf8"));return n&&typeof n=="object"?n:null}catch{return null}}async function Jo(t,e){if(!/^[\w.-]{1,40}$/.test(e))throw new Error(`Refusing to fetch a release named ${e}`);let r=wn();if(!bn(r))throw new Error(`No installed bundle at ${r}`);if(!xn(r))throw new Error(`${r} is read-only`);let n=await Yo(e),i=n?Object.keys(n):Ho,o=(0,h.join)(r,".clipper-update");(0,f.rmSync)(o,{recursive:!0,force:!0}),(0,f.mkdirSync)(o,{recursive:!0});try{let s=[];for(let a of i){if(a!==(0,h.basename)(a)||a.startsWith("."))throw new Error(`Refusing a release file named ${a}`);let{status:c,body:p}=await dt(`https://raw.githubusercontent.com/${Ye}/${e}/prebuilt/dist/${a}`);if(c===404&&!n)continue;if(c!==200)throw new Error(`${a} answered ${c}`);if(p.length===0)throw new Error(`${a} came back empty`);let d=n?.[a];if(d?.size!==void 0&&p.length!==d.size)throw new Error(`${a} is ${p.length} bytes, the release says ${d.size}`);if(d?.sha256&&(0,dn.createHash)("sha256").update(p).digest("hex").toLowerCase()!==d.sha256.toLowerCase())throw new Error(`${a} does not match its hash`);(0,f.writeFileSync)((0,h.join)(o,a),p),s.push(a)}if(s.length===0)throw new Error(`There is no bundle published under ${e}`);for(let a of["renderer.js","patcher.js"])if(!s.includes(a))throw new Error(`The release carries no ${a}`);if(!(0,f.readFileSync)((0,h.join)(o,"renderer.js")).includes("Clipper"))throw new Error("There is no Clipper in that release's renderer");for(let a of s)(0,f.renameSync)((0,h.join)(o,a),(0,h.join)(r,a));return s}finally{(0,f.rmSync)(o,{recursive:!0,force:!0})}}function Xo(t){g.app.relaunch(),g.app.quit(),setTimeout(()=>g.app.exit(0),3e3)}var Sn={AppleMusicRichPresence:Rt,ConsoleShortcuts:Ct,FixSpotifyEmbeds:Br,FixYoutubeEmbeds:Zr,OpenInApp:Ut,Translate:Ft,VoiceMessages:Vt,XSOverlay:$t,YoutubeAdblock:Qr,Clipper:Xt};var En={};for(let[t,e]of Object.entries(Sn)){let r=Object.entries(e);if(!r.length)continue;let n=En[t]={};for(let[i,o]of r){let s=`VencordPluginNative_${t}_${i}`;Qt.ipcMain.handle(s,o),n[i]=s}}Qt.ipcMain.on("VencordGetPluginIpcMethodMap",t=>{t.returnValue=En});q();l();function er(t,e=300){let r;return function(...n){clearTimeout(r),r=setTimeout(()=>{t(...n)},e)}}Se();var b=require("electron");l();var kn="PCFkb2N0eXBlIGh0bWw+PGh0bWwgbGFuZz0iZW4iPjxoZWFkPjxtZXRhIGNoYXJzZXQ9InV0Zi04Ij48dGl0bGU+VmVuY29yZCBRdWlja0NTUyBFZGl0b3I8L3RpdGxlPjxsaW5rIHJlbD0ic3R5bGVzaGVldCIgaHJlZj0iaHR0cHM6Ly9jZG4uanNkZWxpdnIubmV0L25wbS9tb25hY28tZWRpdG9yQDAuNTAuMC9taW4vdnMvZWRpdG9yL2VkaXRvci5tYWluLmNzcyIgaW50ZWdyaXR5PSJzaGEyNTYtdGlKUFEyTzA0ei9wWi9Bd2R5SWdock9NemV3ZitQSXZFbDFZS2JRdnNaaz0iIGNyb3Nzb3JpZ2luPSJhbm9ueW1vdXMiIHJlZmVycmVycG9saWN5PSJuby1yZWZlcnJlciI+PHN0eWxlPiNjb250YWluZXIsYm9keSxodG1se3Bvc2l0aW9uOmFic29sdXRlO2xlZnQ6MDt0b3A6MDt3aWR0aDoxMDAlO2hlaWdodDoxMDAlO21hcmdpbjowO3BhZGRpbmc6MDtvdmVyZmxvdzpoaWRkZW59PC9zdHlsZT48L2hlYWQ+PGJvZHk+PGRpdiBpZD0iY29udGFpbmVyIj48L2Rpdj48c2NyaXB0IHNyYz0iaHR0cHM6Ly9jZG4uanNkZWxpdnIubmV0L25wbS9tb25hY28tZWRpdG9yQDAuNTAuMC9taW4vdnMvbG9hZGVyLmpzIiBpbnRlZ3JpdHk9InNoYTI1Ni1LY1U0OFRHcjg0cjd1bkY3SjVJZ0JvOTVhZVZyRWJyR2UwNFM3VGNGVWpzPSIgY3Jvc3NvcmlnaW49ImFub255bW91cyIgcmVmZXJyZXJwb2xpY3k9Im5vLXJlZmVycmVyIj48L3NjcmlwdD48c2NyaXB0PnJlcXVpcmUuY29uZmlnKHtwYXRoczp7dnM6Imh0dHBzOi8vY2RuLmpzZGVsaXZyLm5ldC9ucG0vbW9uYWNvLWVkaXRvckAwLjUwLjAvbWluL3ZzIn19KSxyZXF1aXJlKFsidnMvZWRpdG9yL2VkaXRvci5tYWluIl0sKCgpPT57Z2V0Q3VycmVudENzcygpLnRoZW4oKGU9Pnt2YXIgdD1tb25hY28uZWRpdG9yLmNyZWF0ZShkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiY29udGFpbmVyIikse3ZhbHVlOmUsbGFuZ3VhZ2U6ImNzcyIsdGhlbWU6Z2V0VGhlbWUoKX0pO3Qub25EaWRDaGFuZ2VNb2RlbENvbnRlbnQoKCgpPT5zZXRDc3ModC5nZXRWYWx1ZSgpKSkpLHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCJyZXNpemUiLCgoKT0+e3QubGF5b3V0KCl9KSl9KSl9KSk8L3NjcmlwdD48L2JvZHk+PC9odG1sPg==";var Y=require("fs"),oe=require("fs/promises"),On=require("os"),ht=require("path");l();q();Se();var _e=require("electron");l();q();var tr=require("electron"),V=["connect-src"],M=[...V,"img-src"],In=["style-src","font-src"],Tn=[...M,"media-src"],S=[...M,...In],An=[...S,"script-src","worker-src"],nr={"http://localhost:*":S,"http://127.0.0.1:*":S,"localhost:*":S,"127.0.0.1:*":S,"*.github.io":S,"github.com":S,"raw.githubusercontent.com":S,"*.gitlab.io":S,"gitlab.com":S,"*.codeberg.page":S,"codeberg.org":S,"*.githack.com":S,"jsdelivr.net":S,"fonts.googleapis.com":In,"i.imgur.com":M,"i.ibb.co":M,"i.pinimg.com":M,"files.catbox.moe":S,"cdn.discordapp.com":S,"media.discordapp.net":M,"cdnjs.cloudflare.com":An,"cdn.jsdelivr.net":An,"api.github.com":V,"ws.audioscrobbler.com":V,"musicbrainz.org":V,"*.listenbrainz.org":V,"coverartarchive.org":V,"archive.org":V,"*.archive.org":V,"translate-pa.googleapis.com":V,"*.vencord.dev":M,"manti.vendicated.dev":M,"decor.fieryflames.dev":V,"ugc.decor.fieryflames.dev":M,"sponsor.ajay.app":V,"dearrow-thumb.ajay.app":M,"usrbg.is-hardly.online":M,"icons.duckduckgo.com":M,"*.tenor.com":Tn,"*.tenor.co":Tn},rr=(t,e)=>Object.keys(t).find(r=>r.toLowerCase()===e),Qo=t=>{let e={};return t.split(";").forEach(r=>{let[n,...i]=r.trim().split(/\s+/g);n&&!Object.prototype.hasOwnProperty.call(e,n)&&(e[n]=i)}),e},es=t=>Object.entries(t).filter(([,e])=>e?.length).map(e=>e.flat().join(" ")).join("; "),ts=t=>{let e=rr(t,"content-security-policy-report-only");e&&delete t[e];let r=rr(t,"content-security-policy");if(r){let n=Qo(t[r][0]),i=(o,...s)=>{n[o]??=[...n["default-src"]??[]],n[o].push(...s)};i("style-src","'unsafe-inline'"),i("script-src","'unsafe-inline'","'unsafe-eval'");for(let o of["style-src","connect-src","img-src","font-src","media-src","worker-src"])i(o,"blob:","data:","vencord:","vesktop:");for(let[o,s]of Object.entries(z.store.customCspRules))for(let a of s)i(a,o);for(let[o,s]of Object.entries(nr))for(let a of s)i(a,o);t[r]=[es(n)]}};function Pn(){tr.session.defaultSession.webRequest.onHeadersReceived(({responseHeaders:t,resourceType:e},r)=>{if(t&&(e==="mainFrame"&&ts(t),e==="stylesheet")){let n=rr(t,"content-type");n&&(t[n]=["text/css"])}r({cancel:!1,responseHeaders:t})}),tr.session.defaultSession.webRequest.onHeadersReceived=()=>{}}function Dn(){_e.ipcMain.handle("VencordCspRemoveOverride",os),_e.ipcMain.handle("VencordCspRequestAddOverride",is),_e.ipcMain.handle("VencordCspIsDomainAllowed",ss)}function rs(t,e){try{let{host:r}=new URL(t);if(/[;'"\\]/.test(r))return!1}catch{return!1}return!(e.length===0||e.some(r=>!S.includes(r)))}function ns(t,e,r){let n=new URL(t).host,i=`${r} wants to allow connections to ${n}`,o=`Unless you recognise and fully trust ${n}, you should cancel this request!

You will have to fully close and restart Discord for the changes to take effect.`;if(e.length===1&&e[0]==="connect-src")return{message:i,detail:o};let s=e.filter(a=>a!=="connect-src").map(a=>{switch(a){case"img-src":return"Images";case"style-src":return"CSS & Themes";case"font-src":return"Fonts";default:throw new Error(`Illegal CSP directive: ${a}`)}}).sort().join(", ");return o=`The following types of content will be allowed to load from ${n}:
${s}

${o}`,{message:i,detail:o}}async function is(t,e,r,n){if(!rs(e,r))return"invalid";let i=new URL(e).host;if(i in z.store.customCspRules)return"conflict";let{checkboxChecked:o,response:s}=await _e.dialog.showMessageBox({...ns(e,r,n),type:n?"info":"warning",title:"Vencord Host Permissions",buttons:["Cancel","Allow"],defaultId:0,cancelId:0,checkboxLabel:`I fully trust ${i} and understand the risks of allowing connections to it.`,checkboxChecked:!1});return s!==1?"cancelled":o?(z.store.customCspRules[i]=r,"ok"):"unchecked"}function os(t,e){return e in z.store.customCspRules?(delete z.store.customCspRules[e],!0):!1}function ss(t,e,r){try{let n=new URL(e).host,i=nr[n]??z.store.customCspRules[n];return i?r.every(o=>i.includes(o)):!1}catch{return!1}}l();var as=/[^\S\r\n]*?\r?(?:\r\n|\n)[^\S\r\n]*?\*[^\S\r\n]?/,cs=/^\\@/;function ir(t,e={}){return{fileName:t,name:e.name??t.replace(/\.css$/i,""),author:e.author??"Unknown Author",description:e.description??"A Discord Theme.",version:e.version,license:e.license,source:e.source,website:e.website,invite:e.invite}}function Rn(t){return t.charCodeAt(0)===65279&&(t=t.slice(1)),t}function Cn(t,e){if(!t)return ir(e);let r=t.split("/**",2)?.[1]?.split("*/",1)?.[0];if(!r)return ir(e);let n={},i="",o="";for(let s of r.split(as))if(s.length!==0)if(s.charAt(0)==="@"&&s.charAt(1)!==" "){n[i]=o.trim();let a=s.indexOf(" ");i=s.substring(1,a),o=s.substring(a+1)}else o+=" "+s.replace("\\n",`
`).replace(cs,"@");return n[i]=o.trim(),delete n[""],ir(e,n)}Te();l();var Me=require("path");function ie(t,e){let r=(0,Me.normalize)(t+"/"),n=(0,Me.join)(t,e),i=(0,Me.normalize)(n);return i===(0,Me.normalize)(t)||i.startsWith(r)?i:null}l();var _n=require("electron");function Mn(t){t.webContents.setWindowOpenHandler(({url:e})=>{switch(e){case"about:blank":case"https://discord.com/popout":case"https://ptb.discord.com/popout":case"https://canary.discord.com/popout":return{action:"allow"}}try{var{protocol:r}=new URL(e)}catch{return{action:"deny"}}switch(r){case"http:":case"https:":case"mailto:":case"steam:":case"spotify:":_n.shell.openExternal(e)}return{action:"deny"}})}var ls=(0,ht.join)(__dirname,"renderer.css");(0,Y.mkdirSync)(te,{recursive:!0});Dn();function Ln(){return(0,oe.readFile)(ke,"utf-8").catch(()=>"")}async function us(){let t=await(0,oe.readdir)(te).catch(()=>[]),e=[];for(let r of t){if(!r.endsWith(".css"))continue;let n=await Nn(r).then(Rn).catch(()=>null);n!=null&&e.push(Cn(n,r))}return e}function Nn(t){t=t.replace(/\?v=\d+$/,"");let e=ie(te,t);return e?(0,oe.readFile)(e,"utf-8"):Promise.reject(`Unsafe path ${t}`)}b.ipcMain.handle("VencordOpenQuickCss",()=>b.shell.openPath(ke));b.ipcMain.handle("VencordOpenExternal",(t,e)=>{try{var{protocol:r}=new URL(e)}catch{throw"Malformed URL"}if(!zr.includes(r))throw"Disallowed protocol.";b.shell.openExternal(e).catch(n=>console.error("[Vencord] Failed to open external link",e,n))});b.ipcMain.handle("VencordGetQuickCss",()=>Ln());b.ipcMain.handle("VencordSetQuickCss",(t,e)=>(0,Y.writeFileSync)(ke,e));b.ipcMain.handle("VencordGetThemesList",()=>us());b.ipcMain.handle("VencordGetThemeData",(t,e)=>Nn(e));b.ipcMain.handle("VencordGetThemeSystemValues",()=>{let t=b.systemPreferences.getAccentColor?.()??"";return t.length&&t[0]!=="#"&&(t=`#${t}`),{"os-accent-color":t}});b.ipcMain.handle("VencordOpenThemesFolder",()=>b.shell.openPath(te));b.ipcMain.handle("VencordOpenSettingsFolder",()=>b.shell.openPath(ue));var or=[];b.ipcMain.handle("VencordInitFileWatchers",({sender:t})=>{or.forEach(i=>i.close());let e,r;(0,oe.open)(ke,"a+").then(i=>{i.close(),e=(0,Y.watch)(ke,{persistent:!1},er(async()=>{t.postMessage("VencordQuickCssUpdate",await Ln())},50))}).catch(()=>{});let n=(0,Y.watch)(te,{persistent:!1},er(()=>{t.postMessage("VencordThemeUpdate",void 0)}));or=[e,n,r].filter(Boolean),t.once("destroyed",()=>{e?.close(),n.close(),r?.close(),or=[]})});b.ipcMain.on("VencordGetMonacoTheme",t=>{t.returnValue=b.nativeTheme.shouldUseDarkColors?"vs-dark":"vs-light"});b.ipcMain.handle("VencordOpenMonacoEditor",async()=>{let t="Vencord QuickCSS Editor",e=b.BrowserWindow.getAllWindows().find(n=>n.title===t);if(e&&!e.isDestroyed()){e.focus();return}let r=new b.BrowserWindow({title:t,autoHideMenuBar:!0,darkTheme:!0,backgroundColor:b.nativeTheme.shouldUseDarkColors?"#1e1e1e":"white",webPreferences:{preload:(0,ht.join)(__dirname,"preload.js"),contextIsolation:!0,nodeIntegration:!1,sandbox:!1}});Mn(r),await r.loadURL(`data:text/html;base64,${kn}`)});b.ipcMain.handle("VencordGetRendererCss",()=>(0,oe.readFile)(ls,"utf-8"));b.ipcMain.on("VencordPreloadGetRendererJs",t=>{t.returnValue=(0,Y.readFileSync)((0,ht.join)(__dirname,"renderer.js"),"utf-8")});b.ipcMain.on("VencordSupportsWindowsMaterial",t=>{t.returnValue=Number((0,On.release)().split(".")[2])>=22621});var ge=require("electron"),li=require("path"),mr=require("url");q();Te();l();var xt=require("electron");l();var Vn=require("module"),fs=(0,Vn.createRequire)("/"),Oe,vt,ar,ps=";var __w=require('worker_threads');__w.parentPort.on('message',function(m){onmessage({data:m})}),postMessage=function(m,t){__w.parentPort.postMessage(m,t)},close=process.exit;self=global";try{Oe=fs("worker_threads"),vt=Oe.Worker,ar=Oe.isMarkedAsUntransferable}catch{}var ds=vt?function(t,e,r,n,i){var o=!1,s=new vt(t+ps,{eval:!0}).on("error",function(a){return i(a,null)}).on("message",function(a){return i(null,a)}).on("exit",function(a){a&&!o&&i(new Error("exited with code "+a),null)});return ar&&(n=n.filter(function(a){return!ar(a)})),s.postMessage(r,n),s.terminate=function(){return o=!0,vt.prototype.terminate.call(s)},s}:function(t,e,r,n,i){setImmediate(function(){return i(new Error("async operations unsupported - update to Node 12+ (or Node 10-11 with the --experimental-worker CLI flag)"),null)});var o=function(){};return{terminate:o,postMessage:o}},P=Uint8Array,ve=Uint16Array,$n=Int32Array,lr=new P([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0,0,0,0]),ur=new P([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13,0,0]),zn=new P([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]),Wn=function(t,e){for(var r=new ve(31),n=0;n<31;++n)r[n]=e+=1<<t[n-1];for(var i=new $n(r[30]),n=1;n<30;++n)for(var o=r[n];o<r[n+1];++o)i[o]=o-r[n]<<5|n;return{b:r,r:i}},Oe=Wn(lr,2),fr=Oe.b,hs=Oe.r;fr[28]=258,hs[258]=28;var Gn=Wn(ur,0),jn=Gn.b,Pc=Gn.r,wt=new ve(32768);for(y=0;y<32768;++y)J=(y&43690)>>1|(y&21845)<<1,J=(J&52428)>>2|(J&13107)<<2,J=(J&61680)>>4|(J&3855)<<4,wt[y]=((J&65280)>>8|(J&255)<<8)>>1;var J,y,Le=(function(t,e,r){for(var n=t.length,i=0,o=new ve(e);i<n;++i)t[i]&&++o[t[i]-1];var s=new ve(e);for(i=1;i<e;++i)s[i]=s[i-1]+o[i-1]<<1;var a;if(r){a=new ve(1<<e);var c=15-e;for(i=0;i<n;++i)if(t[i])for(var p=i<<4|t[i],d=e-t[i],u=s[t[i]-1]++<<d,w=u|(1<<d)-1;u<=w;++u)a[wt[u]>>c]=p}else for(a=new ve(n),i=0;i<n;++i)t[i]&&(a[i]=wt[s[t[i]-1]++]>>15-t[i]);return a}),Je=new P(288);for(y=0;y<144;++y)Je[y]=8;var y;for(y=144;y<256;++y)Je[y]=9;var y;for(y=256;y<280;++y)Je[y]=7;var y;for(y=280;y<288;++y)Je[y]=8;var y,Bn=new P(32);for(y=0;y<32;++y)Bn[y]=5;var y;var Hn=Le(Je,9,1);var Zn=Le(Bn,5,1),gt=function(t){for(var e=t[0],r=1;r<t.length;++r)t[r]>e&&(e=t[r]);return e},O=function(t,e,r){var n=e/8|0;return(t[n]|t[n+1]<<8)>>(e&7)&r},yt=function(t,e){var r=e/8|0;return(t[r]|t[r+1]<<8|t[r+2]<<16)>>(e&7)},Kn=function(t){return(t+7)/8|0},bt=function(t,e,r){return(e==null||e<0)&&(e=0),(r==null||r>t.length)&&(r=t.length),new P(t.subarray(e,r))};var qn=["unexpected EOF","invalid block type","invalid length/literal","invalid distance","stream finished","no stream handler",,"no callback","invalid UTF-8 data","extra field too long","date not in range 1980-2099","filename too long","stream finishing","invalid zip data"],k=function(t,e,r){var n=new Error(e||qn[t]);if(n.code=t,Error.captureStackTrace&&Error.captureStackTrace(n,k),!r)throw n;return n},Yn=function(t,e,r,n){var i=t.length,o=n?n.length:0;if(!i||e.f&&!e.l)return r||new P(0);var s=!r,a=s||e.i!=2,c=e.i;s&&(r=new P(i*3));var p=function(xr){var Sr=r.length;if(xr>Sr){var Er=new P(Math.max(Sr*2,xr));Er.set(r),r=Er}},d=e.f||0,u=e.p||0,w=e.b||0,N=e.l,ae=e.d,Z=e.m,R=e.n,C=i*8;do{if(!N){d=O(t,u,1);var X=O(t,u+1,3);if(u+=3,X)if(X==1)N=Hn,ae=Zn,Z=9,R=5;else if(X==2){var Ne=O(t,u,31)+257,Xe=O(t,u+10,15)+4,ce=Ne+O(t,u+5,31)+1;u+=14;for(var _=new P(ce),we=new P(19),E=0;E<Xe;++E)we[zn[E]]=O(t,u+E*3,7);u+=Xe*3;for(var Ue=gt(we),ui=(1<<Ue)-1,fi=Le(we,Ue,1),E=0;E<ce;){var vr=fi[O(t,u,ui)];u+=vr&15;var A=vr>>4;if(A<16)_[E++]=A;else{var be=0,Qe=0;for(A==16?(Qe=3+O(t,u,3),u+=2,be=_[E-1]):A==17?(Qe=3+O(t,u,7),u+=3):A==18&&(Qe=11+O(t,u,127),u+=7);Qe--;)_[E++]=be}}var gr=_.subarray(0,Ne),Q=_.subarray(Ne);Z=gt(gr),R=gt(Q),N=Le(gr,Z,1),ae=Le(Q,R,1)}else k(1);else{var A=Kn(u)+4,K=t[A-4]|t[A-3]<<8,ye=A+K;if(ye>i){c&&k(0);break}a&&p(w+K),r.set(t.subarray(A,ye),w),e.b=w+=K,e.p=u=ye*8,e.f=d;continue}if(u>C){c&&k(0);break}}a&&p(w+131072);for(var pi=(1<<Z)-1,di=(1<<R)-1,St=u;;St=u){var be=N[yt(t,u)&pi],xe=be>>4;if(u+=be&15,u>C){c&&k(0);break}if(be||k(2),xe<256)r[w++]=xe;else if(xe==256){St=u,N=null;break}else{var yr=xe-254;if(xe>264){var E=xe-257,Fe=lr[E];yr=O(t,u,(1<<Fe)-1)+fr[E],u+=Fe}var Et=ae[yt(t,u)&di],kt=Et>>4;Et||k(3),u+=Et&15;var Q=jn[kt];if(kt>3){var Fe=ur[kt];Q+=yt(t,u)&(1<<Fe)-1,u+=Fe}if(u>C){c&&k(0);break}a&&p(w+131072);var wr=w+yr;if(w<Q){var br=o-Q,hi=Math.min(Q,wr);for(br+w<0&&k(3);w<hi;++w)r[w]=n[br+w]}for(;w<wr;++w)r[w]=r[w-Q]}}e.l=N,e.p=St,e.b=w,e.f=d,N&&(d=1,e.m=Z,e.d=ae,e.n=R)}while(!d);return w!=r.length&&s?bt(r,0,w):r.subarray(0,w)};var ms=new P(0);var vs=function(t,e){var r={};for(var n in t)r[n]=t[n];for(var n in e)r[n]=e[n];return r},Un=function(t,e,r){for(var n=t(),i=t.toString(),o=i.slice(i.indexOf("[")+1,i.lastIndexOf("]")).replace(/\s+/g,"").split(","),s=0;s<n.length;++s){var a=n[s],c=o[s];if(typeof a=="function"){e+=";"+c+"=";var p=a.toString();if(a.prototype)if(p.indexOf("[native code]")!=-1){var d=p.indexOf(" ",8)+1;e+=p.slice(d,p.indexOf("(",d))}else{e+=p;for(var u in a.prototype)e+=";"+c+".prototype."+u+"="+a.prototype[u].toString()}else e+=p}else r[c]=a}return e},mt=[],gs=function(t){var e=[];for(var r in t)t[r].buffer&&e.push((t[r]=new t[r].constructor(t[r])).buffer);return e},ys=function(t,e,r,n){if(!mt[r]){for(var i="",o={},s=t.length-1,a=0;a<s;++a)i=Un(t[a],i,o);mt[r]={c:Un(t[s],i,o),e:o}}var c=vs({},mt[r].e);return ds(mt[r].c+";onmessage=function(e){for(var k in e.data)self[k]=e.data[k];onmessage="+e.toString()+"}",r,c,gs(c),n)},ws=function(){return[P,ve,$n,lr,ur,zn,fr,jn,Hn,Zn,wt,qn,Le,gt,O,yt,Kn,bt,k,Yn,pr,Jn,Xn]};var Jn=function(t){return postMessage(t,[t.buffer])},Xn=function(t){return t&&{out:t.size&&new P(t.size),dictionary:t.dictionary}},bs=function(t,e,r,n,i,o){var s=ys(r,n,i,function(a,c){s.terminate(),o(a,c)});return s.postMessage([t,e],e.consume?[t.buffer]:[]),function(){s.terminate()}};var j=function(t,e){return t[e]|t[e+1]<<8},L=function(t,e){return(t[e]|t[e+1]<<8|t[e+2]<<16|t[e+3]<<24)>>>0},sr=function(t,e){return L(t,e)+L(t,e+4)*4294967296};function xs(t,e,r){return r||(r=e,e={}),typeof r!="function"&&k(7),bs(t,e,[ws],function(n){return Jn(pr(n.data[0],Xn(n.data[1])))},1,r)}function pr(t,e){return Yn(t,{i:2},e&&e.out,e&&e.dictionary)}var cr=typeof TextDecoder<"u"&&new TextDecoder,Ss=0;try{cr.decode(ms,{stream:!0}),Ss=1}catch{}var Es=function(t){for(var e="",r=0;;){var n=t[r++],i=(n>127)+(n>223)+(n>239);if(r+i>t.length)return{s:e,r:bt(t,r-1)};i?i==3?(n=((n&15)<<18|(t[r++]&63)<<12|(t[r++]&63)<<6|t[r++]&63)-65536,e+=String.fromCharCode(55296|n>>10,56320|n&1023)):i&1?e+=String.fromCharCode((n&31)<<6|t[r++]&63):e+=String.fromCharCode((n&15)<<12|(t[r++]&63)<<6|t[r++]&63):e+=String.fromCharCode(n)}};function ks(t,e){if(e){for(var r="",n=0;n<t.length;n+=16384)r+=String.fromCharCode.apply(null,t.subarray(n,n+16384));return r}else{if(cr)return cr.decode(t);var i=Es(t),o=i.s,r=i.r;return r.length&&k(8),o}}var Ts=function(t,e){return e+30+j(t,e+26)+j(t,e+28)},As=function(t,e,r){var n=j(t,e+28),i=j(t,e+30),o=ks(t.subarray(e+46,e+46+n),!(j(t,e+8)&2048)),s=e+46+n,a=Is(t,s,i,r,L(t,e+20),L(t,e+24),L(t,e+42)),c=a[0],p=a[1],d=a[2];return[j(t,e+10),c,p,o,s+i+j(t,e+32),d]},Is=function(t,e,r,n,i,o,s){var a=i==4294967295,c=o==4294967295,p=s==4294967295,d=e+r,u=a+c+p;if(n&&u){for(;e+4<d;e+=4+j(t,e+2))if(j(t,e)==1)return[a?sr(t,e+4+8*c):i,c?sr(t,e+4):o,p?sr(t,e+4+8*(c+a)):s,1];n<2&&k(13)}return[i,o,s,0]};var Fn=typeof queueMicrotask=="function"?queueMicrotask:typeof setTimeout=="function"?setTimeout:function(t){t()};function Qn(t,e,r){r||(r=e,e={}),typeof r!="function"&&k(7);var n=[],i=function(){for(var R=0;R<n.length;++R)n[R]()},o={},s=function(R,C){Fn(function(){r(R,C)})};Fn(function(){s=r});for(var a=t.length-22;L(t,a)!=101010256;--a)if(!a||t.length-a>65558)return s(k(13,0,1),null),i;var c=j(t,a+8);if(c){var p=c,d=L(t,a+16),u=L(t,a-20)==117853008;if(u){var w=L(t,a-12);u=L(t,w)==101075792,u&&(p=c=L(t,w+32),d=L(t,w+48))}for(var N=e&&e.filter,ae=function(R){var C=As(t,d,u),X=C[0],A=C[1],K=C[2],ye=C[3],Ne=C[4],Xe=C[5],ce=Ts(t,Xe);d=Ne;var _=function(E,Ue){E?(i(),s(E,null)):(Ue&&(o[ye]=Ue),--c||s(null,o))};if(!N||N({name:ye,size:A,originalSize:K,compression:X}))if(!X)_(null,bt(t,ce,ce+A));else if(X==8){var we=t.subarray(ce,ce+A);if(K<524288||A>.8*K)try{_(null,pr(we,{out:new P(K)}))}catch(E){_(E,null)}else n.push(xs(we,{size:K},_))}else _(k(14,"unknown compression type "+X,1),null);else _(null,null)},Z=0;Z<p;++Z)ae(Z)}else s(null,{});return i}var ri=require("fs"),B=require("fs/promises"),dr=require("path");Te();l();function ei(t){function e(s,a,c,p){let d=0;return d+=s<<0,d+=a<<8,d+=c<<16,d+=p<<24>>>0,d}if(t[0]===80&&t[1]===75&&t[2]===3&&t[3]===4)return t;if(t[0]!==67||t[1]!==114||t[2]!==50||t[3]!==52)throw new Error("Invalid header: Does not start with Cr24");let r=t[4]===3,n=t[4]===2;if(!n&&!r||t[5]||t[6]||t[7])throw new Error("Unexpected crx format version number.");if(n){let s=e(t[8],t[9],t[10],t[11]),a=e(t[12],t[13],t[14],t[15]),c=16+s+a;return t.subarray(c,t.length)}let o=12+e(t[8],t[9],t[10],t[11]);return t.subarray(o,t.length)}l();var Ps=require("original-fs");async function Ds(t,e){try{var r=await fetch(t,e)}catch(i){throw i instanceof Error&&i.cause&&(i=i.cause),new Error(`${e?.method??"GET"} ${t} failed: ${i}`)}if(r.ok)return r;let n=`${e?.method??"GET"} ${t}: ${r.status} ${r.statusText}`;try{let i=await r.text();n+=`
${i}`}catch{}throw new Error(n)}async function ti(t,e){let n=await(await Ds(t,e)).arrayBuffer();return Buffer.from(n)}var Rs=(0,dr.join)(rt,"ExtensionCache");async function Cs(t,e){return await(0,B.mkdir)(e,{recursive:!0}),new Promise((r,n)=>{Qn(t,(i,o)=>{if(i)return void n(i);Promise.all(Object.keys(o).map(async s=>{if(s.startsWith("_metadata/"))return;if(s.includes("\0"))throw new Error(`Invalid filename: "${s}"`);if(s.endsWith("/")){let u=ie(e,s);if(!u)throw new Error(`Path traversal detected: "${s}"`);return void await(0,B.mkdir)(u,{recursive:!0})}let c=s.split("/").slice(0,-1).join("/"),p=ie(e,c);if(!p)throw new Error(`Path traversal detected: "${s}"`);let d=ie(e,s);if(!d)throw new Error(`Path traversal detected: "${s}"`);c&&await(0,B.mkdir)(p,{recursive:!0}),await(0,B.writeFile)(d,o[s])})).then(()=>r()).catch(s=>{(0,B.rm)(e,{recursive:!0,force:!0}),n(s)})})})}async function ni(t){let e=(0,dr.join)(Rs,t);try{await(0,B.access)(e,ri.constants.F_OK)}catch{let n=`https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3&x=id%3D${t}%26uc&prodversion=${process.versions.chrome}`,i=await ti(n,{headers:{"User-Agent":`Electron ${process.versions.electron} ~ Vencord (https://github.com/Vendicated/Vencord)`}});await Cs(ei(i),e).catch(o=>console.error(`Failed to extract extension ${t}`,o))}xt.session.defaultSession.extensions?xt.session.defaultSession.extensions.loadExtension(e):xt.session.defaultSession.loadExtension(e)}nt||ge.app.whenReady().then(()=>{ge.protocol.handle("vencord",({url:t})=>{let e=decodeURI(t).slice(10).replace(/\?v=\d+$/,"");if(e.endsWith("/")&&(e=e.slice(0,-1)),e.startsWith("/themes/")){let r=e.slice(8),n=ie(te,r);return n?ge.net.fetch((0,mr.pathToFileURL)(n).toString()):new Response(null,{status:404})}switch(e){case"renderer.js.map":case"vencordDesktopRenderer.js.map":case"preload.js.map":case"vencordDesktopPreload.js.map":case"patcher.js.map":case"vencordDesktopMain.js.map":return ge.net.fetch((0,mr.pathToFileURL)((0,li.join)(__dirname,e)).toString());default:return new Response(null,{status:404})}});try{I.store.enableReactDevtools&&ni("fmkadmapgofadopljbjfkapdkoienihi").then(()=>console.info("[Vencord] Installed React Developer Tools")).catch(t=>console.error("[Vencord] Failed to install React Developer Tools",t))}catch{}Pn()});ci();
//# sourceURL=file:///VencordPatcher
//# sourceMappingURL=vencord://patcher.js.map
/*! For license information please see patcher.js.LEGAL.txt */
