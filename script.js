
/* ============================================================
 * Midnight Screen Log · 深夜屏幕使用记录工具
 * 原功能：深夜计时、眼动监测、主观自评、图表、复盘、数据管理
 * 新增功能：主题切换、日历、单日删除、目标管理、卡片折叠
 * ============================================================ */

// ---------- 存储键 ----------
const LS = {
    setting:"msl_setting",
    records:"msl_records",
    evals:"msl_evals",
    hours:"msl_hours",
    eye:"msl_eye",
    theme:"msl_theme",
    goal:"msl_goal",
    collapse:"msl_collapse"
};

let setting = JSON.parse(localStorage.getItem(LS.setting)) || {
    start:"23:00",end:"06:00"
};
let records = JSON.parse(localStorage.getItem(LS.records)) || [];
let evals = JSON.parse(localStorage.getItem(LS.evals)) || {};
let hoursAgg = JSON.parse(localStorage.getItem(LS.hours)) || {};
let eyeData = JSON.parse(localStorage.getItem(LS.eye)) || {};

let nightGoal = Number(localStorage.getItem(LS.goal)) || 120;
let currentTheme = localStorage.getItem(LS.theme) || "light";
let collapseState = JSON.parse(localStorage.getItem(LS.collapse) || "{}");

let isRunning = false;
let accumulatedSec = 0;
let lastTickTs = 0;
let currentKey = null;

let focusContinuousSec = 0;
const focusAlertSec = 30 * 60;
let focusAlertFired = false;
let tipDom;

// ---------- DOM ----------
const $ = id => document.getElementById(id);

const statusDot = $("statusDot");
const statusEl = $("status");
const todayTimeEl = $("todayTime");
const startBtn = $("startBtn");
const reportBtn = $("reportBtn");
const nightStartInput = $("nightStartInput");
const nightEndInput = $("nightEndInput");
const saveTimeBtn = $("saveTimeBtn");
const timeHint = $("timeHint");

/* ---------------- 工具函数 ---------------- */

function timeStrToHour(str){
    const [h,m] = str.split(":").map(Number);
    return h + m/60;
}

