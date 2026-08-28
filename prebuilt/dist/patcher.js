// Vencord ef29bbe
// Standalone: false
// Platform: win32
// Updater Disabled: false
"use strict";var Oo=Object.create;var Ct=Object.defineProperty;var Vo=Object.getOwnPropertyDescriptor;var Fo=Object.getOwnPropertyNames;var No=Object.getPrototypeOf,Uo=Object.prototype.hasOwnProperty;var W=(t,e,n)=>()=>{if(n)throw n[0];try{return t&&(e=t(t=0)),e}catch(r){throw n=[r],r}};var we=(t,e)=>{for(var n in e)Ct(t,n,{get:e[n],enumerable:!0})},gr=(t,e,n,r)=>{if(e&&typeof e=="object"||typeof e=="function")for(let i of Fo(e))!Uo.call(t,i)&&i!==n&&Ct(t,i,{get:()=>e[i],enumerable:!(r=Vo(e,i))||r.enumerable});return t};var vr=(t,e,n)=>(n=t!=null?Oo(No(t)):{},gr(e||!t||!t.__esModule?Ct(n,"default",{value:t,enumerable:!0}):n,t)),cn=t=>gr(Ct({},"__esModule",{value:!0}),t);var c=W(()=>{"use strict"});var Le=W(()=>{"use strict";c()});function rt(t){return async function(){try{return{ok:!0,value:await t(...arguments)}}catch(e){return{ok:!1,error:e instanceof Error?{...e,message:e.message,name:e.name,stack:e.stack}:e}}}}var yr=W(()=>{"use strict";c()});var Bo={};function Oe(...t){let e={cwd:xr};return dn?un("flatpak-spawn",["--host","git",...t],e):un("git",t,e)}async function Go(){return(await Oe("remote","get-url","origin")).stdout.trim().replace(/git@(.+):/,"https://$1/").replace(/\.git$/,"")}async function $o(){await Oe("fetch");let t=(await Oe("branch","--show-current")).stdout.trim();if(!((await Oe("ls-remote","origin",t)).stdout.length>0))return[];let r=(await Oe("log",`HEAD...origin/${t}`,"--pretty=format:%an/%h/%s")).stdout.trim();return r?r.split(`
`).map(i=>{let[o,a,...s]=i.split("/");return{hash:a,author:o,message:s.join("/").split(`
`)[0]}}):[]}async function Wo(){return(await Oe("pull")).stdout.includes("Fast-forward")}async function zo(){return!(await un(dn?"flatpak-spawn":"node",dn?["--host","node","scripts/build/build.mjs"]:["scripts/build/build.mjs"],{cwd:xr})).stderr.includes("Build failed")}var wr,it,br,Sr,xr,un,dn,kr=W(()=>{"use strict";c();Le();wr=require("child_process"),it=require("electron"),br=require("path"),Sr=require("util");yr();xr=(0,br.join)(__dirname,".."),un=(0,Sr.promisify)(wr.execFile),dn=!1;it.ipcMain.handle("VencordGetRepo",rt(Go));it.ipcMain.handle("VencordGetUpdates",rt($o));it.ipcMain.handle("VencordUpdate",rt(Wo));it.ipcMain.handle("VencordBuild",rt(zo))});var gn,Cr,ot,Rr=W(()=>{"use strict";c();gn=Symbol("SettingsStore.isProxy"),Cr=Symbol("SettingsStore.getRawTarget"),ot=class{pathListeners=new Map;prefixListeners=new Map;globalListeners=new Set;proxyContexts=new WeakMap;proxyHandler=(()=>{let e=this;return{get(n,r,i){if(r===gn)return!0;if(r===Cr)return n;let o=Reflect.get(n,r,i),a=e.proxyContexts.get(n);if(a==null)return o;let{root:s,path:l}=a;if(!(r in n)&&e.getDefaultValue!=null&&(o=e.getDefaultValue({target:n,key:r,root:s,path:l})),typeof o=="object"&&o!==null&&!o[gn]){let f=`${l}${l&&"."}${r}`;return e.makeProxy(o,s,f)}return o},set(n,r,i){if(i?.[gn]&&(i=i[Cr]),n[r]===i)return!0;if(!Reflect.set(n,r,i))return!1;let o=e.proxyContexts.get(n);if(o==null)return!0;let{root:a,path:s}=o,l=`${s}${s&&"."}${r}`;return e.notifyListeners(l,i,a),!0},deleteProperty(n,r){if(!Reflect.deleteProperty(n,r))return!1;let i=e.proxyContexts.get(n);if(i==null)return!0;let{root:o,path:a}=i,s=`${a}${a&&"."}${r}`;return e.notifyListeners(s,void 0,o),!0}}})();constructor(e,n={}){this.plain=e,this.store=this.makeProxy(e),Object.assign(this,n)}makeProxy(e,n=e,r=""){return this.proxyContexts.set(e,{root:n,path:r}),new Proxy(e,this.proxyHandler)}notifyPrefixListeners(e,n,r){for(let i=1;i<=n.length;i++){let o=n.slice(0,i).join(".");this.prefixListeners.get(o)?.forEach(a=>a(r,e))}}notifyListeners(e,n,r){let i=e.split(".");if(i.length>3&&i[0]==="plugins"){let o=i.slice(0,3),a=o.join("."),s=o.reduce((l,f)=>l[f],r);this.globalListeners.forEach(l=>l(r,a)),this.pathListeners.get(a)?.forEach(l=>l(s))}else this.globalListeners.forEach(o=>o(r,e));this.pathListeners.get(e)?.forEach(o=>o(n)),this.notifyPrefixListeners(e,i,n)}setData(e,n){if(this.readOnly)throw new Error("SettingsStore is read-only");if(this.plain=e,this.store=this.makeProxy(e),n){let r=e,i=n.split(".");for(let o of i){if(!r){console.warn(`Settings#setData: Path ${n} does not exist in new data. Not dispatching update`);return}r=r[o]}this.pathListeners.get(n)?.forEach(o=>o(r)),this.notifyPrefixListeners(n,i,r)}this.markAsChanged()}addGlobalChangeListener(e){this.globalListeners.add(e)}addChangeListener(e,n){let r=this.pathListeners.get(e)??new Set;r.add(n),this.pathListeners.set(e,r)}addPrefixChangeListener(e,n){let r=this.prefixListeners.get(e)??new Set;r.add(n),this.prefixListeners.set(e,r)}removeGlobalChangeListener(e){this.globalListeners.delete(e)}removeChangeListener(e,n){let r=this.pathListeners.get(e);r&&(r.delete(n),r.size||this.pathListeners.delete(e))}removePrefixChangeListener(e,n){let r=this.prefixListeners.get(e);r&&(r.delete(n),r.size||this.prefixListeners.delete(e))}markAsChanged(){this.globalListeners.forEach(e=>e(this.plain,""))}}});function vn(t,e){for(let n in e){let r=e[n];typeof r=="object"&&!Array.isArray(r)?(t[n]??={},vn(t[n],r)):t[n]??=r}return t}var Mr=W(()=>{"use strict";c()});var _r,le,Mt,be,ce,Ve,yn,wn,Dr,_t,Fe=W(()=>{"use strict";c();_r=require("electron"),le=require("path"),Mt=process.env.VENCORD_USER_DATA_DIR??(process.env.DISCORD_USER_DATA_DIR?(0,le.join)(process.env.DISCORD_USER_DATA_DIR,"..","VencordData"):(0,le.join)(_r.app.getPath("userData"),"..","Vencord")),be=(0,le.join)(Mt,"settings"),ce=(0,le.join)(Mt,"themes"),Ve=(0,le.join)(be,"quickCss.css"),yn=(0,le.join)(be,"settings.json"),wn=(0,le.join)(be,"native-settings.json"),Dr=["https:","http:","steam:","spotify:","com.epicgames.launcher:","tidal:","itunes:"],_t=process.argv.includes("--vanilla")});function Lr(t,e){try{return JSON.parse((0,Se.readFileSync)(e,"utf-8"))}catch(n){return n?.code!=="ENOENT"&&console.error(`Failed to read ${t} settings`,n),{}}}var bn,Se,C,Zo,Or,K,te=W(()=>{"use strict";c();Le();Rr();Mr();bn=require("electron"),Se=require("fs");Fe();(0,Se.mkdirSync)(be,{recursive:!0});C=new ot(Lr("renderer",yn));C.addGlobalChangeListener(()=>{try{(0,Se.writeFileSync)(yn,JSON.stringify(C.plain,null,4))}catch(t){console.error("Failed to write renderer settings",t)}});bn.ipcMain.on("VencordGetSettings",t=>t.returnValue=C.plain);bn.ipcMain.handle("VencordSetSettings",(t,e,n)=>{C.setData(e,n)});Zo={plugins:{},customCspRules:{}},Or=Lr("native",wn);vn(Or,Zo);K=new ot(Or);K.addGlobalChangeListener(()=>{try{(0,Se.writeFileSync)(wn,JSON.stringify(K.plain,null,4))}catch(t){console.error("Failed to write native settings",t)}})});function Eo(t,e,n){let r=e;if(e in t)return void n(t[r]);Object.defineProperty(t,e,{set(i){delete t[r],t[r]=i,n(i)},configurable:!0,enumerable:!1})}var To=W(()=>{"use strict";c()});var $l={};function Ul(t,e){let n=t.slice(4).split(".").map(Number),r=e.slice(4).split(".").map(Number);for(let i=0;i<r.length;i++){if(n[i]>r[i])return!0;if(n[i]<r[i])return!1}return!1}function Gl(){if(!process.env.DISABLE_UPDATER_AUTO_PATCHING)try{let t=(0,H.dirname)(process.execPath),e=(0,H.basename)(t),n=(0,H.join)(t,".."),r=(0,X.readdirSync)(n).reduce((f,d)=>d.startsWith("app-")&&Ul(d,f)?d:f,e);if(r===e)return;let i=(0,H.join)(n,e,"resources"),o=(0,H.join)(i,"app.asar"),a=(0,H.join)(n,r,"resources"),s=(0,H.join)(a,"app.asar"),l=(0,H.join)(a,"_app.asar");if(!(0,X.existsSync)(o)||!(0,X.existsSync)(s)||(0,X.existsSync)(l))return;console.info(`[Vencord] Detected Host Update (${e} -> ${r}). Repatching...`),(0,X.renameSync)(s,l),(0,X.copyFileSync)(o,s)}catch(t){console.error("[Vencord] Failed to repatch latest host update",t)}}var Po,X,H,Io=W(()=>{"use strict";c();Po=require("electron"),X=require("original-fs"),H=require("path");Po.app.on("before-quit",Gl)});var jl={};var I,ve,Wl,zl,ar,Bl,Ao=W(()=>{"use strict";c();To();I=vr(require("electron")),ve=require("path");te();Fe();console.log("[Vencord] Starting up...");Wl=require.main.filename,zl=require.main.path.endsWith("app.asar")?"_app.asar":"app.asar",ar=(0,ve.join)((0,ve.dirname)(Wl),"..",zl),Bl=require((0,ve.join)(ar,"package.json"));require.main.filename=(0,ve.join)(ar,Bl.main);I.app.setAppPath(ar);if(_t)console.log("[Vencord] Running in vanilla mode. Not loading Vencord");else{let t=C.store;if(Io(),t.winCtrlQ){let i=I.Menu.buildFromTemplate;I.Menu.buildFromTemplate=function(o){if(o[0]?.label==="&File"){let{submenu:a}=o[0];Array.isArray(a)&&a.push({label:"Quit (Hidden)",visible:!1,acceleratorWorksWhenHidden:!0,accelerator:"Control+Q",click:()=>I.app.quit()})}return i.call(this,o)}}class e extends I.default.BrowserWindow{constructor(o){if(!o?.webPreferences?.preload||!o.title){super(o);return}let{frameless:a,winNativeTitleBar:s,disableMinSize:l,transparent:f,macosVibrancyStyle:d,windowsMaterial:u}=t,v=o.webPreferences.preload;o.webPreferences.preload=(0,ve.join)(__dirname,"preload.js"),o.webPreferences.sandbox=!1,o.webPreferences.backgroundThrottling=!1,a?o.frame=!1:s&&delete o.frame,l&&(o.minWidth=0,o.minHeight=0),f&&(o.transparent=!0,o.backgroundColor="#00000000"),u&&u!=="none"&&(o.backgroundMaterial=u,o.backgroundColor="#00000000"),process.env.DISCORD_PRELOAD=v,super(o),l&&(this.setMinimumSize=(E,oe)=>{})}}Object.assign(e,I.default.BrowserWindow),Object.defineProperty(e,"name",{value:"BrowserWindow",configurable:!0});let n=require.resolve("electron");delete require.cache[n].exports,require.cache[n].exports={...I.default,BrowserWindow:e},Eo(global,"appSettings",i=>{i.set("DANGEROUS_ENABLE_DEVTOOLS_ONLY_ENABLE_IF_YOU_KNOW_WHAT_YOURE_DOING",!0)}),process.env.DATA_DIR=(0,ve.join)(I.app.getPath("userData"),"..","Vencord");let r=I.app.commandLine.appendSwitch;I.app.commandLine.appendSwitch=function(...i){if(i[0]==="disable-features"){let o=new Set((i[1]??"").split(","));o.add("UseEcoQoSForBackgroundProcess"),i[1]+=[...o].join(",")}return r.apply(this,i)},I.app.commandLine.appendSwitch("disable-renderer-backgrounding"),I.app.commandLine.appendSwitch("disable-background-timer-throttling"),I.app.commandLine.appendSwitch("disable-backgrounding-occluded-windows")}console.log("[Vencord] Loading original Discord app.asar");require(require.main.filename)});c();c();c();kr();c();Le();var jn=require("electron");c();var hn={};we(hn,{fetchTrackData:()=>Ho});c();c();c();var Er="ef29bbe";c();var pn="Vendicated/Vencord";var Tr=`Vencord/${Er}${pn?` (https://github.com/${pn})`:""}`;var Pr=require("child_process"),Ir=require("util"),Ar=(0,Ir.promisify)(Pr.execFile);async function fn(t){let{stdout:e}=await Ar("osascript",t.map(n=>["-e",n]).flat());return e}var z=null;async function jo({id:t,name:e,artist:n,album:r}){if(t===z?.id){if("data"in z)return z.data;if("failures"in z&&z.failures>=5)return null}try{let i=new URL("https://itunes.apple.com/search");i.searchParams.set("term",`${e} ${n} ${r}`),i.searchParams.set("media","music"),i.searchParams.set("entity","song");let o=await fetch(i,{headers:{"user-agent":Tr}}).then(s=>s.json()).then(s=>s.results.find(l=>l.collectionName===r)||s.results[0]),a=await fetch(o.artistViewUrl).then(s=>s.text()).then(s=>{let l=s.match(/<meta property="og:image" content="(.+?)">/);return l?l[1].replace(/[0-9]+x.+/,"220x220bb-60.png"):void 0}).catch(()=>{});return z={id:t,data:{appleMusicLink:o.trackViewUrl,appleMusicArtistLink:o.artistViewUrl,songLink:`https://song.link/i/${new URL(o.trackViewUrl).searchParams.get("i")}`,albumArtwork:o.artworkUrl100.replace("100x100","512x512"),artistArtwork:a}},z.data}catch(i){return console.error("[AppleMusicRichPresence] Failed to fetch remote data:",i),z={id:t,failures:(t===z?.id&&"failures"in z?z.failures:0)+1},null}}async function Ho(){try{await Ar("pgrep",["^Music$"])}catch{return null}if(await fn(['tell application "Music"',"get player state","end tell"]).then(d=>d.trim())!=="playing")return null;let e=await fn(['tell application "Music"',"get player position","end tell"]).then(d=>Number.parseFloat(d.trim())),n=await fn(['set output to ""','tell application "Music"',"set t_id to database id of current track","set t_name to name of current track","set t_album to album of current track","set t_artist to artist of current track","set t_duration to duration of current track",'set output to "" & t_id & "\\n" & t_name & "\\n" & t_album & "\\n" & t_artist & "\\n" & t_duration',"end tell","return output"]),[r,i,o,a,s]=n.split(`
`).filter(d=>!!d),l=Number.parseFloat(s),f=await jo({id:r,name:i,artist:a,album:o});return{name:i,album:o,artist:a,playerPosition:e,duration:l,...f}}var mn={};we(mn,{initDevtoolsOpenEagerLoad:()=>Ko});c();function Ko(t){let e=()=>t.sender.executeJavaScript("Vencord.Plugins.plugins.ConsoleShortcuts.eagerLoad(true)");t.sender.isDevToolsOpened()?e():t.sender.once("devtools-opened",()=>e())}var Fr={};c();te();var Lt=require("electron"),Dt=[];function Vr(){let t=[];for(let e=Dt.length-1;e>=0;e--){let{processId:n,routingId:r}=Dt[e],i=Lt.webFrameMain.fromId(n,r);if(!i){Dt.splice(e,1);continue}t.push(i)}return t}Lt.app.on("browser-window-created",(t,e)=>{e.webContents.on("frame-created",(n,{frame:r})=>{r?.once("dom-ready",()=>{if(r.url.startsWith("https://open.spotify.com/embed/")){Vr();let{routingId:i,processId:o}=r;Dt.push({routingId:i,processId:o});let a=C.store.plugins?.FixSpotifyEmbeds;if(!a?.enabled)return;r.executeJavaScript(`
                    globalThis._vcVolume = ${a.volume/100};
                    const original = Audio.prototype.play;
                    Audio.prototype.play = function() {
                        this.volume = _vcVolume;
                        return original.apply(this, arguments);
                    }
                `)}})})});C.addChangeListener("plugins.FixSpotifyEmbeds.volume",t=>{try{Vr().forEach(e=>e.executeJavaScript(`globalThis._vcVolume = ${t/100}`))}catch(e){console.error("FixSpotifyEmbeds: Failed to update volume",e)}});var Ur={};c();te();var Nr=require("electron");Nr.app.on("browser-window-created",(t,e)=>{e.webContents.on("frame-created",(n,{frame:r})=>{r?.once("dom-ready",()=>{if(r.url.startsWith("https://www.youtube.com/")){if(!C.store.plugins?.FixYoutubeEmbeds?.enabled)return;r.executeJavaScript(`
                new MutationObserver(() => {
                    if(
                        document.querySelector('div.ytp-error-content-wrap-subreason a[href*="www.youtube.com/watch?v="]')
                    ) location.reload()
                }).observe(document.body, { childList: true, subtree:true });
                `)}})})});var Sn={};we(Sn,{resolveRedirect:()=>Yo});c();var Gr=require("https"),qo=/^https:\/\/(spotify\.link|s\.team)\/.+$/;function $r(t){return new Promise((e,n)=>{let r=(0,Gr.request)(new URL(t),{method:"HEAD"},i=>{e(i.headers.location?$r(i.headers.location):t)});r.on("error",n),r.end()})}async function Yo(t,e){return qo.test(e)?$r(e):e}var xn={};we(xn,{makeDeeplTranslateRequest:()=>Jo,makeKagiTranslateRequest:()=>Xo});c();async function Jo(t,e,n,r){let i=e?"https://api.deepl.com/v2/translate":"https://api-free.deepl.com/v2/translate";try{let o=await fetch(i,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`DeepL-Auth-Key ${n}`},body:r}),a=await o.text();return{status:o.status,data:a}}catch(o){return{status:-1,data:String(o)}}}async function Xo(t,e,n,r,i){let o="https://translate.kagi.com/api/translate";try{let a=await fetch(o,{method:"POST",headers:{"Content-Type":"application/json",Cookie:`kagi_session=${e}`},body:JSON.stringify({text:n,from:r,to:i,model:"standard"})}),s=await a.json();return{status:a.status,data:s}}catch(a){return{status:-1,data:String(a)}}}var kn={};we(kn,{readRecording:()=>Qo});c();var Wr=require("electron"),Ot=require("fs/promises"),at=require("path");async function Qo(t,e){e=(0,at.normalize)(e);let n=(0,at.basename)(e),r=(0,at.normalize)(Wr.app.getPath("userData")+"/");if(!/^\d*recording\.ogg$/.test(n)||!e.startsWith(r))return null;try{let i=await(0,Ot.readFile)(e);return(0,Ot.rm)(e).catch(()=>{}),new Uint8Array(i.buffer)}catch{return null}}var En={};we(En,{closeSocket:()=>ta,sendToOverlay:()=>ea});c();var zr=require("dgram"),Vt=null;function ea(t,e){e.messageType=e.type;let n=JSON.stringify(e);Vt??=(0,zr.createSocket)("udp4"),Vt.send(n,42069,"127.0.0.1")}function ta(){Vt?.close(),Vt=null}var jr={};c();te();var Br=require("electron");c();var Tn=`"use strict";(()=>{if(window.adguardInjected)return;window.adguardInjected=!0;const c=["#__ffYoutube1","#__ffYoutube2","#__ffYoutube3","#__ffYoutube4","#feed-pyv-container","#feedmodule-PRO","#homepage-chrome-side-promo","#merch-shelf","#offer-module",'#pla-shelf > ytd-pla-shelf-renderer[class="style-scope ytd-watch"]',"#pla-shelf","#premium-yva","#promo-info","#promo-list","#promotion-shelf","#related > ytd-watch-next-secondary-results-renderer > #items > ytd-compact-promoted-video-renderer.ytd-watch-next-secondary-results-renderer","#search-pva","#shelf-pyv-container","#video-masthead","#watch-branded-actions","#watch-buy-urls","#watch-channel-brand-div","#watch7-branded-banner","#YtKevlarVisibilityIdentifier","#YtSparklesVisibilityIdentifier",".carousel-offer-url-container",".companion-ad-container",".GoogleActiveViewElement",'.list-view[style="margin: 7px 0pt;"]',".promoted-sparkles-text-search-root-container",".promoted-videos",".searchView.list-view",".sparkles-light-cta",".watch-extra-info-column",".watch-extra-info-right",".ytd-carousel-ad-renderer",".ytd-compact-promoted-video-renderer",".ytd-companion-slot-renderer",".ytd-merch-shelf-renderer",".ytd-player-legacy-desktop-watch-ads-renderer",".ytd-promoted-sparkles-text-search-renderer",".ytd-promoted-video-renderer",".ytd-search-pyv-renderer",".ytd-video-masthead-ad-v3-renderer",".ytp-ad-action-interstitial-background-container",".ytp-ad-action-interstitial-slot",".ytp-ad-image-overlay",".ytp-ad-overlay-container",".ytp-ad-progress",".ytp-ad-progress-list",'[class*="ytd-display-ad-"]','[layout*="display-ad-"]','a[href^="http://www.youtube.com/cthru?"]','a[href^="https://www.youtube.com/cthru?"]',"ytd-action-companion-ad-renderer","ytd-banner-promo-renderer","ytd-compact-promoted-video-renderer","ytd-companion-slot-renderer","ytd-display-ad-renderer","ytd-promoted-sparkles-text-search-renderer","ytd-promoted-sparkles-web-renderer","ytd-search-pyv-renderer","ytd-single-option-survey-renderer","ytd-video-masthead-ad-advertiser-info-renderer","ytd-video-masthead-ad-v3-renderer","YTM-PROMOTED-VIDEO-RENDERER"],l=()=>{const e=c;if(!e)return;const t=e.join(", ")+" { display: none!important; }",r=document.createElement("style");r.textContent=t,document.head.appendChild(r)},p=e=>{new MutationObserver(r=>{e(r)}).observe(document.documentElement,{childList:!0,subtree:!0})},a=()=>{const e=document.querySelectorAll("#contents > ytd-rich-item-renderer ytd-display-ad-renderer");e.length!==0&&e.forEach(t=>{if(t.parentNode&&t.parentNode.parentNode){const r=t.parentNode.parentNode;r.localName==="ytd-rich-item-renderer"&&(r.style.display="none")}})},s=()=>{if(document.querySelector(".ad-showing")){const e=document.querySelector("video");e&&e.duration&&(e.currentTime=e.duration,setTimeout(()=>{const t=document.querySelector("button.ytp-ad-skip-button");t&&t.click()},100))}},d=(e,t,r)=>{if(!e)return!1;let n=!1;for(const o in e)e.hasOwnProperty(o)&&o===t?(e[o]=r,n=!0):e.hasOwnProperty(o)&&typeof e[o]=="object"&&d(e[o],t,r)&&(n=!0);return n},i=(e,t)=>{const r=JSON.parse;JSON.parse=(...n)=>{const o=r.apply(this,n);return d(o,e,t),o},Response.prototype.json=new Proxy(Response.prototype.json,{async apply(...n){const o=await Reflect.apply(...n);return d(o,e,t),o}})};i("adPlacements",[]),i("playerAds",[]),l(),a(),s(),p(()=>{a(),s()})})();
`;Br.app.on("browser-window-created",(t,e)=>{e.webContents.on("frame-created",(n,{frame:r})=>{r?.once("dom-ready",()=>{C.store.plugins?.YoutubeAdblock?.enabled&&(r.url.includes("youtube.com/embed/")?r.executeJavaScript(Tn):r.parent?.url.includes("youtube.com/embed/")&&r.parent.executeJavaScript(Tn))})})});var Bn={};we(Bn,{answerOverlayAction:()=>Ys,armDisplayMedia:()=>Ss,checkUpdate:()=>nl,closeStudioOverlay:()=>Hs,deleteClip:()=>Qa,disarmDisplayMedia:()=>xs,downloadUpdate:()=>il,dropOverlayWaiters:()=>qs,focusClient:()=>Js,gameFeedStatus:()=>As,getActiveScreen:()=>bs,getCaptureSources:()=>ys,getClipDirectory:()=>hs,getMemoryReport:()=>ws,getPlatformInfo:()=>vs,hideClipOverlay:()=>$s,hideVrPanel:()=>Os,listClips:()=>Ja,notifyClipSaved:()=>Gs,openClipDirectory:()=>gs,openStudioOverlay:()=>js,openVrBindings:()=>Ds,pickAudioFiles:()=>as,pickClipDirectory:()=>ms,pickImageFiles:()=>cs,pickVideoFiles:()=>rs,readAudioFile:()=>ls,readClip:()=>Xa,readImageFile:()=>ps,readLibrary:()=>ts,readVideoFile:()=>os,readVoiceTrack:()=>qa,registerShortcuts:()=>Es,relaunchClient:()=>ol,renameClip:()=>es,reserveClipPath:()=>ja,revealClip:()=>fs,saveClip:()=>Ba,saveVoiceTrack:()=>Za,showClipOverlay:()=>Us,showVrPanel:()=>Ls,startGameFeeds:()=>Ps,startVrBridge:()=>Rs,stopGameFeeds:()=>Is,stopVrBridge:()=>Ms,studioOverlayUp:()=>Ks,unregisterShortcuts:()=>zn,vrBridgeStatus:()=>_s,waitForGameEvent:()=>Cs,waitForOverlayAction:()=>Zs,waitForShortcut:()=>Ts,waitForVrEvent:()=>Vs,writeLibrary:()=>ns});c();var _i=require("crypto"),y=require("electron"),p=require("fs"),Di=require("https"),h=require("path");c();var B=require("fs"),Zr=require("http"),qr=require("https"),Yr=require("os"),pt=require("path"),Hr=34765,na=6,Jr=256*1024,ra=2e3,ia=1500,oa="127.0.0.1",aa=2999,sa="gamestate_integration_clipper.cfg",ue=null,Ue=0,Nt="",Ge=null,ut=[],la=12,dt=[],$e=[],We={cs2:!1,league:!1};function Ut(t){ut.length>=la||ut.includes(t)||ut.push(t)}var Gt=Promise.resolve();function st(t){let e=$e.shift();if(e){e(t);return}dt.push(t),dt.length>16&&dt.shift()}var S={kills:-1,deaths:-1,round:-1,roundKills:0,announced:0};function Xr(){S={kills:-1,deaths:-1,round:-1,roundKills:0,announced:0}}function ca(t){return t>=5?"an ace in Counter-Strike 2":t===4?"a 4K in Counter-Strike 2":"a 3K in Counter-Strike 2"}function ua(t){let e=t.provider?.steamid,{player:n}=t;if(!n||!e||!n.steamid||n.steamid!==e)return;let r=n.match_stats;if(!r||typeof r.kills!="number"||typeof r.deaths!="number")return;let i=typeof t.map?.round=="number"?t.map.round:S.round;(r.kills<S.kills||r.deaths<S.deaths)&&Xr();let o=S.kills<0;i!==S.round&&(S.round=i,S.roundKills=0,S.announced=0);let a=r.kills-Math.max(0,S.kills),s=r.deaths-Math.max(0,S.deaths);if(S.kills=r.kills,S.deaths=r.deaths,o)return;a>0&&(S.roundKills+=a,S.roundKills>=3&&S.roundKills>S.announced?(S.announced=S.roundKills,st({kind:"multikill",note:ca(S.roundKills)})):st({kind:"kill",note:a>1?"a double kill in Counter-Strike 2":"a kill in Counter-Strike 2"})),s>0&&st({kind:"death",note:"your death in Counter-Strike 2"});let l=t.round?.win_team;l&&n.team&&l===n.team&&t.round?.phase==="over"&&S.roundKills>0&&st({kind:"roundwin",note:"a round you won in Counter-Strike 2"})}function da(){return new Promise(t=>{let e=0,n=(0,Zr.createServer)((r,i)=>{if(r.method!=="POST"){i.writeHead(405).end();return}let o="",a=!1;r.setEncoding("utf8"),r.on("data",s=>{a||(o+=s,o.length>Jr&&(a=!0,o="",r.destroy()))}),r.on("end",()=>{if(i.writeHead(200).end(),!a)try{ua(JSON.parse(o))}catch{}}),r.on("error",()=>{})});n.on("error",r=>{if(r.code==="EADDRINUSE"&&++e<na){n.listen(Hr+e,"127.0.0.1");return}Ut(`The Counter-Strike listener could not open a port (${r.code??r.message})`);try{n.close()}catch{}ue===n&&(ue=null,Ue=0,We={...We,cs2:!1}),t(0)}),n.on("listening",()=>{ue=n,t(n.address().port)}),n.listen(Hr,"127.0.0.1")})}function pa(){let t=[],e=(0,Yr.homedir)();{let r=[process.env["ProgramFiles(x86)"],process.env.ProgramW6432,process.env.ProgramFiles];for(let i of r)i&&t.push((0,pt.join)(i,"Steam"))}let n=[];for(let r of t)if((0,B.existsSync)(r)){n.push(r);try{let i=(0,B.readFileSync)((0,pt.join)(r,"steamapps","libraryfolders.vdf"),"utf8");for(let o of i.matchAll(/"path"\s+"([^"]+)"/g)){let a=o[1].replace(/\\\\/g,"\\");a&&!n.includes(a)&&n.push(a)}}catch{}}return n}function fa(){for(let t of pa()){let e=(0,pt.join)(t,"steamapps","common","Counter-Strike Global Offensive","game","csgo","cfg");if((0,B.existsSync)(e))return e}return""}function ha(t){let e=fa();if(!e)return Ut("Counter-Strike 2 is not installed where Steam usually puts it, so its config was not written"),"";let n=(0,pt.join)(e,sa),r=`"Clipper"
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
`;try{return(0,B.mkdirSync)(e,{recursive:!0}),(0,B.writeFileSync)(n,r,"utf8"),n}catch(i){return Ut(`Counter-Strike 2's config could not be written (${i.message})`),""}}function ma(){let t=Nt;if(Nt="",!!t)try{(0,B.unlinkSync)(t)}catch{}}var lt="",Ne=-1,Pn=!1,Ft=!1;function ct(t){return t.split("#")[0].trim().toLowerCase()}function Kr(t){return new Promise(e=>{let n=(0,qr.get)({host:oa,port:aa,path:t,rejectUnauthorized:!1,timeout:ia},r=>{if(r.statusCode!==200){r.resume(),e(null);return}let i="";r.setEncoding("utf8"),r.on("data",o=>{i+=o,i.length>Jr&&n.destroy()}),r.on("end",()=>{try{e(JSON.parse(i))}catch{e(null)}})});n.on("timeout",()=>n.destroy()),n.on("error",()=>e(null))})}function ga(t,e){let n=t.EventName??"",r=ct(t.KillerName??"");switch(n){case"ChampionKill":return r===e?{kind:"kill",note:"a kill in League of Legends"}:ct(t.VictimName??"")===e?{kind:"death",note:"your death in League of Legends"}:null;case"Multikill":return r!==e?null:{kind:"multikill",note:`a ${t.KillStreak??3}-kill run in League of Legends`};case"Ace":return ct(t.Acer??"")!==e?null:{kind:"multikill",note:"an ace in League of Legends"};case"FirstBlood":return ct(t.Recipient??"")!==e?null:{kind:"kill",note:"first blood in League of Legends"};case"DragonKill":return r!==e?null:{kind:"objective",note:`${t.DragonType?`the ${t.DragonType.toLowerCase()} dragon`:"a dragon"} in League of Legends`};case"BaronKill":return r!==e?null:{kind:"objective",note:"baron in League of Legends"};case"HeraldKill":return r!==e?null:{kind:"objective",note:"the herald in League of Legends"};case"TurretKilled":case"InhibKilled":return r!==e?null:{kind:"objective",note:"a structure in League of Legends"};default:return null}}async function va(){if(!Ft){Ft=!0;try{if(!lt){let r=await Kr("/liveclientdata/activeplayername");if(typeof r!="string"||!r)return;lt=ct(r),Ne=-1}let t=await Kr("/liveclientdata/eventdata");if(!t?.Events){lt="";return}let e=Ne<0,n=Ne;for(let r of t.Events){let i=typeof r.EventID=="number"?r.EventID:-1;if(i<=Ne||(n=Math.max(n,i),e))continue;let o=ga(r,lt);o&&st(o)}Ne=n}finally{Ft=!1}}}function ya(){lt="",Ne=-1,Ft=!1,Ge=setInterval(()=>{va().catch(t=>{Pn||(Pn=!0,Ut(`League of Legends could not be read (${t.message})`))})},ra)}function wa(t){return t.cs2!==We.cs2||t.league!==We.league?!1:(!t.cs2||ue!==null)&&(!t.league||Ge!==null)}function Qr(t){let e=Gt.then(async()=>(wa(t)||(ei(),ut=[],t.cs2&&(Xr(),Ue=await da(),Ue&&(Nt=ha(Ue))),t.league&&ya(),We={cs2:t.cs2&&ue!==null,league:t.league}),$t()));return Gt=e.catch(()=>{}),e}function ei(){if(We={cs2:!1,league:!1},Ge&&clearInterval(Ge),Ge=null,Pn=!1,ue)try{ue.close()}catch{}ue=null,Ue=0,ma(),dt=[];let t=$e;$e=[];for(let e of t)e(null)}function In(){let t=Gt.then(()=>ei());return Gt=t.catch(()=>{}),t}function $t(){return{port:Ue,configPath:Nt,league:Ge!==null,problems:[...ut]}}function ti(t){let e=dt.shift();return e?Promise.resolve(e):new Promise(n=>{let r=!1,i=a=>{r||(r=!0,clearTimeout(o),n(a))},o=setTimeout(()=>{$e=$e.filter(a=>a!==i),i(null)},t);$e.push(i)})}c();var de=require("electron"),Bt=require("fs"),ht=require("path"),ni=require("url"),Wt=24,ri=2600,zt=220,ba=300,Sa=56,An=!0;function jt(){return An}var Ee=null,xe=null,ft=null,ke=null;function xa(){return!!Ee&&!Ee.isDestroyed()}function Te(){xe&&(clearTimeout(xe),xe=null);let t=Ee;Ee=null,t&&!t.isDestroyed()&&t.destroy()}function ze(){ke&&(clearTimeout(ke),ke=null);let t=ft;ft=null,t&&!t.isDestroyed()&&t.destroy()}function ka(t,e,n){let i=de.screen.getDisplayNearestPoint(de.screen.getCursorScreenPoint()).workArea,o=t==="top-left"||t==="bottom-left",a=t==="top-left"||t==="top-right";return{x:Math.round(o?i.x+Wt:i.x+i.width-e-Wt),y:Math.round(a?i.y+Wt:i.y+i.height-n-Wt)}}function mt(t,e){let n=(0,ht.join)(de.app.getPath("userData"),"clipper-overlay");(0,Bt.mkdirSync)(n,{recursive:!0});let r=(0,ht.join)(n,t);return(0,Bt.writeFileSync)(r,e,"utf8"),r}function ii(t,e,n,r){let{x:i,y:o}=ka(r,e,n),a=new de.BrowserWindow({width:e,height:n,x:i,y:o,frame:!1,transparent:!0,backgroundColor:"#00000000",resizable:!1,movable:!1,minimizable:!1,maximizable:!1,fullscreenable:!1,skipTaskbar:!0,focusable:!1,hasShadow:!1,alwaysOnTop:!0,show:!1,webPreferences:{nodeIntegration:!1,contextIsolation:!0,sandbox:!0,backgroundThrottling:!1}});return a.setAlwaysOnTop(!0,"screen-saver"),a.setVisibleOnAllWorkspaces(!0,{visibleOnFullScreen:!0}),a.setIgnoreMouseEvents(!0,{forward:!0}),a.loadFile(t).then(()=>{a.isDestroyed()||a.showInactive()}).catch(()=>{a.isDestroyed()||a.destroy()}),a}function oi(t){return`<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src file:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
    html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
    .card {
        position: absolute; inset: 0; border-radius: 12px; overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.14); box-shadow: 0 10px 34px rgba(0, 0, 0, 0.6);
        opacity: 0; transform: scale(0.96); transition: opacity ${zt}ms ease, transform ${zt}ms ease;
    }
    .card.up { opacity: 1; transform: none; }
    ${t}