function fmtDate(d){
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function recordKeyOf(dateObj){
    const s = timeStrToHour(setting.start);
    const e = timeStrToHour(setting.end);

    if(s > e){
        const curH = dateObj.getHours() + dateObj.getMinutes()/60;
        if(curH < e){
            const y = new Date(dateObj);
            y.setDate(y.getDate()-1);
            return fmtDate(y);
        }
    }
    return fmtDate(dateObj);
}

function todayKey(){
    return recordKeyOf(new Date());
}

function isNightTime(){
    const now = new Date();
    const nowH = now.getHours() + now.getMinutes()/60;
    const s = timeStrToHour(setting.start);
    const e = timeStrToHour(setting.end);

    if(s > e) return nowH >= s || nowH < e;
    return nowH >= s && nowH <= e;
}

function formatHM(sec){
    sec = Math.max(0,Math.floor(sec));
    const h = Math.floor(sec/3600);
    const m = Math.floor((sec%3600)/60);
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

function secToMin(sec){
    return Math.round(sec/60);
}

/* ---------------- 记录读写 ---------------- */

function getSecOf(key){
    const it = records.find(i=>i.date===key);
    return it ? it.seconds : 0;
}

function upsertRecord(key,sec){
    let it = records.find(i=>i.date===key);

    if(!it){
        it = {date:key,seconds:0};
        records.push(it);
    }

    it.seconds = sec;
    localStorage.setItem(LS.records,JSON.stringify(records));
}

/* ---------------- 深色 / 浅色主题 ---------------- */

function applyTheme(){
    document.body.classList.toggle("dark",currentTheme==="dark");

    $("themeBtn").textContent =
        currentTheme==="dark" ? "☀️ 浅色模式" : "🌙 深色模式";

    localStorage.setItem(LS.theme,currentTheme);
}

$("themeBtn").onclick = ()=>{
    currentTheme = currentTheme==="light" ? "dark" : "light";
    applyTheme();
};

applyTheme();

/* ---------------- 熬夜目标 ---------------- */

$("goalInput").value = nightGoal;

$("saveGoalBtn").onclick = ()=>{
    const value = Number($("goalInput").value);

    if(!Number.isFinite(value) || value<1 || value>1440){
        alert("请输入1~1440之间的有效分钟数。");
        $("goalInput").value = nightGoal;
        return;
    }

    nightGoal = Math.floor(value);
    $("goalInput").value = nightGoal;

    localStorage.setItem(LS.goal,nightGoal);

    renderGoal();
    renderCalendar();
};

function renderGoal(){
    const sec = getSecOf(todayKey());
    const target = nightGoal*60;

    $("goalProgressFill").style.width =
        Math.min(sec/target*100,100)+"%";

    if(sec<=target){
        $("goalResult").className = "goal-result good";
        $("goalResult").textContent =
            `✅ 今日已使用 ${formatHM(sec)} / 目标 ${formatHM(target)}，目前达标！`;
    }else{
        $("goalResult").className = "goal-result bad";
        $("goalResult").textContent =
            `⚠️ 今日已使用 ${formatHM(sec)} / 目标 ${formatHM(target)}，已超出 ${formatHM(sec-target)}。`;
    }
}

/* ---------------- 主循环 ---------------- */

function tick(){
    const now = Date.now();
    const delta = Math.max(0,Math.floor((now-lastTickTs)/1000));
    lastTickTs = now;

    if(isRunning && currentKey && !document.hidden && isNightTime()){
        accumulatedSec += delta;
        upsertRecord(currentKey,accumulatedSec);

        const h = String(new Date().getHours());
        hoursAgg[h] = (hoursAgg[h]||0)+delta;

        localStorage.setItem(LS.hours,JSON.stringify(hoursAgg));
    }

    render();
    setTimeout(tick,1000);
}

/* ---------------- 渲染 ---------------- */

function render(){
    const key = currentKey || todayKey();
    todayTimeEl.textContent = formatHM(getSecOf(key));

    if(isRunning && document.hidden){
        statusDot.className = "dot off";
        statusEl.textContent = "已开启，但页面在后台（切回才计时）";
    }else if(isRunning && !isNightTime()){
        statusDot.className = "dot";
        statusEl.textContent = "监测中 · 当前不在深夜时段，暂停计时";
    }else if(isRunning){
        statusDot.className = "dot on";
        statusEl.textContent = "✅ 监测中 · 深夜计时进行中";
    }else{
        statusDot.className = "dot";
        statusEl.textContent = "等待记录";
    }

    renderStats();
    renderGoal();
}

function renderStats(){
    const totalSec = records.reduce((s,i)=>s+i.seconds,0);

    $("statDays").textContent = records.filter(i=>i.seconds>0).length;
    $("statTotal").textContent =
        formatHM(totalSec).replace(":","h ")+"m";

    const validDays = records.filter(i=>i.seconds>0).length;

    $("statAvg").textContent =
        validDays ? secToMin(totalSec/validDays)+"m" : "0m";

    let peak = "--";
    const hoursArr = Object.entries(hoursAgg);

    if(hoursArr.length){
        const [h] = hoursArr.sort((a,b)=>b[1]-a[1])[0];
        peak = h.padStart(2,"0")+":00 前后";
    }

    $("statPeakTime").textContent = peak;
}

/* ---------------- 开始 / 停止 ---------------- */

startBtn.onclick = ()=>{
    if(!isRunning){
        isRunning = true;
        currentKey = todayKey();
        accumulatedSec = getSecOf(currentKey);
        lastTickTs = Date.now();

        startBtn.textContent = "结束监测";
        startBtn.classList.add("running");
    }else{
        isRunning = false;

        if(currentKey){
            upsertRecord(currentKey,accumulatedSec);
        }

        startBtn.textContent = "开启监测";
        startBtn.classList.remove("running");
    }

    render();
    renderCalendar();
};

document.addEventListener("visibilitychange",()=>{
    lastTickTs = Date.now();
    render();
});

/* ---------------- 时段设置 ---------------- */

nightStartInput.value = setting.start;
nightEndInput.value = setting.end;

function timeHintText(prefix){
    const cross = timeStrToHour(setting.start)>timeStrToHour(setting.end);

    return `${prefix}：每晚 ${setting.start} ${cross?"~ 次日":"~"} ${setting.end} 计入深夜时长。`;
}

saveTimeBtn.onclick = ()=>{
    setting.start = nightStartInput.value;
    setting.end = nightEndInput.value;

    localStorage.setItem(LS.setting,JSON.stringify(setting));

    timeHint.textContent = timeHintText("已保存");
};

timeHint.textContent = timeHintText("当前");

/* ---------------- 主观自评 ---------------- */

const OPT = {
    fatigue:[["很精神",1],["还行",2],["一般",3],["疲惫",4],["非常累",5]],
    control:[["很差",1],["不太好",2],["一般",3],["比较满意",4],["很满意",5]],
    will:[["更想少用",0],["没变化",1],["更想用了",2]]
};

function buildSeg(el,key){
    el.innerHTML = "";

    OPT[key].forEach(([label,val])=>{
        const s = document.createElement("span");

        s.textContent = label;
        s.dataset.val = val;

        s.onclick = ()=>{
            el.querySelectorAll("span").forEach(x=>x.classList.remove("active"));
            s.classList.add("active");
            el.dataset.picked = val;
        };

        el.appendChild(s);
    });
}

buildSeg($("evalFatigue"),"fatigue");
buildSeg($("evalControl"),"control");
buildSeg($("evalWill"),"will");

$("saveEvalBtn").onclick = ()=>{
    const f = $("evalFatigue").dataset.picked;
    const c = $("evalControl").dataset.picked;
    const w = $("evalWill").dataset.picked;

    if(f===undefined || c===undefined || w===undefined){
        $("evalHint").textContent = "请把三项都选一下再保存。";
        return;
    }

    const key = todayKey();

    evals[key] = {
        fatigue:+f,
        control:+c,
        will:+w
    };

    localStorage.setItem(LS.evals,JSON.stringify(evals));

    $("evalHint").textContent = `✅ 已保存 ${key} 的自评。`;

    drawCompare();
    renderCalendar();
};

/* ============================================================
 * 眼动监测模块
 * ============================================================ */

const EyeCfg = {
    intervalMs:110,
    modelUrl:"https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    cdn:[
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14",
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm",
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest"
    ],
    sens:{
        loose:{gx:0.55,gy:0.70,open:0.28,minSize:0.14},
        mid:{gx:0.42,gy:0.58,open:0.36,minSize:0.16},
        strict:{gx:0.30,gy:0.45,open:0.44,minSize:0.18}
    },
    graceMs:600
};

const eye = {
    running:false,
    landmarker:null,
    stream:null,
    video:null,
    delegate:"",
    sens:"mid",
    allDay:false,
    state:"idle",
    lastTs:0,
    lastUsingTs:0,
    lastEndTs:0,
    lastVideoTime:-1,
    detCount:0,
    detWinStart:0,
    fps:0,
    lastSaveTs:0,
    m:{face:0,open:0,gx:0,gy:0,size:0,score:0}
};

const eyeVideo = $("eyeVideo");
const eyeVideoTag = $("eyeVideoTag");
const eyeToggleBtn = $("eyeToggleBtn");
const eyeHint = $("eyeHint");
const eyeSensSel = $("eyeSens");
const eyeAllDayChk = $("eyeAllDay");

/* 眼动数据 */

function eyeDay(key){
    if(!eyeData[key]){
        eyeData[key]={using:0,away:0,noface:0,sessions:0};
    }
    return eyeData[key];
}

function saveEyeData(){
    try{
        localStorage.setItem(LS.eye,JSON.stringify(eyeData));
    }catch(e){
        console.warn("保存眼动数据失败",e);
    }
}

function eyeSecOf(key){
    return eyeData[key] ? eyeData[key].using : 0;
}

/* 模型加载 */

async function loadVision(){
    let vision=null,lastErr=null,usedUrl="";

    for(const url of EyeCfg.cdn){
        try{
            const mod = await import(url);

            if(mod && mod.FaceLandmarker){
                vision=mod;
                usedUrl=url;
                break;
            }
        }catch(e){
            lastErr=e;
        }
    }

    if(!vision){
        throw lastErr || new Error("MediaPipe 模块加载失败，请检查网络");
    }

    const wasmRoot = usedUrl.replace(/\/\+esm$/g,"")+"/wasm";
    const fileset = await vision.FilesetResolver.forVisionTasks(wasmRoot);

    const base = {
        baseOptions:{
            modelAssetPath:EyeCfg.modelUrl,
            delegate:"GPU"
        },
        runningMode:"VIDEO",
        numFaces:1,
        outputFaceBlendshapes:true,
        outputFacialTransformationMatrixes:false,
        minFaceDetectionConfidence:0.5,
        minFacePresenceConfidence:0.5,
        minTrackingConfidence:0.5
    };

    try{
        const l = await vision.FaceLandmarker.createFromOptions(fileset,base);
        eye.delegate="GPU";
        return l;
    }catch(e){
        base.baseOptions.delegate="CPU";
        const l = await vision.FaceLandmarker.createFromOptions(fileset,base);
        eye.delegate="CPU";
        return l;
    }
}

/* 摄像头 */

async function openCamera(){
    const stream = await navigator.mediaDevices.getUserMedia({
        audio:false,
        video:{
            facingMode:{ideal:"user"},
            width:{ideal:640},
            height:{ideal:480},
            frameRate:{ideal:30,max:30}
        }
    });

    eye.stream=stream;
    eye.video=eyeVideo;
    eyeVideo.srcObject=stream;

    await eyeVideo.play().catch(()=>{});

    if(eyeVideo.readyState<2){
        await new Promise(res=>{
            const done = ()=>{
                eyeVideo.removeEventListener("loadeddata",done);
                res();
            };

            eyeVideo.addEventListener("loadeddata",done);
            setTimeout(res,1500);
        });
    }
}

function closeCamera(){
    if(eye.stream){
        eye.stream.getTracks().forEach(t=>t.stop());
        eye.stream=null;
    }

    if(eyeVideo) eyeVideo.srcObject=null;

    eye.lastVideoTime=-1;
}

/* 判定核心 */

function readBlendshapes(res){
    const out={};
    const bs=res && res.faceBlendshapes && res.faceBlendshapes[0];

    if(bs && bs.categories){
        for(const c of bs.categories){
            out[c.categoryName]=c.score;
        }
    }

    return out;
}

function num(v){
    return typeof v==="number" && !isNaN(v) ? v : 0;
}

function faceBoxSize(lm){
    let minX=1,maxX=0,minY=1,maxY=0;

    for(const p of lm){
        if(p.x<minX) minX=p.x;
        if(p.x>maxX) maxX=p.x;
        if(p.y<minY) minY=p.y;
        if(p.y>maxY) maxY=p.y;
    }

    return Math.max(maxX-minX,maxY-minY);
}

function classify(res){
    const th=EyeCfg.sens[eye.sens] || EyeCfg.sens.mid;
    const lm=res && res.faceLandmarks && res.faceLandmarks[0];
    const hasFace=!!(lm && lm.length);
    const size=hasFace ? faceBoxSize(lm) : 0;

    eye.m.face=hasFace?1:0;
    eye.m.size=size;

    if(!hasFace || size<th.minSize){
        eye.m.open=0;
        eye.m.gx=0;
        eye.m.gy=0;
        eye.m.score=0;
        return "noface";
    }

    const b=readBlendshapes(res);

    const open=Math.max(
        0,
        1-(num(b.eyeBlinkLeft)+num(b.eyeBlinkRight))/2
    );

    const gx=(
        (num(b.eyeLookOutLeft)-num(b.eyeLookInLeft))-
        (num(b.eyeLookOutRight)-num(b.eyeLookInRight))
    )/2;

    const gy=(
        (num(b.eyeLookDownLeft)-num(b.eyeLookUpLeft))+
        (num(b.eyeLookDownRight)-num(b.eyeLookUpRight))
    )/2;

    eye.m.open=open;
    eye.m.gx=gx;
    eye.m.gy=gy;

    const alignX=Math.max(0,1-Math.abs(gx)/(th.gx*2.2));
    const alignY=Math.max(0,1-Math.abs(gy)/(th.gy*2.2));

    eye.m.score=Math.max(
        0,
        Math.min(1,open*0.55+alignX*alignY*open*0.45)
    );

    if(open<th.open) return "away";
    if(Math.abs(gx)>th.gx || Math.abs(gy)>th.gy) return "away";

    return "using";
}

/* 计时累加 */

function accumulate(now){
    const dt=Math.min(Math.max((now-eye.lastTs)/1000,0),0.6);
    eye.lastTs=now;

    if(dt<=0 || eye.state==="idle") return;
    if(!eye.allDay && !isNightTime()) return;
    if(document.hidden) return;

    let effective=eye.state;

    if(effective==="using"){
        eye.lastUsingTs=now;
    }else if(now-eye.lastUsingTs<EyeCfg.graceMs){
        effective="using";
    }

    const day=eyeDay(todayKey());

    if(effective==="using") day.using+=dt;
    else if(effective==="away") day.away+=dt;
    else if(effective==="noface") day.noface+=dt;

    if(now-eye.lastSaveTs>1200){
        eye.lastSaveTs=now;
        saveEyeData();
    }
}

/* 会话统计 */

function setState(next){
    if(next===eye.state) return;

    const now=performance.now();

    if(next==="using"){
        if(now-eye.lastEndTs>4000 || eye.lastEndTs===0){
            eyeDay(todayKey()).sessions+=1;
        }
    }else if(eye.state==="using"){
        eye.lastEndTs=now;
    }

    eye.state=next;
}

/* 检测循环 */

async function detectLoop(){
    if(!eye.running) return;

    const now=performance.now();

    try{
        if(document.hidden){
            setState("idle");
        }else if(eye.landmarker && eye.video && eye.video.readyState>=2){

            if(eye.video.currentTime!==eye.lastVideoTime){
                eye.lastVideoTime=eye.video.currentTime;

                const res=eye.landmarker.detectForVideo(eye.video,now);

                setState(classify(res));

                eye.detCount++;

                if(!eye.detWinStart) eye.detWinStart=now;

                if(now-eye.detWinStart>1000){
                    eye.fps=Math.round(
                        eye.detCount*1000/(now-eye.detWinStart)
                    );

                    eye.detCount=0;
                    eye.detWinStart=now;
                }
            }

            accumulate(now);
        }else{
            eye.lastTs=now;
        }

        renderEye();

    }catch(e){
        console.warn("眼动检测异常",e);
    }

    setTimeout(detectLoop,EyeCfg.intervalMs);
}

/* 眼动渲染 */

const EYE_STATE_TEXT = {
    idle:["","页面在后台，检测暂停"],
    noface:["off","未检测到人脸（人不在手机前）"],
    away:["busy","人脸在画面中，但视线没对着屏幕"],
    using:["on","✅ 视线正对屏幕，判定为使用中"]
};

function renderEye(){
    if(!tipDom) tipDom=$("tipText");

    const day=eyeDay(todayKey());

    $("eyeToday").textContent=formatHM(day.using);
    $("eyeSessions").textContent=day.sessions;
    $("eyeAway").textContent=secToMin(day.away)+"m";
    $("eyeNoFace").textContent=secToMin(day.noface)+"m";
    $("eyeFps").textContent=eye.fps ? eye.fps+"fps" : "--";

    $("eyeFace").textContent=eye.m.face
        ? Math.round(eye.m.size*100)+"% 画面" : "无";

    $("eyeOpen").textContent=eye.m.face
        ? Math.round(eye.m.open*100)+"%" : "--";

    $("eyeGaze").textContent=eye.m.face
        ? `H${eye.m.gx>=0?"+":""}${eye.m.gx.toFixed(2)} V${eye.m.gy>=0?"+":""}${eye.m.gy.toFixed(2)}`
        : "--";

    $("eyeMeterFill").style.width=Math.round(eye.m.score*100)+"%";

    const [cls,text]=EYE_STATE_TEXT[eye.state] || EYE_STATE_TEXT.idle;

    $("eyeStatusDot").className="dot"+(cls?" "+cls:"");
    $("eyeStatus").textContent=eye.running?text:"未开启眼动监测";

    eyeVideoTag.textContent=eye.running
        ? (eye.delegate ? "摄像头运行中 · "+eye.delegate : "摄像头运行中")
        : "摄像头未开启";

    if(!eye.running){
        tipDom.textContent="眼动监测未开启";
        focusContinuousSec=0;
        focusAlertFired=false;
        return;
    }

    if(eye.state==="using"){
        focusContinuousSec+=0.11;

        if(focusContinuousSec>=focusAlertSec){
            focusAlertFired=true;
            tipDom.textContent="⚠️ 注视超时，建议远眺休息";
        }else{
            tipDom.textContent=`🟢 注视中｜连续${focusContinuousSec.toFixed(1)}s`;
        }
    }else if(eye.state==="away"){
        focusContinuousSec=0;
        focusAlertFired=false;
        tipDom.textContent="🟡 走神中";
    }else if(eye.state==="noface"){
        focusContinuousSec=0;
        focusAlertFired=false;
        tipDom.textContent="🔴 未检测到人脸";
    }else{
        focusContinuousSec=0;
        focusAlertFired=false;
        tipDom.textContent="页面在后台，检测暂停";
    }
}

/* 眼动开关 */

async function startEye(){
    eyeToggleBtn.disabled=true;
    eyeToggleBtn.textContent="正在启动…";
    eyeHint.textContent="正在加载面部关键点模型（首次约3~8MB，稍等几秒）…";

    try{
        await openCamera();

        if(!eye.landmarker){
            eye.landmarker=await loadVision();
        }

        eye.running=true;
        eye.state="idle";
        eye.lastUsingTs=0;
        eye.lastEndTs=0;
        eye.lastTs=performance.now();
        eye.lastVideoTime=-1;
        eye.detWinStart=0;
        eye.detCount=0;
        eye.fps=0;

        eyeToggleBtn.textContent="停止眼动监测";
        eyeToggleBtn.classList.add("running");

        eyeHint.textContent="摄像头已开启。请让手机正对自己，保持面部在画面内；数据只在本机处理，不上传。";

        detectLoop();

    }catch(e){
        eye.running=false;
        closeCamera();

        eyeToggleBtn.textContent="开启眼动监测";
        eyeToggleBtn.classList.remove("running");

        const msg=e && e.name==="NotAllowedError"
            ? "摄像头权限被拒绝：请在浏览器地址栏左侧允许「摄像头」后重试。"
            : e && e.name==="NotFoundError"
                ? "没有找到可用摄像头（请确认设备有前置摄像头）。"
                : "启动失败："+(e && e.message ? e.message : e);

        eyeHint.textContent=msg;
        eye.state="idle";

    }finally{
        eyeToggleBtn.disabled=false;
        renderEye();
    }
}

function stopEye(){
    eye.running=false;
    closeCamera();
    eye.state="idle";

    saveEyeData();

    eyeToggleBtn.textContent="开启眼动监测";
    eyeToggleBtn.classList.remove("running");

    eyeHint.textContent="已停止。本场数据已保存在本机浏览器。";

    renderEye();
    drawTrend();
    renderCalendar();
}

eyeToggleBtn.onclick=()=>{
    eye.running ? stopEye() : startEye();
};

eyeSensSel.onchange=()=>{
    eye.sens=eyeSensSel.value;
};

eyeAllDayChk.onchange=()=>{
    eye.allDay=eyeAllDayChk.checked;
};

document.addEventListener("visibilitychange",()=>{
    eye.lastTs=performance.now();

    if(!document.hidden && eye.running){
        eye.lastVideoTime=-1;
    }
});

window.addEventListener("pagehide",()=>{
    if(eye.running) stopEye();
});

/* ============================================================
 * 图表模块
 * ============================================================ */

let trendChart=null;
let cmpChart=null;

const DAY=24*3600*1000;

function lastNDays(n){
    const out=[];

    for(let i=n-1;i>=0;i--){
        const d=new Date(Date.now()-i*DAY);
        out.push(recordKeyOf(d));
    }

    return [...new Set(out)];
}

function hasEyeData(){
    return Object.keys(eyeData).some(
        k=>eyeData[k] && eyeData[k].using>0
    );
}

function drawTrend(){
    if(typeof Chart==="undefined") return;

    const days=lastNDays(14);
    const labels=days.map(d=>d.slice(5));

    const datasets=[{
        label:"页面停留时长(h)",
        data:days.map(d=>+(getSecOf(d)/3600).toFixed(2)),
        borderColor:"#b8a9c9",
        backgroundColor:"rgba(184,169,201,.15)",
        fill:true,
        tension:.4,
        pointRadius:3,
        borderWidth:2
    }];

    if(hasEyeData()){
        datasets.push({
            label:"摄像头判定使用(h)",
            data:days.map(d=>+(eyeSecOf(d)/3600).toFixed(2)),
            borderColor:"#7fb89a",
            backgroundColor:"rgba(127,184,154,.10)",
            fill:false,
            tension:.4,
            pointRadius:3,
            borderWidth:2,
            borderDash:[6,4]
        });
    }

    const ctx=$("chartCanvas").getContext("2d");

    if(trendChart) trendChart.destroy();

    trendChart=new Chart(ctx,{
        type:"line",
        data:{labels,datasets},
        options:{
            plugins:{
                legend:{
                    display:hasEyeData(),
                    labels:{boxWidth:10,color:"#8c8c9b"}
                }
            },
            scales:{
                x:{
                    grid:{display:false},
                    ticks:{color:"#8c8c9b",maxTicksLimit:7}
                },
                y:{
                    grid:{color:"rgba(184,169,201,.15)"},
                    ticks:{color:"#8c8c9b"}
                }
            }
        }
    });
}

function drawCompare(){
    if(typeof Chart==="undefined") return;

    const days=lastNDays(14);
    const labels=days.map(d=>d.slice(5));
    const hours=days.map(d=>+(getSecOf(d)/3600).toFixed(2));
    const fatigue=days.map(d=>evals[d]?evals[d].fatigue:null);

    const ctx=$("compareCanvas").getContext("2d");

    if(cmpChart) cmpChart.destroy();

    cmpChart=new Chart(ctx,{
        data:{
            labels,
            datasets:[
                {
                    type:"line",
                    label:"客观时长(h)",
                    data:hours,
                    borderColor:"#b8a9c9",
                    backgroundColor:"rgba(184,169,201,.15)",
                    yAxisID:"y",
                    tension:.4,
                    pointRadius:3,
                    borderWidth:2,
                    fill:true
                },
                {
                    type:"bar",
                    label:"主观疲劳感(1-5)",
                    data:fatigue,
                    backgroundColor:"rgba(224,164,160,.5)",
                    yAxisID:"y1",
                    barPercentage:.5
                }
            ]
        },
        options:{
            responsive:true,
            scales:{
                x:{
                    grid:{display:false},
                    ticks:{color:"#8c8c9b",maxTicksLimit:7}
                },
                y:{
                    position:"left",
                    min:0,
                    ticks:{color:"#b8a9c9"},
                    title:{display:true,text:"小时"}
                },
                y1:{
                    position:"right",
                    min:0,
                    max:5,
                    grid:{drawOnChartArea:false},
                    ticks:{color:"#e0a4a0"}
                }
            }
        }
    });
}

/* ============================================================
 * 复盘报告
 * ============================================================ */

reportBtn.onclick=()=>{
    if(records.length===0 && !hasEyeData()){
        alert("暂无记录，先开启监测几天再来复盘。");
        return;
    }

    const sorted=[...records].sort((a,b)=>a.seconds-b.seconds);
    const total=records.reduce((s,i)=>s+i.seconds,0);
    const avg=records.length ? total/records.length : 0;
    const worst=sorted[sorted.length-1];
    const best=sorted[0];

    const recent=lastNDays(7).reduce((s,d)=>s+getSecOf(d),0);

    const pairs=Object.keys(evals)
        .filter(d=>getSecOf(d)>0)
        .map(d=>({h:getSecOf(d)/3600,f:evals[d].fatigue}));

    let relate="样本太少，暂无法判断。";

    if(pairs.length>=3){
        const meanH=pairs.reduce((s,p)=>s+p.h,0)/pairs.length;
        const meanF=pairs.reduce((s,p)=>s+p.f,0)/pairs.length;

        let cov=0,vH=0,vF=0;

        pairs.forEach(p=>{
            cov+=(p.h-meanH)*(p.f-meanF);
            vH+=(p.h-meanH)**2;
            vF+=(p.f-meanF)**2;
        });

        const r=cov/Math.sqrt(vH*vF||1);

        relate=r>0.3
            ? "熬夜越久，主观疲劳感倾向越高，二者正相关。"
            : r< -0.3
                ? "熬夜时长与疲劳感呈反向，可能已适应或自评与时长脱钩。"
                : "熬夜时长与疲劳感相关性不明显，建议继续记录。";
    }

    let eyeBlock="";

    if(hasEyeData()){
        const days=Object.keys(eyeData)
            .filter(d=>eyeData[d].using>0)
            .sort();

        const eyeTotal=days.reduce((s,d)=>s+eyeData[d].using,0);
        const eyeSess=days.reduce((s,d)=>s+(eyeData[d].sessions||0),0);
        const eyeAway=days.reduce((s,d)=>s+(eyeData[d].away||0),0);
        const eyeNo=days.reduce((s,d)=>s+(eyeData[d].noface||0),0);
        const eyeAvg=eyeTotal/days.length;

        let focusRate="样本不足";
        const cmpDays=days.filter(d=>getSecOf(d)>0);

        if(cmpDays.length){
            const ratio=cmpDays.reduce(
                (s,d)=>s+eyeData[d].using/getSecOf(d),0
            )/cmpDays.length;

            focusRate=Math.round(Math.min(ratio,1.5)*100)+"%";
        }

        eyeBlock=`
        <div class="row"><span>摄像头有效记录天数</span><b>${days.length} 天</b></div>
        <div class="row"><span>判定「正在使用手机」累计</span><b>${formatHM(eyeTotal)}（约 ${(eyeTotal/3600).toFixed(1)} 小时）</b></div>
        <div class="row"><span>日均注视时长</span><b>${formatHM(eyeAvg)}</b></div>
        <div class="row"><span>拿起手机使用次数</span><b>${eyeSess} 段</b></div>
        <div class="row"><span>走神时长</span><b>${formatHM(eyeAway)}</b></div>
        <div class="row"><span>离场时长</span><b>${formatHM(eyeNo)}</b></div>
        <div class="row"><span>真实注视占比</span><b>${focusRate}</b></div>`;
    }

    $("reportCard").hidden=false;

    $("reportBody").innerHTML=`
        <div class="row"><span>累计记录天数</span><b>${records.filter(i=>i.seconds>0).length} 天</b></div>
        <div class="row"><span>累计深夜时长（页面法）</span><b>${formatHM(total)}（约 ${(total/3600).toFixed(1)} 小时）</b></div>
        <div class="row"><span>日均深夜时长</span><b>${formatHM(avg)}</b></div>
        <div class="row"><span>熬得最久一天</span><b>${worst?worst.date+" · "+formatHM(worst.seconds):"--"}</b></div>
        <div class="row"><span>控制最好一天</span><b>${best?best.date+" · "+formatHM(best.seconds):"--"}</b></div>
        <div class="row"><span>近7天累计</span><b>${formatHM(recent)}</b></div>
        ${eyeBlock}
        <div class="verdict">
            📌 小结：${relate}<br>
            ${hasEyeData()
                ? "「真实注视占比」＝摄像头判定注视时长 ÷ 页面停留时长。"
                : "尚未产生摄像头判定数据，开启眼动监测后再复盘可获得「真实注视占比」。"}
            <br>
            提示：页面停留法统计网页开着且在前台的时长；眼动法统计人脸在画面内、眼睛睁开、视线正对屏幕的时长。
        </div>`;

    drawTrend();
    drawCompare();

    $("reportCard").scrollIntoView({behavior:"smooth"});
};

/* ============================================================
 * 数据导出
 * ============================================================ */

$("exportBtn").onclick=()=>{
    const data={
        setting,
        records,
        evals,
        hoursAgg,
        eyeData,
        nightGoal,
        theme:currentTheme,
        exportAt:new Date().toISOString()
    };

    const blob=new Blob(
        [JSON.stringify(data,null,2)],
        {type:"application/json"}
    );

    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download="midnight-screen-log-数据.json";
    a.click();

    URL.revokeObjectURL(a.href);
};

/* ============================================================
 * 新增：日历视图
 * ============================================================ */

let calendarDate=new Date();
let selectedDate=todayKey();

function renderCalendar(){
    const year=calendarDate.getFullYear();
    const month=calendarDate.getMonth();

    $("calendarMonth").textContent=
        `${year}年 ${String(month+1).padStart(2,"0")}月`;

    const container=$("calendarDays");
    container.innerHTML="";

    const firstDay=new Date(year,month,1).getDay();
    const daysInMonth=new Date(year,month+1,0).getDate();
    const today=todayKey();

    for(let i=0;i<firstDay;i++){
        const empty=document.createElement("div");
        empty.className="calendar-day empty";
        container.appendChild(empty);
    }

    for(let day=1;day<=daysInMonth;day++){
        const key=
            `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;

        const sec=getSecOf(key);
        const ed=eyeData[key];

        const hasRecord=
            sec>0 ||
            !!evals[key] ||
            !!(ed && (
                ed.using>0 ||
                ed.away>0 ||
                ed.noface>0 ||
                ed.sessions>0
            ));

        const cell=document.createElement("div");
        cell.className="calendar-day";

        if(hasRecord) cell.classList.add("has-record");

        if(sec>0 && sec<=nightGoal*60){
            cell.classList.add("meet-goal");
        }

        if(sec>nightGoal*60){
            cell.classList.add("over-goal");
        }

        if(key===selectedDate) cell.classList.add("selected");
        if(key===today) cell.classList.add("today");

        const number=document.createElement("span");
        number.className="day-number";
        number.textContent=day;

        cell.appendChild(number);

        if(hasRecord){
            const dot=document.createElement("span");
            dot.className="day-dot";
            cell.appendChild(dot);
        }

        cell.onclick=()=>{
            selectedDate=key;
            renderCalendar();
        };

        container.appendChild(cell);
    }

    renderDayDetail(selectedDate);
}

/* 日期详情 */

function renderDayDetail(key){
    if(!key) return;

    const sec=getSecOf(key);

    const ed=eyeData[key] || {
        using:0,
        away:0,
        noface:0,
        sessions:0
    };

    const evaluation=evals[key];

    const fatigueText=["很精神","还行","一般","疲惫","非常累"];
    const controlText=["很差","不太好","一般","比较满意","很满意"];
    const willText=["更想少用","没变化","更想用了"];

    const goalText=sec===0
        ? "暂无页面时长记录"
        : sec<=nightGoal*60 ? "✅ 达标" : "⚠️ 超标";

    const evaluationHTML=evaluation ? `
        <div class="calendar-detail-row">
            <span>熬夜疲劳感</span>
            <b>${fatigueText[evaluation.fatigue-1]||"--"}</b>
        </div>
        <div class="calendar-detail-row">
            <span>自我控制满意度</span>
            <b>${controlText[evaluation.control-1]||"--"}</b>
        </div>
        <div class="calendar-detail-row">
            <span>使用意愿变化</span>
            <b>${willText[evaluation.will]||"--"}</b>
        </div>
    ` : `
        <div class="calendar-detail-row">
            <span>主观自评</span>
            <b>暂无记录</b>
        </div>
    `;

    $("detailDate").textContent=key+" · 当日记录";

    $("calendarDetailBody").innerHTML=`
        <div class="calendar-detail-row">
            <span>页面停留时长</span>
            <b>${formatHM(sec)}</b>
        </div>
        <div class="calendar-detail-row">
            <span>熬夜目标</span>
            <b>${formatHM(nightGoal*60)}</b>
        </div>
        <div class="calendar-detail-row">
            <span>目标完成情况</span>
            <b>${goalText}</b>
        </div>
        <div class="calendar-detail-row">
            <span>摄像头有效注视时长</span>
            <b>${formatHM(ed.using)}</b>
        </div>
        <div class="calendar-detail-row">
            <span>走神时长</span>
            <b>${formatHM(ed.away)}</b>
        </div>
        <div class="calendar-detail-row">
            <span>离场时长</span>
            <b>${formatHM(ed.noface)}</b>
        </div>
        <div class="calendar-detail-row">
            <span>使用段数</span>
            <b>${ed.sessions||0} 段</b>
        </div>
        ${evaluationHTML}
    `;
}

$("prevMonth").onclick=()=>{
    calendarDate.setMonth(calendarDate.getMonth()-1);
    renderCalendar();
};

$("nextMonth").onclick=()=>{
    calendarDate.setMonth(calendarDate.getMonth()+1);
    renderCalendar();
};

/* ============================================================
 * 新增：清空单日记录
 * ============================================================ */

$("clearDayBtn").onclick=()=>{
    const key=selectedDate;

    if(!key){
        alert("请先选择一个日期。");
        return;
    }

    const hasData=
        getSecOf(key)>0 ||
        !!evals[key] ||
        !!eyeData[key];

    if(!hasData){
        alert("这一天没有可清除的记录。");
        return;
    }

    if(!confirm(`确定清空 ${key} 的全部记录吗？此操作不可恢复。`)){
        return;
    }

    // 如果正在记录当天，先结束当前监测
    if(isRunning && currentKey===key){
        isRunning=false;
        currentKey=null;
        accumulatedSec=0;

        startBtn.textContent="开启监测";
        startBtn.classList.remove("running");
    }

    records=records.filter(i=>i.date!==key);
    delete evals[key];
    delete eyeData[key];

    localStorage.setItem(LS.records,JSON.stringify(records));
    localStorage.setItem(LS.evals,JSON.stringify(evals));
    localStorage.setItem(LS.eye,JSON.stringify(eyeData));

    // 眼动当前会话不再继续向已清除日期累计
    if(eye.running){
        eye.state="idle";
        eye.lastTs=performance.now();
        eye.lastUsingTs=0;
    }

    drawTrend();
    drawCompare();
    render();
    renderEye();
    renderCalendar();
    renderGoal();

    alert(`${key} 的记录已清空。`);
};

/* ============================================================
 * 清空全部历史记录
 * 保留主题、目标、深夜时段设置
 * ============================================================ */

$("clearBtn").onclick=()=>{
    if(!confirm("确定清空全部本地记录？此操作不可恢复。")){
        return;
    }

    records=[];
    evals={};
    hoursAgg={};
    eyeData={};

    localStorage.removeItem(LS.records);
    localStorage.removeItem(LS.evals);
    localStorage.removeItem(LS.hours);
    localStorage.removeItem(LS.eye);

    accumulatedSec=0;

    if(isRunning){
        isRunning=false;
        currentKey=null;

        startBtn.textContent="开启监测";
        startBtn.classList.remove("running");
    }

    if(eye.running){
        eye.state="idle";
        eye.lastTs=performance.now();
        eye.lastUsingTs=0;
    }

    drawTrend();
    drawCompare();
    render();
    renderEye();
    renderCalendar();
    renderGoal();

    alert("全部历史记录已清空，主题、目标和时段设置已保留。");
};

/* ============================================================
 * 新增：卡片独立折叠 / 展开
 * ============================================================ */

function initCardCollapse(){
    const cards=document.querySelectorAll(".wrap > .card");

    cards.forEach((card,index)=>{
        if(card.querySelector(".card-collapse-btn")) return;

        const id="card_"+index;
        const btn=document.createElement("button");

        btn.className="card-collapse-btn";

        function update(){
            const collapsed=!!collapseState[id];

            card.classList.toggle("is-collapsed",collapsed);
            btn.textContent=collapsed?"展开 ↓":"收起 ↑";
        }

        btn.onclick=(event)=>{
            event.stopPropagation();

            collapseState[id]=!collapseState[id];

            localStorage.setItem(
                LS.collapse,
                JSON.stringify(collapseState)
            );

            update();
        };

        card.insertBefore(btn,card.firstChild);
        update();
    });
}

/* ============================================================
 * 初始化
 * ============================================================ */

initCardCollapse();

drawTrend();
drawCompare();

render();
renderEye();
renderGoal();
renderCalendar();

tick();