</style>`}function Z(t){return JSON.stringify(t).replace(/</g,"\\u003c")}function Ea(t,e){return`<!doctype html>
<html>
<head>
${oi(`.card { background: #000; }
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
    var look = ${Z(e)};
    var video = document.getElementById("video");
    var card = document.getElementById("card");
    document.getElementById("tag").textContent = ${Z((0,ht.basename)(t))};

    var leaving = false;
    function leave() {
        if (leaving) return;
        leaving = true;
        card.classList.remove("up");
        setTimeout(function () { window.close(); }, ${zt});
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

    video.src = ${Z((0,ni.pathToFileURL)(t).href)};

    // Autoplay with sound is only allowed after a gesture, and this window
    // never gets one. Muted playback is always allowed, so it is the fallback
    // rather than a reason to show nothing.
    video.play().catch(function () {
        video.muted = true;
        video.play().catch(leave);
    });
</script>
</body>
</html>`}function Ta(t,e){return`<!doctype html>
<html>
<head>
${oi(`.card {
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
    document.getElementById("title").textContent = ${Z(t)};
    document.getElementById("note").textContent = ${Z(e)};

    requestAnimationFrame(function () { card.classList.add("up"); });

    setTimeout(function () {
        card.classList.remove("up");
        setTimeout(function () { window.close(); }, ${zt});
    }, ${ri});
</script>
</body>
</html>`}function ai(t,e){if(!An)return!1;Te(),ze();let n=Math.max(200,Math.round(e.width)),r=Math.round(n*9/16),i=ii(mt("clip.html",Ea(t,e)),n,r,e.corner);Ee=i,i.on("closed",()=>{Ee===i&&(Ee=null,xe&&(clearTimeout(xe),xe=null))});let o=(e.seconds>0?e.seconds:300)+10;return xe=setTimeout(()=>Te(),o*1e3),!0}function si(t,e,n){if(!An||xa())return!1;ze();let r=ii(mt("toast.html",Ta(t,e)),ba,Sa,n);return ft=r,r.on("closed",()=>{ft===r&&(ft=null,ke&&(clearTimeout(ke),ke=null))}),ke=setTimeout(()=>ze(),ri+4e3),!0}de.app.on("will-quit",()=>{Te(),ze()});c();var q=require("electron"),li=require("url");var Cn="VencordClipperOverlayAction",ci="VencordClipperOverlayReply",Pa=108,M=null;function Rn(){return!!M&&!M.isDestroyed()}function vt(){let t=M;M=null,t&&!t.isDestroyed()&&t.destroy()}var Be=[],gt=[];function Ia(t){let e=Be.shift();if(e){e(t);return}gt.push(t),gt.length>4&&gt.shift()}function ui(t){let e=gt.shift();return e?Promise.resolve(e):new Promise(n=>{let r=!1,i=a=>{r||(r=!0,clearTimeout(o),n(a))},o=setTimeout(()=>{Be=Be.filter(a=>a!==i),i(null)},t);Be.push(i)})}function di(){gt=[];let t=Be;Be=[];for(let e of t)e(null)}function pi(t){!M||M.isDestroyed()||M.webContents.send(ci,t)}q.ipcMain.removeAllListeners(Cn);q.ipcMain.on(Cn,(t,e,n)=>{if(!M||M.isDestroyed()||t.sender!==M.webContents)return;let r=String(e??"");if(r==="close"){vt();return}if(r!=="cut"&&r!=="send"&&r!=="delete"&&r!=="open")return;let i=n??{},o=Number(i.from),a=Number(i.to);Ia({kind:r,clip:String(i.clip??""),from:Number.isFinite(o)?Math.max(0,o):0,to:Number.isFinite(a)?Math.max(0,a):0})});function Aa(t,e){let{workArea:n}=q.screen.getDisplayNearestPoint(q.screen.getCursorScreenPoint());return{x:Math.round(n.x+(n.width-t)/2),y:Math.round(n.y+(n.height-e)/2)}}var Ca=`"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("clipper", {
    act(kind, payload) {
        ipcRenderer.send(${Z(Cn)}, String(kind), payload);
    },
    onReply(handler) {
        ipcRenderer.on(${Z(ci)}, (_event, reply) => handler(reply));
    }
});
`;function Ra(t,e){return`<!doctype html>
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
    var clip = ${Z({name:t.name,url:(0,li.pathToFileURL)(t.path).href,markers:t.markers})};
    var look = ${Z(e)};
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
</html>`}function fi(t,e){if(!jt())return!1;vt(),Te(),ze();let n=Math.max(360,Math.round(e.width)),r=Math.round(n*9/16)+Pa,{x:i,y:o}=Aa(n,r),a=mt("studio-preload.js",Ca),s=mt("studio.html",Ra(t,e)),l=new q.BrowserWindow({width:n,height:r,x:i,y:o,frame:!1,transparent:!0,backgroundColor:"#00000000",resizable:!1,movable:!1,minimizable:!1,maximizable:!1,fullscreenable:!1,skipTaskbar:!0,hasShadow:!1,alwaysOnTop:!0,show:!1,webPreferences:{preload:a,nodeIntegration:!1,contextIsolation:!0,sandbox:!0,backgroundThrottling:!1}});return M=l,l.setAlwaysOnTop(!0,"screen-saver"),l.setVisibleOnAllWorkspaces(!0,{visibleOnFullScreen:!0}),l.on("closed",()=>{M===l&&(M=null)}),l.loadFile(s).then(()=>{l.isDestroyed()||(l.show(),l.focus())}).catch(()=>{l.isDestroyed()||l.destroy()}),!0}q.app.on("will-quit",()=>vt());c();function yt(t){return`${t.replace(/\.(webm|mp4)$/i,"")}.thumb.jpg`}c();var xi=require("child_process"),ki=require("electron"),On=require("fs"),kt=require("path");c();var Ma=`
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
                    string command = TakeCommand();

                    // IVRInput index 32, OpenBindingUI: SteamVR's own binding
                    // panel, opened on our action set. Shown on the desktop as
                    // well as in the headset, because the person who just
                    // clicked the button in Discord is looking at a monitor.
                    if (command == "bindings") openBindings(appKey, setHandle, 0, true);

                    // A picture to put in front of the player's eyes, painted
                    // in the browser and left in a file because a few hundred
                    // kilobytes of pixels do not belong on a line-by-line pipe.
                    else if (command.StartsWith("panel ")) until = ShowPanel(overlay, panel, command);
                    else if (command == "panelhide") { HidePanel(overlay, panel); until = DateTime.MinValue; }

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
`,hi=`# Vencord Clipper - SteamVR bridge. Generated; edits are overwritten.
param(
    [Parameter(Mandatory = $true)][string] $Api,
    [Parameter(Mandatory = $true)][string] $Actions,
    [Parameter(Mandatory = $true)][string] $Manifest,
    [Parameter(Mandatory = $true)][string] $AppKey,
    [Parameter(Mandatory = $true)][string] $ActionList
)

$ErrorActionPreference = "Stop"

$source = @'
${Ma}
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
`;c();var gi=require("electron"),N=require("fs"),F=require("path"),Ht="vencord.clipper",pe="/actions/clipper",wt=["save","mark","toggle","pov"],_a=["save","mark"],Da={save:"Save a clip",mark:"Drop a marker",toggle:"Start / stop the clip buffer",pov:"Ask the call for their angle"};function Mn(){let t=(0,F.join)(gi.app.getPath("userData"),"clipper-vr");return(0,N.mkdirSync)(t,{recursive:!0}),t}function La(){let t=(0,F.join)(process.env.LOCALAPPDATA??"","openvr","openvrpaths.vrpath");try{let n=JSON.parse((0,N.readFileSync)(t,"utf8")).runtime;if(Array.isArray(n)){for(let r of n)if(typeof r=="string"&&(0,N.existsSync)((0,F.join)(r,"bin","win64","openvr_api.dll")))return r}}catch{}let e=(0,F.join)(process.env["ProgramFiles(x86)"]??"C:\\Program Files (x86)","Steam","steamapps","common","SteamVR");return(0,N.existsSync)((0,F.join)(e,"bin","win64","openvr_api.dll"))?e:null}function vi(){let t=La();return t&&(0,F.join)(t,"bin","win64","openvr_api.dll")}var Oa=.4,Va={save:"double",mark:"long"};function Fa(t,e,n){return{path:t,mode:"button",inputs:{[e]:{output:`${pe}/in/${n}`}},parameters:e==="long"?{long_press_delay:Oa}:{}}}function mi(t,e){return{app_key:Ht,controller_type:t,description:"Where Clipper's two default binds start out. Change them here, and add the rest.",name:"Clipper defaults",action_manifest_version:0,bindings:{[pe]:{sources:_a.map(n=>Fa(e[n],Va[n],n))}}}}function yi(){let t=Mn(),e={language_tag:"en_US",[pe]:"Clipper"};for(let o of wt)e[`${pe}/in/${o}`]=Da[o];let n={default_bindings:[{controller_type:"knuckles",binding_url:"bindings_knuckles.json"},{controller_type:"oculus_touch",binding_url:"bindings_oculus_touch.json"}],action_sets:[{name:pe,usage:"leftright"}],actions:wt.map(o=>({name:`${pe}/in/${o}`,type:"boolean",requirement:"optional"})),localization:[e]},r={save:"/user/hand/right/input/b",mark:"/user/hand/right/input/a"};(0,N.writeFileSync)((0,F.join)(t,"bindings_knuckles.json"),JSON.stringify(mi("knuckles",r),null,4),"utf8"),(0,N.writeFileSync)((0,F.join)(t,"bindings_oculus_touch.json"),JSON.stringify(mi("oculus_touch",r),null,4),"utf8");let i=(0,F.join)(t,"actions.json");return(0,N.writeFileSync)(i,JSON.stringify(n,null,4),"utf8"),i}function wi(t){let e={source:"builtin",applications:[{app_key:Ht,launch_type:"binary",binary_path_windows:t,is_dashboard_overlay:!1,strings:{en_us:{name:"Clipper",description:"Clip what just happened, from the controller."}}}]},n=(0,F.join)(Mn(),"clipper.vrmanifest");return(0,N.writeFileSync)(n,JSON.stringify(e,null,4),"utf8"),n}function _n(){return(0,F.join)(Mn(),"bridge.ps1")}var Na=15e3,Ua=45e3,bi=3,Ga=3,$a=2e3,D=null,xt=!1,ne="",_="",Pe="",Ie=!1,Ln=0,Ei=0,je=null,bt=[],St=null,fe=[],Kt=Promise.resolve();function Si(t){let e=fe.shift();if(e){e(t);return}if(t.kind==="motion"){St=t;return}bt.push(t.action),bt.length>8&&bt.shift()}function Wa(t){let e=t.trim();if(!e.startsWith("{"))return!1;let n;try{n=JSON.parse(e)}catch{return!1}if(n.t==="ready")return ne=String(n.runtime??""),_="",Pe="",Ie=!1,!0;if(n.t==="waiting")return ne="",_="",Pe=String(n.reason??""),!0;if(n.t==="warning")return _=String(n.message??"The SteamVR bridge reported something wrong without saying what"),!0;if(n.t==="error")return _=String(n.message??"The SteamVR bridge failed for a reason it did not give"),Ie=!ne||++Ei>=Ga,!0;if(n.t==="action"){let r=wt.find(i=>i===n.name);return r&&Si({kind:"action",action:r}),!1}return n.t==="motion"&&Si({kind:"motion",hands:Number(n.hands)||0,head:Number(n.head)||0}),!1}function Dn(){je||!xt||Ie||(je=setTimeout(()=>{je=null,xt&&Ti()},Na))}function Ti(){if(D)return Promise.resolve();let t=vi();if(!t)return Dn(),Promise.resolve();let e;try{let n=_n();(0,On.writeFileSync)(n,hi,"utf8");let r=(0,kt.join)(process.env.SystemRoot??"C:\\Windows","System32","WindowsPowerShell","v1.0","powershell.exe");e=(0,xi.spawn)(r,["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",n,"-Api",t,"-Actions",yi(),"-Manifest",wi(r),"-AppKey",Ht,"-ActionList",[pe,...wt].join("|")],{windowsHide:!0,stdio:["pipe","pipe","pipe"]})}catch(n){return _=`The SteamVR bridge could not be started (${n.message}).`,Dn(),Promise.resolve()}return D=e,ne="",Pe="",Ie=!1,new Promise(n=>{let r=!1,i=()=>{r||(r=!0,clearTimeout(o),n())},o=setTimeout(()=>{_="The SteamVR bridge did not come up. Compiling it may have failed; nothing else is affected.",i()},Ua),a="";e.stdout?.on("data",s=>{a+=s.toString("utf8");let l=a.split(`
`);a=l.pop()??"";for(let f of l)Wa(f)&&i()}),e.stderr?.on("data",s=>{_||(_=s.toString("utf8").trim().slice(0,300))}),e.on("error",s=>{_=`The SteamVR bridge could not be started (${s.message}).`,i()}),e.on("exit",()=>{D===e&&(!ne&&!Pe&&!Ie?++Ln>=bi&&(Ie=!0,_||(_=`The SteamVR bridge stopped ${bi} times without saying why. Switch the VR controls off and on again to try it once more.`)):Ln=0,D=null,ne="",Pe="");let s=fe;fe=[];for(let l of s)l(null);i(),Dn()})})}function Pi(){je&&(clearTimeout(je),je=null);let t=D;D=null,ne="",Pe="",Ie=!1,Ln=0,Ei=0,bt=[],St=null;let e=fe;fe=[];for(let r of e)r(null);if(!t)return;try{t.stdin?.end()}catch{}let n=setTimeout(()=>{try{t.kill()}catch{}},$a);t.on("exit",()=>clearTimeout(n))}function Ii(t){let e=Kt.then(async()=>(xt=t,t?(await Ti(),Zt()):(Pi(),_="",Zt())));return Kt=e.catch(()=>{}),e}function Vn(){let t=Kt.then(()=>{xt=!1,Pi()});return Kt=t.catch(()=>{}),t}function Zt(){return{running:D!==null&&ne!=="",wanted:xt,runtime:ne,problem:_,waiting:Pe}}function Ai(){if(!D?.stdin?.writable)return!1;try{return D.stdin.write(`bindings
`),!0}catch{return!1}}var za=0;function Ci(t,e,n,r){if(!D?.stdin?.writable||e<=0||n<=0||t.length!==e*n*4)return!1;let i=(0,kt.join)((0,kt.dirname)(_n()),`panel-${za++%8}.rgba`);try{return(0,On.writeFileSync)(i,t),D.stdin.write(`panel ${e} ${n} ${Math.round(r)} ${i}
`),!0}catch{return!1}}function Ri(){if(!D?.stdin?.writable)return!1;try{return D.stdin.write(`panelhide
`),!0}catch{return!1}}function Mi(t=3e4){let e=bt.shift();if(e)return Promise.resolve({kind:"action",action:e});if(St){let n=St;return St=null,Promise.resolve(n)}return new Promise(n=>{let r=!1,i=a=>{r||(r=!0,clearTimeout(o),n(a))},o=setTimeout(()=>{fe=fe.filter(a=>a!==i),i(null)},t);fe.push(i)})}ki.app.on("will-quit",()=>{Vn()});var Li=!0,$n=!1,Oi=/vesktop|equibop/i.test(y.app.getName());function x(t){let e=t?.trim();return e&&(0,h.isAbsolute)(e)?e:(0,h.join)(y.app.getPath("videos"),"DiscordClips")}function Ze(t){let n=(0,h.basename)(String(t??"").replace(/[\\/]/g,"_")).trim().replace(/[<>:"|?*\x00-\x1f]/g,"_").replace(/^\.+/,""),r=/^([\w.\-+ ()[\]]{1,120})\.(webm|mp4|png|jpg|gif)$/i.exec(n);return r?`${r[1]}.${r[2].toLowerCase()}`:null}function qe(t){return Ze(t)??`clip-${Date.now()}.webm`}function Wn(t,e){let n=(0,h.extname)(e),r=e.slice(0,e.length-n.length),i=(0,h.join)(t,e);for(let o=2;(0,p.existsSync)(i)&&o<1e3;o++)i=(0,h.join)(t,`${r} (${o})${n}`);return i}function Ba(t,e,n,r,i=!1){let o=x(e);(0,p.mkdirSync)(o,{recursive:!0});let a=qe(n),s=i?Wn(o,a):(0,h.join)(o,a);return(0,p.writeFileSync)(s,Buffer.from(r)),s}function ja(t,e,n){let r=x(e);return(0,p.mkdirSync)(r,{recursive:!0}),Wn(r,qe(n))}var qt="voices";function Ha(t,e){let n=Ze(t);return!n||!/^\d{1,25}$/.test(String(e??""))?null:`${n.slice(0,n.length-(0,h.extname)(n).length)}.${e}.webm`}function Ka(t,e){let n=Ze(e);if(!n)return[];let r=(0,h.join)(x(t),qt);if(!(0,p.existsSync)(r))return[];let i=`${n.slice(0,n.length-(0,h.extname)(n).length)}.`,o=[];for(let a of(0,p.readdirSync)(r,{withFileTypes:!0})){if(!a.isFile()||!a.name.startsWith(i)||!a.name.toLowerCase().endsWith(".webm"))continue;let s=a.name.slice(i.length,a.name.length-5);/^\d{1,25}$/.test(s)&&o.push({userId:s,file:a.name})}return o}function Za(t,e,n,r,i){let o=Ha(n,r);if(!o)return null;let a=(0,h.join)(x(e),qt);(0,p.mkdirSync)(a,{recursive:!0});let s=(0,h.join)(a,o);return(0,p.writeFileSync)(s,Buffer.from(i)),s}function qa(t,e,n){let r=(0,h.basename)(String(n??"").replace(/[\\/]/g,"_"));if(!r.toLowerCase().endsWith(".webm")||r.includes(".."))throw new Error("not a voice track");return new Uint8Array((0,p.readFileSync)((0,h.join)(x(e),qt,r)))}function Ya(t,e){let n=(0,h.join)(x(t),qt);for(let{file:r}of Ka(t,e))try{(0,p.unlinkSync)((0,h.join)(n,r))}catch{}}function Ja(t,e){let n=x(e);if(!(0,p.existsSync)(n))return[];let r=[],i=new Set,o=(0,p.readdirSync)(n,{withFileTypes:!0});for(let a of o)a.isFile()&&i.add(a.name);for(let a of o){if(!a.isFile()||!/\.(webm|mp4)$/i.test(a.name))continue;let s=(0,h.join)(n,a.name);try{let l=(0,p.statSync)(s),f=yt(a.name);r.push({name:a.name,path:s,size:l.size,modified:l.mtimeMs,...i.has(f)?{thumb:f}:{}})}catch{}}return r.sort((a,s)=>s.modified-a.modified)}function Xa(t,e,n){let r=(0,h.join)(x(e),qe(n));return new Uint8Array((0,p.readFileSync)(r))}async function Qa(t,e,n){let r=x(e),i=qe(n),o=(0,h.join)(r,i);try{await y.shell.trashItem(o)}catch{(0,p.unlinkSync)(o)}Ya(e,i);let a=(0,h.join)(r,yt(i));if((0,p.existsSync)(a))try{await y.shell.trashItem(a)}catch{try{(0,p.unlinkSync)(a)}catch{}}}function es(t,e,n,r){let i=x(e),o=qe(n),a=(0,h.join)(i,o),s=(0,h.extname)(o),l=Ze(r.toLowerCase().endsWith(s)?r:r+s);if(!l)throw new Error("That name cannot be used. Keep it under 120 characters, with letters, digits, spaces or - _ . + ( ) [ ]");if(l===o)return o;let d=l.toLowerCase()===o.toLowerCase()?(0,h.join)(i,l):Wn(i,l);(0,p.renameSync)(a,d);let u=(0,h.join)(i,yt(o));if((0,p.existsSync)(u))try{(0,p.renameSync)(u,(0,h.join)(i,yt((0,h.basename)(d))))}catch{}return(0,h.basename)(d)}var Vi="clipper-library.json";function ts(t,e){let n=(0,h.join)(x(e),Vi);if(!(0,p.existsSync)(n))return"";try{return(0,p.readFileSync)(n,"utf8")}catch{return""}}function ns(t,e,n){let r=x(e);(0,p.mkdirSync)(r,{recursive:!0});let i=(0,h.join)(r,Vi),o=`${i}.tmp`;(0,p.writeFileSync)(o,String(n??""),"utf8"),(0,p.renameSync)(o,i)}async function rs(t){let e=await y.dialog.showOpenDialog({title:"Add videos to the timeline",properties:["openFile","multiSelections"],filters:[{name:"Video",extensions:["mp4","webm","mkv","mov","m4v"]}]});return e.canceled?[]:e.filePaths}var is=512*1024*1024;function os(t,e){if(!(0,h.isAbsolute)(e)||!/\.(mp4|webm|mkv|mov|m4v)$/i.test(e))throw new Error("Not a video file");let n=(0,p.statSync)(e);if(n.size>is){let r=Math.round(n.size/1048576);throw new Error(`That video is ${r} MB; imports are capped at 512 MB. Trim it or lower its bitrate first.`)}return new Uint8Array((0,p.readFileSync)(e))}async function as(t){let e=await y.dialog.showOpenDialog({title:"Add sounds to the timeline",properties:["openFile","multiSelections"],filters:[{name:"Audio",extensions:["mp3","wav","ogg","opus","m4a","aac","flac","webm"]}]});return e.canceled?[]:e.filePaths}var ss=64*1024*1024;function ls(t,e){if(!(0,h.isAbsolute)(e)||!/\.(mp3|wav|ogg|opus|m4a|aac|flac|webm)$/i.test(e))throw new Error("Not an audio file");let n=(0,p.statSync)(e);if(n.size>ss){let r=Math.round(n.size/1048576);throw new Error(`That sound is ${r} MB; the timeline caps them at 64 MB.`)}return new Uint8Array((0,p.readFileSync)(e))}async function cs(t){let e=await y.dialog.showOpenDialog({title:"Add pictures and clips to the montage",properties:["openFile","multiSelections"],filters:[{name:"Pictures and clips",extensions:["png","jpg","jpeg","webp","gif","avif","bmp","mp4","webm"]},{name:"Pictures",extensions:["png","jpg","jpeg","webp","gif","avif","bmp"]},{name:"Clips",extensions:["mp4","webm"]}]});return e.canceled?[]:e.filePaths}var us=24*1024*1024,ds=64*1024*1024;function ps(t,e){if(!(0,h.isAbsolute)(e)||!/\.(png|jpe?g|webp|gif|avif|bmp|mp4|webm)$/i.test(e))throw new Error("Not a picture or a clip");let n=/\.(mp4|webm)$/i.test(e),r=n?ds:us,i=(0,p.statSync)(e);if(i.size>r){let o=Math.round(i.size/1048576),a=Math.round(r/(1024*1024));throw new Error(`That ${n?"clip":"picture"} is ${o} MB; the montage caps them at ${a} MB.`)}return new Uint8Array((0,p.readFileSync)(e))}function fs(t,e,n){y.shell.showItemInFolder((0,h.join)(x(e),qe(n)))}function hs(t,e){return x(e)}async function ms(t,e){let n=await y.dialog.showOpenDialog({title:"Where should clips be saved?",defaultPath:x(e),properties:["openDirectory","createDirectory"]});return n.canceled?"":n.filePaths[0]??""}function gs(t,e){let n=x(e);(0,p.mkdirSync)(n,{recursive:!0}),y.shell.openPath(n)}function vs(t){return{platform:"win32",wayland:$n,vesktop:Oi,overlay:jt()}}var he=new Set;async function ys(t,e=!0){if($n)return[];let n=await y.desktopCapturer.getSources({types:["screen","window"],thumbnailSize:e?{width:320,height:180}:{width:0,height:0},fetchWindowIcons:!1});if(he.size){let i=new Set(n.map(o=>o.id));for(let o of he)i.has(o)||he.delete(o)}let r=[];for(let i of n){let o=i.id.startsWith("screen:");if(!e){if(!o&&he.has(i.id))continue;r.push({id:i.id,name:i.name,thumbnail:""});continue}let a=i.thumbnail.isEmpty();if(Li&&!o&&a){he.add(i.id);continue}he.delete(i.id),r.push({id:i.id,name:i.name,thumbnail:a?"":i.thumbnail.toDataURL(),capturable:!0})}return r}async function ws(t){try{return y.app.getAppMetrics().map(e=>({type:e.serviceName||e.type,mb:Math.round((e.memory?.workingSetSize??0)/1024)})).filter(e=>e.mb>0).sort((e,n)=>n.mb-e.mb)}catch{return[]}}async function bs(t){if($n)return"";let e=await y.desktopCapturer.getSources({types:["screen"],thumbnailSize:{width:0,height:0}});if(!e.length)return"";try{let n=y.screen.getDisplayNearestPoint(y.screen.getCursorScreenPoint()),r=e.find(i=>i.display_id===String(n.id));if(r)return r.id}catch{}return e[0].id}var Fn="",Nn=!1;function Ss(t,e,n=!0){return!n||Oi?!1:(Fn=e??"",Nn=!0,y.session.defaultSession.setDisplayMediaRequestHandler(async(r,i)=>{let o=await y.desktopCapturer.getSources({types:["screen","window"],thumbnailSize:{width:0,height:0}}),a=o.find(f=>f.id===Fn),l=(a&&!he.has(a.id)?a:void 0)??o.find(f=>f.id.startsWith("screen:"))??o.find(f=>!he.has(f.id));if(!l){i({});return}i(Li&&l.id.startsWith("screen:")?{video:l,audio:"loopback"}:{video:l})},{useSystemPicker:!1}),!0)}function xs(t){Fn="",Nn&&(Nn=!1,y.session.defaultSession.setDisplayMediaRequestHandler(null))}var Un=new Map,He=[],Et=[];function ks(t){let e=He.shift();if(e){e(t);return}Et.push(t),Et.length>8&&Et.shift()}function Es(t,e){zn();let n=[];for(let[r,i]of Object.entries(e)){if(!i)continue;let o=!1;try{o=y.globalShortcut.register(i,()=>ks(r))}catch{o=!1}o?Un.set(r,i):n.push(i)}return n}function zn(t){for(let n of Un.values())try{y.globalShortcut.unregister(n)}catch{}Un.clear(),Et=[];let e=He;He=[];for(let n of e)n(null)}function Ts(t,e=3e4){let n=Et.shift();return n?Promise.resolve(n):new Promise(r=>{let i=!1,o=s=>{i||(i=!0,clearTimeout(a),r(s))},a=setTimeout(()=>{He=He.filter(s=>s!==o),o(null)},e);He.push(o)})}y.app.on("will-quit",()=>zn());function Ps(t,e){return Qr(e)}function Is(t){return In()}function As(t){return $t()}function Cs(t,e=3e4){return ti(e)}function Rs(t,e){return Ii(e)}function Ms(t){return Vn()}function _s(t){return Zt()}function Ds(t){return Ai()}function Ls(t,e,n,r,i){return Ci(new Uint8Array(e),n,r,i)}function Os(t){return Ri()}function Vs(t,e=3e4){return Mi(e)}y.app.on("will-quit",()=>{In()});var Fs=["top-left","top-right","bottom-left","bottom-right"];function Ke(t,e,n,r){let i=Number(t);return Number.isFinite(i)?Math.min(n,Math.max(e,Math.round(i))):r}function Fi(t){return Fs.includes(t)?t:"bottom-right"}function Ns(t){return{corner:Fi(t?.corner),width:Ke(t?.width,200,1280,420),volume:Ke(t?.volume,0,100,0),seconds:Ke(t?.seconds,0,300,10)}}function Gn(t,e){return String(t??"").replace(/\s+/g," ").trim().slice(0,e)}function Us(t,e,n,r){let i=Ze(n);if(!i)return!1;let o=(0,h.join)(x(e),i);return(0,p.existsSync)(o)?ai(o,Ns(r)):!1}function Gs(t,e,n,r){return y.BrowserWindow.getFocusedWindow()||Rn()?!1:si(Gn(e,60),Gn(n,90),Fi(r))}function $s(t){Te()}var Ws=200;function zs(t){return Array.isArray(t)?t.map(Number).filter(e=>Number.isFinite(e)&&e>=0).slice(0,Ws):[]}function Bs(t){return{width:Ke(t?.width,360,1600,720),volume:Ke(t?.volume,0,100,0)}}function js(t,e,n,r,i){let o=Ze(n);if(!o)return!1;let a=(0,h.join)(x(e),o);return(0,p.existsSync)(a)?fi({name:o,path:a,markers:zs(r)},Bs(i)):!1}function Hs(t){vt()}function Ks(t){return Rn()}function Zs(t,e=3e4){return ui(Ke(e,1e3,12e4,3e4))}function qs(t){di()}function Ys(t,e,n,r){pi({ok:!!e,message:Gn(n,120),close:!!r})}function Js(t){let e=y.BrowserWindow.fromWebContents(t.sender);!e||e.isDestroyed()||(e.isMinimized()&&e.restore(),e.show(),e.focus())}var Tt="kebab1337420/vencord-clipper",Xs=`VencordClipper (+https://github.com/${Tt})`,Qs=["patcher.js","patcher.js.LEGAL.txt","preload.js","renderer.css","renderer.js","renderer.js.LEGAL.txt","vencordDesktopMain.js","vencordDesktopMain.js.LEGAL.txt","vencordDesktopPreload.js","vencordDesktopRenderer.css","vencordDesktopRenderer.js","vencordDesktopRenderer.js.LEGAL.txt"];function Yt(t,e=0){return new Promise((n,r)=>{let i=(0,Di.get)(t,{headers:{"User-Agent":Xs,Accept:"*/*"}},o=>{let a=o.statusCode??0,{location:s}=o.headers;if(a>=300&&a<400&&s){o.resume(),e>=5?r(new Error(`Too many redirects for ${t}`)):n(Yt(new URL(s,t).toString(),e+1));return}let l=[];o.on("data",f=>l.push(f)),o.on("end",()=>n({status:a,body:Buffer.concat(l)})),o.on("error",r)});i.setTimeout(6e4,()=>i.destroy(new Error(`${t} timed out`))),i.on("error",r)})}async function el(t){let{status:e,body:n}=await Yt(t);if(e!==200)throw new Error(`${t} answered ${e}`);return n}function Ni(){return __dirname}function Ui(t){return(0,p.existsSync)((0,h.join)(t,"patcher.js"))&&(0,p.existsSync)((0,h.join)(t,"renderer.js"))}function Gi(t){try{return(0,p.accessSync)(t,p.constants.W_OK),!0}catch{return!1}}function tl(t,e){let n=o=>o.replace(/^v/i,"").split(/[.\-+]/).map(a=>Number(a)||0),r=n(t),i=n(e);for(let o=0;o<3;o++)if((r[o]??0)!==(i[o]??0))return(r[o]??0)>(i[o]??0);return!1}async function nl(t,e){let n=await el(`https://api.github.com/repos/${Tt}/releases/latest`),r=JSON.parse(n.toString("utf8")),i=String(r.tag_name??""),o=i.replace(/^v/i,""),a=Ni();return{version:o,tag:i,available:!!o&&tl(o,e),notes:String(r.body??"").trim().slice(0,1200),url:String(r.html_url??`https://github.com/${Tt}/releases`),directory:a,writable:Ui(a)&&Gi(a)}}async function rl(t){let{status:e,body:n}=await Yt(`https://raw.githubusercontent.com/${Tt}/${t}/prebuilt/build-info.json`);if(e===404)return null;if(e!==200)throw new Error(`The release's file list answered ${e}, so there is nothing to check the bundle against`);let r;try{({files:r}=JSON.parse(n.toString("utf8")))}catch{throw new Error("The release's file list could not be read, so there is nothing to check the bundle against")}if(!r||typeof r!="object")throw new Error("The release's file list names no files");return r}async function il(t,e){if(!/^[\w.-]{1,40}$/.test(e))throw new Error(`Refusing to fetch a release named ${e}`);let n=Ni();if(!Ui(n))throw new Error(`No installed bundle at ${n}`);if(!Gi(n))throw new Error(`${n} is read-only`);let r=await rl(e),i=r?Object.keys(r):Qs,o=(0,h.join)(n,".clipper-update");(0,p.rmSync)(o,{recursive:!0,force:!0}),(0,p.mkdirSync)(o,{recursive:!0});try{let a=[];for(let d of i){if(d!==(0,h.basename)(d)||d.startsWith("."))throw new Error(`Refusing a release file named ${d}`);let{status:u,body:v}=await Yt(`https://raw.githubusercontent.com/${Tt}/${e}/prebuilt/dist/${d}`);if(u===404&&!r)continue;if(u!==200)throw new Error(`${d} answered ${u}`);if(v.length===0)throw new Error(`${d} came back empty`);let E=r?.[d];if(E?.size!==void 0&&v.length!==E.size)throw new Error(`${d} is ${v.length} bytes, the release says ${E.size}`);if(E?.sha256&&(0,_i.createHash)("sha256").update(v).digest("hex").toLowerCase()!==E.sha256.toLowerCase())throw new Error(`${d} does not match its hash`);(0,p.writeFileSync)((0,h.join)(o,d),v),a.push(d)}if(a.length===0)throw new Error(`There is no bundle published under ${e}`);for(let d of["renderer.js","patcher.js"])if(!a.includes(d))throw new Error(`The release carries no ${d}`);if(!(0,p.readFileSync)((0,h.join)(o,"renderer.js")).includes("Clipper"))throw new Error("There is no Clipper in that release's renderer");let s=(0,h.join)(o,".previous");(0,p.mkdirSync)(s,{recursive:!0});let l=[],f=[];try{for(let d of a){let u=(0,h.join)(n,d);(0,p.existsSync)(u)&&((0,p.renameSync)(u,(0,h.join)(s,d)),l.push(d)),(0,p.renameSync)((0,h.join)(o,d),u),f.push(d)}}catch(d){for(let u of f)try{(0,p.unlinkSync)((0,h.join)(n,u))}catch{}for(let u of l)try{(0,p.renameSync)((0,h.join)(s,u),(0,h.join)(n,u))}catch{}throw new Error(`The update could not be put in place (${d.message}). The bundle that was there has been put back.`)}return a}finally{(0,p.rmSync)(o,{recursive:!0,force:!0})}}function ol(t){y.app.relaunch(),y.app.quit(),setTimeout(()=>y.app.exit(0),3e3)}var $i={AppleMusicRichPresence:hn,ConsoleShortcuts:mn,FixSpotifyEmbeds:Fr,FixYoutubeEmbeds:Ur,OpenInApp:Sn,Translate:xn,VoiceMessages:kn,XSOverlay:En,YoutubeAdblock:jr,Clipper:Bn};var Wi={};for(let[t,e]of Object.entries($i)){let n=Object.entries(e);if(!n.length)continue;let r=Wi[t]={};for(let[i,o]of n){let a=`VencordPluginNative_${t}_${i}`;jn.ipcMain.handle(a,o),r[i]=a}}jn.ipcMain.on("VencordGetPluginIpcMethodMap",t=>{t.returnValue=Wi});te();c();function Hn(t,e=300){let n;return function(...r){clearTimeout(n),n=setTimeout(()=>{t(...r)},e)}}Le();var b=require("electron");c();var zi="PCFkb2N0eXBlIGh0bWw+PGh0bWwgbGFuZz0iZW4iPjxoZWFkPjxtZXRhIGNoYXJzZXQ9InV0Zi04Ij48dGl0bGU+VmVuY29yZCBRdWlja0NTUyBFZGl0b3I8L3RpdGxlPjxsaW5rIHJlbD0ic3R5bGVzaGVldCIgaHJlZj0iaHR0cHM6Ly9jZG4uanNkZWxpdnIubmV0L25wbS9tb25hY28tZWRpdG9yQDAuNTAuMC9taW4vdnMvZWRpdG9yL2VkaXRvci5tYWluLmNzcyIgaW50ZWdyaXR5PSJzaGEyNTYtdGlKUFEyTzA0ei9wWi9Bd2R5SWdock9NemV3ZitQSXZFbDFZS2JRdnNaaz0iIGNyb3Nzb3JpZ2luPSJhbm9ueW1vdXMiIHJlZmVycmVycG9saWN5PSJuby1yZWZlcnJlciI+PHN0eWxlPiNjb250YWluZXIsYm9keSxodG1se3Bvc2l0aW9uOmFic29sdXRlO2xlZnQ6MDt0b3A6MDt3aWR0aDoxMDAlO2hlaWdodDoxMDAlO21hcmdpbjowO3BhZGRpbmc6MDtvdmVyZmxvdzpoaWRkZW59PC9zdHlsZT48L2hlYWQ+PGJvZHk+PGRpdiBpZD0iY29udGFpbmVyIj48L2Rpdj48c2NyaXB0IHNyYz0iaHR0cHM6Ly9jZG4uanNkZWxpdnIubmV0L25wbS9tb25hY28tZWRpdG9yQDAuNTAuMC9taW4vdnMvbG9hZGVyLmpzIiBpbnRlZ3JpdHk9InNoYTI1Ni1LY1U0OFRHcjg0cjd1bkY3SjVJZ0JvOTVhZVZyRWJyR2UwNFM3VGNGVWpzPSIgY3Jvc3NvcmlnaW49ImFub255bW91cyIgcmVmZXJyZXJwb2xpY3k9Im5vLXJlZmVycmVyIj48L3NjcmlwdD48c2NyaXB0PnJlcXVpcmUuY29uZmlnKHtwYXRoczp7dnM6Imh0dHBzOi8vY2RuLmpzZGVsaXZyLm5ldC9ucG0vbW9uYWNvLWVkaXRvckAwLjUwLjAvbWluL3ZzIn19KSxyZXF1aXJlKFsidnMvZWRpdG9yL2VkaXRvci5tYWluIl0sKCgpPT57Z2V0Q3VycmVudENzcygpLnRoZW4oKGU9Pnt2YXIgdD1tb25hY28uZWRpdG9yLmNyZWF0ZShkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiY29udGFpbmVyIikse3ZhbHVlOmUsbGFuZ3VhZ2U6ImNzcyIsdGhlbWU6Z2V0VGhlbWUoKX0pO3Qub25EaWRDaGFuZ2VNb2RlbENvbnRlbnQoKCgpPT5zZXRDc3ModC5nZXRWYWx1ZSgpKSkpLHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCJyZXNpemUiLCgoKT0+e3QubGF5b3V0KCl9KSl9KSl9KSk8L3NjcmlwdD48L2JvZHk+PC9odG1sPg==";var re=require("fs"),ge=require("fs/promises"),Qi=require("os"),Jt=require("path");c();te();Le();var Ye=require("electron");c();te();var Kn=require("electron"),j=["connect-src"],U=[...j,"img-src"],Hi=["style-src","font-src"],Bi=[...U,"media-src"],k=[...U,...Hi],ji=[...k,"script-src","worker-src"],qn={"http://localhost:*":k,"http://127.0.0.1:*":k,"localhost:*":k,"127.0.0.1:*":k,"*.github.io":k,"github.com":k,"raw.githubusercontent.com":k,"*.gitlab.io":k,"gitlab.com":k,"*.codeberg.page":k,"codeberg.org":k,"*.githack.com":k,"jsdelivr.net":k,"fonts.googleapis.com":Hi,"i.imgur.com":U,"i.ibb.co":U,"i.pinimg.com":U,"files.catbox.moe":k,"cdn.discordapp.com":k,"media.discordapp.net":U,"cdnjs.cloudflare.com":ji,"cdn.jsdelivr.net":ji,"api.github.com":j,"ws.audioscrobbler.com":j,"musicbrainz.org":j,"*.listenbrainz.org":j,"coverartarchive.org":j,"archive.org":j,"*.archive.org":j,"translate-pa.googleapis.com":j,"*.vencord.dev":U,"manti.vendicated.dev":U,"decor.fieryflames.dev":j,"ugc.decor.fieryflames.dev":U,"sponsor.ajay.app":j,"dearrow-thumb.ajay.app":U,"usrbg.is-hardly.online":U,"icons.duckduckgo.com":U,"*.tenor.com":Bi,"*.tenor.co":Bi},Zn=(t,e)=>Object.keys(t).find(n=>n.toLowerCase()===e),al=t=>{let e={};return t.split(";").forEach(n=>{let[r,...i]=n.trim().split(/\s+/g);r&&!Object.prototype.hasOwnProperty.call(e,r)&&(e[r]=i)}),e},sl=t=>Object.entries(t).filter(([,e])=>e?.length).map(e=>e.flat().join(" ")).join("; "),ll=t=>{let e=Zn(t,"content-security-policy-report-only");e&&delete t[e];let n=Zn(t,"content-security-policy");if(n){let r=al(t[n][0]),i=(o,...a)=>{r[o]??=[...r["default-src"]??[]],r[o].push(...a)};i("style-src","'unsafe-inline'"),i("script-src","'unsafe-inline'","'unsafe-eval'");for(let o of["style-src","connect-src","img-src","font-src","media-src","worker-src"])i(o,"blob:","data:","vencord:","vesktop:");for(let[o,a]of Object.entries(K.store.customCspRules))for(let s of a)i(s,o);for(let[o,a]of Object.entries(qn))for(let s of a)i(s,o);t[n]=[sl(r)]}};function Ki(){Kn.session.defaultSession.webRequest.onHeadersReceived(({responseHeaders:t,resourceType:e},n)=>{if(t&&(e==="mainFrame"&&ll(t),e==="stylesheet")){let r=Zn(t,"content-type");r&&(t[r]=["text/css"])}n({cancel:!1,responseHeaders:t})}),Kn.session.defaultSession.webRequest.onHeadersReceived=()=>{}}function Zi(){Ye.ipcMain.handle("VencordCspRemoveOverride",pl),Ye.ipcMain.handle("VencordCspRequestAddOverride",dl),Ye.ipcMain.handle("VencordCspIsDomainAllowed",fl)}function cl(t,e){try{let{host:n}=new URL(t);if(/[;'"\\]/.test(n))return!1}catch{return!1}return!(e.length===0||e.some(n=>!k.includes(n)))}function ul(t,e,n){let r=new URL(t).host,i=`${n} wants to allow connections to ${r}`,o=`Unless you recognise and fully trust ${r}, you should cancel this request!

You will have to fully close and restart Discord for the changes to take effect.`;if(e.length===1&&e[0]==="connect-src")return{message:i,detail:o};let a=e.filter(s=>s!=="connect-src").map(s=>{switch(s){case"img-src":return"Images";case"style-src":return"CSS & Themes";case"font-src":return"Fonts";default:throw new Error(`Illegal CSP directive: ${s}`)}}).sort().join(", ");return o=`The following types of content will be allowed to load from ${r}:
${a}

${o}`,{message:i,detail:o}}async function dl(t,e,n,r){if(!cl(e,n))return"invalid";let i=new URL(e).host;if(i in K.store.customCspRules)return"conflict";let{checkboxChecked:o,response:a}=await Ye.dialog.showMessageBox({...ul(e,n,r),type:r?"info":"warning",title:"Vencord Host Permissions",buttons:["Cancel","Allow"],defaultId:0,cancelId:0,checkboxLabel:`I fully trust ${i} and understand the risks of allowing connections to it.`,checkboxChecked:!1});return a!==1?"cancelled":o?(K.store.customCspRules[i]=n,"ok"):"unchecked"}function pl(t,e){return e in K.store.customCspRules?(delete K.store.customCspRules[e],!0):!1}function fl(t,e,n){try{let r=new URL(e).host,i=qn[r]??K.store.customCspRules[r];return i?n.every(o=>i.includes(o)):!1}catch{return!1}}c();var hl=/[^\S\r\n]*?\r?(?:\r\n|\n)[^\S\r\n]*?\*[^\S\r\n]?/,ml=/^\\@/;function Yn(t,e={}){return{fileName:t,name:e.name??t.replace(/\.css$/i,""),author:e.author??"Unknown Author",description:e.description??"A Discord Theme.",version:e.version,license:e.license,source:e.source,website:e.website,invite:e.invite}}function qi(t){return t.charCodeAt(0)===65279&&(t=t.slice(1)),t}function Yi(t,e){if(!t)return Yn(e);let n=t.split("/**",2)?.[1]?.split("*/",1)?.[0];if(!n)return Yn(e);let r={},i="",o="";for(let a of n.split(hl))if(a.length!==0)if(a.charAt(0)==="@"&&a.charAt(1)!==" "){r[i]=o.trim();let s=a.indexOf(" ");i=a.substring(1,s),o=a.substring(s+1)}else o+=" "+a.replace("\\n",`
`).replace(ml,"@");return r[i]=o.trim(),delete r[""],Yn(e,r)}Fe();c();var Je=require("path");function me(t,e){let n=(0,Je.normalize)(t+"/"),r=(0,Je.join)(t,e),i=(0,Je.normalize)(r);return i===(0,Je.normalize)(t)||i.startsWith(n)?i:null}c();var Ji=require("electron");function Xi(t){t.webContents.setWindowOpenHandler(({url:e})=>{switch(e){case"about:blank":case"https://discord.com/popout":case"https://ptb.discord.com/popout":case"https://canary.discord.com/popout":return{action:"allow"}}try{var{protocol:n}=new URL(e)}catch{return{action:"deny"}}switch(n){case"http:":case"https:":case"mailto:":case"steam:":case"spotify:":Ji.shell.openExternal(e)}return{action:"deny"}})}var gl=(0,Jt.join)(__dirname,"renderer.css");(0,re.mkdirSync)(ce,{recursive:!0});Zi();function eo(){return(0,ge.readFile)(Ve,"utf-8").catch(()=>"")}async function vl(){let t=await(0,ge.readdir)(ce).catch(()=>[]),e=[];for(let n of t){if(!n.endsWith(".css"))continue;let r=await to(n).then(qi).catch(()=>null);r!=null&&e.push(Yi(r,n))}return e}function to(t){t=t.replace(/\?v=\d+$/,"");let e=me(ce,t);return e?(0,ge.readFile)(e,"utf-8"):Promise.reject(`Unsafe path ${t}`)}b.ipcMain.handle("VencordOpenQuickCss",()=>b.shell.openPath(Ve));b.ipcMain.handle("VencordOpenExternal",(t,e)=>{try{var{protocol:n}=new URL(e)}catch{throw"Malformed URL"}if(!Dr.includes(n))throw"Disallowed protocol.";b.shell.openExternal(e).catch(r=>console.error("[Vencord] Failed to open external link",e,r))});b.ipcMain.handle("VencordGetQuickCss",()=>eo());b.ipcMain.handle("VencordSetQuickCss",(t,e)=>(0,re.writeFileSync)(Ve,e));b.ipcMain.handle("VencordGetThemesList",()=>vl());b.ipcMain.handle("VencordGetThemeData",(t,e)=>to(e));b.ipcMain.handle("VencordGetThemeSystemValues",()=>{let t=b.systemPreferences.getAccentColor?.()??"";return t.length&&t[0]!=="#"&&(t=`#${t}`),{"os-accent-color":t}});b.ipcMain.handle("VencordOpenThemesFolder",()=>b.shell.openPath(ce));b.ipcMain.handle("VencordOpenSettingsFolder",()=>b.shell.openPath(be));var Jn=[];b.ipcMain.handle("VencordInitFileWatchers",({sender:t})=>{Jn.forEach(i=>i.close());let e,n;(0,ge.open)(Ve,"a+").then(i=>{i.close(),e=(0,re.watch)(Ve,{persistent:!1},Hn(async()=>{t.postMessage("VencordQuickCssUpdate",await eo())},50))}).catch(()=>{});let r=(0,re.watch)(ce,{persistent:!1},Hn(()=>{t.postMessage("VencordThemeUpdate",void 0)}));Jn=[e,r,n].filter(Boolean),t.once("destroyed",()=>{e?.close(),r.close(),n?.close(),Jn=[]})});b.ipcMain.on("VencordGetMonacoTheme",t=>{t.returnValue=b.nativeTheme.shouldUseDarkColors?"vs-dark":"vs-light"});b.ipcMain.handle("VencordOpenMonacoEditor",async()=>{let t="Vencord QuickCSS Editor",e=b.BrowserWindow.getAllWindows().find(r=>r.title===t);if(e&&!e.isDestroyed()){e.focus();return}let n=new b.BrowserWindow({title:t,autoHideMenuBar:!0,darkTheme:!0,backgroundColor:b.nativeTheme.shouldUseDarkColors?"#1e1e1e":"white",webPreferences:{preload:(0,Jt.join)(__dirname,"preload.js"),contextIsolation:!0,nodeIntegration:!1,sandbox:!1}});Xi(n),await n.loadURL(`data:text/html;base64,${zi}`)});b.ipcMain.handle("VencordGetRendererCss",()=>(0,ge.readFile)(gl,"utf-8"));b.ipcMain.on("VencordPreloadGetRendererJs",t=>{t.returnValue=(0,re.readFileSync)((0,Jt.join)(__dirname,"renderer.js"),"utf-8")});b.ipcMain.on("VencordSupportsWindowsMaterial",t=>{t.returnValue=Number((0,Qi.release)().split(".")[2])>=22621});var Ce=require("electron"),Co=require("path"),sr=require("url");te();Fe();c();var on=require("electron");c();var io=require("module"),yl=(0,io.createRequire)("/"),Xe,Qt,Qn,wl=";var __w=require('worker_threads');__w.parentPort.on('message',function(m){onmessage({data:m})}),postMessage=function(m,t){__w.parentPort.postMessage(m,t)},close=process.exit;self=global";try{Xe=yl("worker_threads"),Qt=Xe.Worker,Qn=Xe.isMarkedAsUntransferable}catch{}var bl=Qt?function(t,e,n,r,i){var o=!1,a=new Qt(t+wl,{eval:!0}).on("error",function(s){return i(s,null)}).on("message",function(s){return i(null,s)}).on("exit",function(s){s&&!o&&i(new Error("exited with code "+s),null)});return Qn&&(r=r.filter(function(s){return!Qn(s)})),a.postMessage(n,r),a.terminate=function(){return o=!0,Qt.prototype.terminate.call(a)},a}:function(t,e,n,r,i){setImmediate(function(){return i(new Error("async operations unsupported - update to Node 12+ (or Node 10-11 with the --experimental-worker CLI flag)"),null)});var o=function(){};return{terminate:o,postMessage:o}},R=Uint8Array,Ae=Uint16Array,oo=Int32Array,tr=new R([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0,0,0,0]),nr=new R([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13,0,0]),ao=new R([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]),so=function(t,e){for(var n=new Ae(31),r=0;r<31;++r)n[r]=e+=1<<t[r-1];for(var i=new oo(n[30]),r=1;r<30;++r)for(var o=n[r];o<n[r+1];++o)i[o]=o-n[r]<<5|r;return{b:n,r:i}},Xe=so(tr,2),rr=Xe.b,Sl=Xe.r;rr[28]=258,Sl[258]=28;var lo=so(nr,0),co=lo.b,Ku=lo.r,nn=new Ae(32768);for(w=0;w<32768;++w)ie=(w&43690)>>1|(w&21845)<<1,ie=(ie&52428)>>2|(ie&13107)<<2,ie=(ie&61680)>>4|(ie&3855)<<4,nn[w]=((ie&65280)>>8|(ie&255)<<8)>>1;var ie,w,Qe=(function(t,e,n){for(var r=t.length,i=0,o=new Ae(e);i<r;++i)t[i]&&++o[t[i]-1];var a=new Ae(e);for(i=1;i<e;++i)a[i]=a[i-1]+o[i-1]<<1;var s;if(n){s=new Ae(1<<e);var l=15-e;for(i=0;i<r;++i)if(t[i])for(var f=i<<4|t[i],d=e-t[i],u=a[t[i]-1]++<<d,v=u|(1<<d)-1;u<=v;++u)s[nn[u]>>l]=f}else for(s=new Ae(r),i=0;i<r;++i)t[i]&&(s[i]=nn[a[t[i]-1]++]>>15-t[i]);return s}),Pt=new R(288);for(w=0;w<144;++w)Pt[w]=8;var w;for(w=144;w<256;++w)Pt[w]=9;var w;for(w=256;w<280;++w)Pt[w]=7;var w;for(w=280;w<288;++w)Pt[w]=8;var w,uo=new R(32);for(w=0;w<32;++w)uo[w]=5;var w;var po=Qe(Pt,9,1);var fo=Qe(uo,5,1),en=function(t){for(var e=t[0],n=1;n<t.length;++n)t[n]>e&&(e=t[n]);return e},G=function(t,e,n){var r=e/8|0;return(t[r]|t[r+1]<<8)>>(e&7)&n},tn=function(t,e){var n=e/8|0;return(t[n]|t[n+1]<<8|t[n+2]<<16)>>(e&7)},ho=function(t){return(t+7)/8|0},rn=function(t,e,n){return(e==null||e<0)&&(e=0),(n==null||n>t.length)&&(n=t.length),new R(t.subarray(e,n))};var mo=["unexpected EOF","invalid block type","invalid length/literal","invalid distance","stream finished","no stream handler",,"no callback","invalid UTF-8 data","extra field too long","date not in range 1980-2099","filename too long","stream finishing","invalid zip data"],P=function(t,e,n){var r=new Error(e||mo[t]);if(r.code=t,Error.captureStackTrace&&Error.captureStackTrace(r,P),!n)throw r;return r},go=function(t,e,n,r){var i=t.length,o=r?r.length:0;if(!i||e.f&&!e.l)return n||new R(0);var a=!n,s=a||e.i!=2,l=e.i;a&&(n=new R(i*3));var f=function(fr){var hr=n.length;if(fr>hr){var mr=new R(Math.max(hr*2,fr));mr.set(n),n=mr}},d=e.f||0,u=e.p||0,v=e.b||0,E=e.l,oe=e.d,Q=e.m,L=e.n,O=i*8;do{if(!E){d=G(t,u,1);var ae=G(t,u+1,3);if(u+=3,ae)if(ae==1)E=po,oe=fo,Q=9,L=5;else if(ae==2){var et=G(t,u,31)+257,It=G(t,u+10,15)+4,ye=et+G(t,u+5,31)+1;u+=14;for(var V=new R(ye),Me=new R(19),T=0;T<It;++T)Me[ao[T]]=G(t,u+T*3,7);u+=It*3;for(var tt=en(Me),Ro=(1<<tt)-1,Mo=Qe(Me,tt,1),T=0;T<ye;){var lr=Mo[G(t,u,Ro)];u+=lr&15;var A=lr>>4;if(A<16)V[T++]=A;else{var _e=0,At=0;for(A==16?(At=3+G(t,u,3),u+=2,_e=V[T-1]):A==17?(At=3+G(t,u,7),u+=3):A==18&&(At=11+G(t,u,127),u+=7);At--;)V[T++]=_e}}var cr=V.subarray(0,et),se=V.subarray(et);Q=en(cr),L=en(se),E=Qe(cr,Q,1),oe=Qe(se,L,1)}else P(1);else{var A=ho(u)+4,ee=t[A-4]|t[A-3]<<8,Re=A+ee;if(Re>i){l&&P(0);break}s&&f(v+ee),n.set(t.subarray(A,Re),v),e.b=v+=ee,e.p=u=Re*8,e.f=d;continue}if(u>O){l&&P(0);break}}s&&f(v+131072);for(var _o=(1<<Q)-1,Do=(1<<L)-1,an=u;;an=u){var _e=E[tn(t,u)&_o],De=_e>>4;if(u+=_e&15,u>O){l&&P(0);break}if(_e||P(2),De<256)n[v++]=De;else if(De==256){an=u,E=null;break}else{var ur=De-254;if(De>264){var T=De-257,nt=tr[T];ur=G(t,u,(1<<nt)-1)+rr[T],u+=nt}var sn=oe[tn(t,u)&Do],ln=sn>>4;sn||P(3),u+=sn&15;var se=co[ln];if(ln>3){var nt=nr[ln];se+=tn(t,u)&(1<<nt)-1,u+=nt}if(u>O){l&&P(0);break}s&&f(v+131072);var dr=v+ur;if(v<se){var pr=o-se,Lo=Math.min(se,dr);for(pr+v<0&&P(3);v<Lo;++v)n[v]=r[pr+v]}for(;v<dr;++v)n[v]=n[v-se]}}e.l=E,e.p=an,e.b=v,e.f=d,E&&(d=1,e.m=Q,e.d=oe,e.n=L)}while(!d);return v!=n.length&&a?rn(n,0,v):n.subarray(0,v)};var xl=new R(0);var kl=function(t,e){var n={};for(var r in t)n[r]=t[r];for(var r in e)n[r]=e[r];return n},no=function(t,e,n){for(var r=t(),i=t.toString(),o=i.slice(i.indexOf("[")+1,i.lastIndexOf("]")).replace(/\s+/g,"").split(","),a=0;a<r.length;++a){var s=r[a],l=o[a];if(typeof s=="function"){e+=";"+l+"=";var f=s.toString();if(s.prototype)if(f.indexOf("[native code]")!=-1){var d=f.indexOf(" ",8)+1;e+=f.slice(d,f.indexOf("(",d))}else{e+=f;for(var u in s.prototype)e+=";"+l+".prototype."+u+"="+s.prototype[u].toString()}else e+=f}else n[l]=s}return e},Xt=[],El=function(t){var e=[];for(var n in t)t[n].buffer&&e.push((t[n]=new t[n].constructor(t[n])).buffer);return e},Tl=function(t,e,n,r){if(!Xt[n]){for(var i="",o={},a=t.length-1,s=0;s<a;++s)i=no(t[s],i,o);Xt[n]={c:no(t[a],i,o),e:o}}var l=kl({},Xt[n].e);return bl(Xt[n].c+";onmessage=function(e){for(var k in e.data)self[k]=e.data[k];onmessage="+e.toString()+"}",n,l,El(l),r)},Pl=function(){return[R,Ae,oo,tr,nr,ao,rr,co,po,fo,nn,mo,Qe,en,G,tn,ho,rn,P,go,ir,vo,yo]};var vo=function(t){return postMessage(t,[t.buffer])},yo=function(t){return t&&{out:t.size&&new R(t.size),dictionary:t.dictionary}},Il=function(t,e,n,r,i,o){var a=Tl(n,r,i,function(s,l){a.terminate(),o(s,l)});return a.postMessage([t,e],e.consume?[t.buffer]:[]),function(){a.terminate()}};var Y=function(t,e){return t[e]|t[e+1]<<8},$=function(t,e){return(t[e]|t[e+1]<<8|t[e+2]<<16|t[e+3]<<24)>>>0},Xn=function(t,e){return $(t,e)+$(t,e+4)*4294967296};function Al(t,e,n){return n||(n=e,e={}),typeof n!="function"&&P(7),Il(t,e,[Pl],function(r){return vo(ir(r.data[0],yo(r.data[1])))},1,n)}function ir(t,e){return go(t,{i:2},e&&e.out,e&&e.dictionary)}var er=typeof TextDecoder<"u"&&new TextDecoder,Cl=0;try{er.decode(xl,{stream:!0}),Cl=1}catch{}var Rl=function(t){for(var e="",n=0;;){var r=t[n++],i=(r>127)+(r>223)+(r>239);if(n+i>t.length)return{s:e,r:rn(t,n-1)};i?i==3?(r=((r&15)<<18|(t[n++]&63)<<12|(t[n++]&63)<<6|t[n++]&63)-65536,e+=String.fromCharCode(55296|r>>10,56320|r&1023)):i&1?e+=String.fromCharCode((r&31)<<6|t[n++]&63):e+=String.fromCharCode((r&15)<<12|(t[n++]&63)<<6|t[n++]&63):e+=String.fromCharCode(r)}};function Ml(t,e){if(e){for(var n="",r=0;r<t.length;r+=16384)n+=String.fromCharCode.apply(null,t.subarray(r,r+16384));return n}else{if(er)return er.decode(t);var i=Rl(t),o=i.s,n=i.r;return n.length&&P(8),o}}var _l=function(t,e){return e+30+Y(t,e+26)+Y(t,e+28)},Dl=function(t,e,n){var r=Y(t,e+28),i=Y(t,e+30),o=Ml(t.subarray(e+46,e+46+r),!(Y(t,e+8)&2048)),a=e+46+r,s=Ll(t,a,i,n,$(t,e+20),$(t,e+24),$(t,e+42)),l=s[0],f=s[1],d=s[2];return[Y(t,e+10),l,f,o,a+i+Y(t,e+32),d]},Ll=function(t,e,n,r,i,o,a){var s=i==4294967295,l=o==4294967295,f=a==4294967295,d=e+n,u=s+l+f;if(r&&u){for(;e+4<d;e+=4+Y(t,e+2))if(Y(t,e)==1)return[s?Xn(t,e+4+8*l):i,l?Xn(t,e+4):o,f?Xn(t,e+4+8*(l+s)):a,1];r<2&&P(13)}return[i,o,a,0]};var ro=typeof queueMicrotask=="function"?queueMicrotask:typeof setTimeout=="function"?setTimeout:function(t){t()};function wo(t,e,n){n||(n=e,e={}),typeof n!="function"&&P(7);var r=[],i=function(){for(var L=0;L<r.length;++L)r[L]()},o={},a=function(L,O){ro(function(){n(L,O)})};ro(function(){a=n});for(var s=t.length-22;$(t,s)!=101010256;--s)if(!s||t.length-s>65558)return a(P(13,0,1),null),i;var l=Y(t,s+8);if(l){var f=l,d=$(t,s+16),u=$(t,s-20)==117853008;if(u){var v=$(t,s-12);u=$(t,v)==101075792,u&&(f=l=$(t,v+32),d=$(t,v+48))}for(var E=e&&e.filter,oe=function(L){var O=Dl(t,d,u),ae=O[0],A=O[1],ee=O[2],Re=O[3],et=O[4],It=O[5],ye=_l(t,It);d=et;var V=function(T,tt){T?(i(),a(T,null)):(tt&&(o[Re]=tt),--l||a(null,o))};if(!E||E({name:Re,size:A,originalSize:ee,compression:ae}))if(!ae)V(null,rn(t,ye,ye+A));else if(ae==8){var Me=t.subarray(ye,ye+A);if(ee<524288||A>.8*ee)try{V(null,ir(Me,{out:new R(ee)}))}catch(T){V(T,null)}else r.push(Al(Me,{size:ee},V))}else V(P(14,"unknown compression type "+ae,1),null);else V(null,null)},Q=0;Q<f;++Q)oe(Q)}else a(null,{});return i}var xo=require("fs"),J=require("fs/promises"),or=require("path");Fe();c();function bo(t){function e(a,s,l,f){let d=0;return d+=a<<0,d+=s<<8,d+=l<<16,d+=f<<24>>>0,d}if(t[0]===80&&t[1]===75&&t[2]===3&&t[3]===4)return t;if(t[0]!==67||t[1]!==114||t[2]!==50||t[3]!==52)throw new Error("Invalid header: Does not start with Cr24");let n=t[4]===3,r=t[4]===2;if(!r&&!n||t[5]||t[6]||t[7])throw new Error("Unexpected crx format version number.");if(r){let a=e(t[8],t[9],t[10],t[11]),s=e(t[12],t[13],t[14],t[15]),l=16+a+s;return t.subarray(l,t.length)}let o=12+e(t[8],t[9],t[10],t[11]);return t.subarray(o,t.length)}c();var Ol=require("original-fs");async function Vl(t,e){try{var n=await fetch(t,e)}catch(i){throw i instanceof Error&&i.cause&&(i=i.cause),new Error(`${e?.method??"GET"} ${t} failed: ${i}`)}if(n.ok)return n;let r=`${e?.method??"GET"} ${t}: ${n.status} ${n.statusText}`;try{let i=await n.text();r+=`
${i}`}catch{}throw new Error(r)}async function So(t,e){let r=await(await Vl(t,e)).arrayBuffer();return Buffer.from(r)}var Fl=(0,or.join)(Mt,"ExtensionCache");async function Nl(t,e){return await(0,J.mkdir)(e,{recursive:!0}),new Promise((n,r)=>{wo(t,(i,o)=>{if(i)return void r(i);Promise.all(Object.keys(o).map(async a=>{if(a.startsWith("_metadata/"))return;if(a.includes("\0"))throw new Error(`Invalid filename: "${a}"`);if(a.endsWith("/")){let u=me(e,a);if(!u)throw new Error(`Path traversal detected: "${a}"`);return void await(0,J.mkdir)(u,{recursive:!0})}let l=a.split("/").slice(0,-1).join("/"),f=me(e,l);if(!f)throw new Error(`Path traversal detected: "${a}"`);let d=me(e,a);if(!d)throw new Error(`Path traversal detected: "${a}"`);l&&await(0,J.mkdir)(f,{recursive:!0}),await(0,J.writeFile)(d,o[a])})).then(()=>n()).catch(a=>{(0,J.rm)(e,{recursive:!0,force:!0}),r(a)})})})}async function ko(t){let e=(0,or.join)(Fl,t);try{await(0,J.access)(e,xo.constants.F_OK)}catch{let r=`https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3&x=id%3D${t}%26uc&prodversion=${process.versions.chrome}`,i=await So(r,{headers:{"User-Agent":`Electron ${process.versions.electron} ~ Vencord (https://github.com/Vendicated/Vencord)`}});await Nl(bo(i),e).catch(o=>console.error(`Failed to extract extension ${t}`,o))}on.session.defaultSession.extensions?on.session.defaultSession.extensions.loadExtension(e):on.session.defaultSession.loadExtension(e)}_t||Ce.app.whenReady().then(()=>{Ce.protocol.handle("vencord",({url:t})=>{let e=decodeURI(t).slice(10).replace(/\?v=\d+$/,"");if(e.endsWith("/")&&(e=e.slice(0,-1)),e.startsWith("/themes/")){let n=e.slice(8),r=me(ce,n);return r?Ce.net.fetch((0,sr.pathToFileURL)(r).toString()):new Response(null,{status:404})}switch(e){case"renderer.js.map":case"vencordDesktopRenderer.js.map":case"preload.js.map":case"vencordDesktopPreload.js.map":case"patcher.js.map":case"vencordDesktopMain.js.map":return Ce.net.fetch((0,sr.pathToFileURL)((0,Co.join)(__dirname,e)).toString());default:return new Response(null,{status:404})}});try{C.store.enableReactDevtools&&ko("fmkadmapgofadopljbjfkapdkoienihi").then(()=>console.info("[Vencord] Installed React Developer Tools")).catch(t=>console.error("[Vencord] Failed to install React Developer Tools",t))}catch{}Ki()});Ao();
//# sourceURL=file:///VencordPatcher
//# sourceMappingURL=vencord://patcher.js.map
/*! For license information please see patcher.js.LEGAL.txt */
