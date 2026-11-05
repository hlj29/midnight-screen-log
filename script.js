let timeSetting = JSON.parse(localStorage.getItem("nightTimeSet")) || {start:"23:00", end:"06:00"};

let recordList = JSON.parse(localStorage.getItem("nightRecord")) || [];
let isRunning = false;
let startTime = null;
let todayKey = getTodayKey();

const statusDom = document.getElementById("status");
const todayTimeDom = document.getElementById("todayTime");
const startBtn = document.getElementById("startBtn");
const reportBtn = document.getElementById("reportBtn");
const nightStartInput = document.getElementById("nightStartInput");
const nightEndInput = document.getElementById("nightEndInput");
const saveTimeBtn = document.getElementById("saveTimeBtn");

nightStartInput.value = timeSetting.start;
nightEndInput.value = timeSetting.end;

function timeStrToHour(str){
    const [h,m] = str.split(":").map(Number);
    return h + m / 60;
}

function getTodayKey(){
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function isNightTime(){
    const nowHour = new Date().getHours() + new Date().getMinutes() / 60;
    const s = timeStrToHour(timeSetting.start);
    const e = timeStrToHour(timeSetting.end);
    if(s > e){
        return nowHour >= s || nowHour < e;
    }else{
        return nowHour >= s && nowHour <= e;
    }
}

function formatSec(sec){
    let h = Math.floor(sec / 3600);
    let m = Math.floor((sec % 3600)/60);
    return String(h).padStart(2,'0')+":"+String(m).padStart(2,'0');
}

saveTimeBtn.onclick = ()=>{
    timeSetting.start = nightStartInput.value;
    timeSetting.end = nightEndInput.value;
    localStorage.setItem("nightTimeSet", JSON.stringify(timeSetting));
    alert("✅ 深夜时段已保存！");
}

startBtn.onclick = ()=>{
    if(isRunning) return;
    isRunning = true;
    startTime = Date.now();
    statusDom.innerText = "✅ 监测中（切后台回来自动校准）";
    runTick();
}

function runTick(){
    if(!isRunning) return;
    const now = Date.now();
    const passSec = Math.floor((now - startTime)/1000);
    if(isNightTime()){
        let todayItem = recordList.find(i=>i.date === todayKey);
        if(!todayItem){
            todayItem = {date:todayKey, seconds:0};
            recordList.push(todayItem);
        }
        todayItem.seconds = passSec;
        localStorage.setItem("nightRecord", JSON.stringify(recordList));
    }
    todayTimeDom.innerText = formatSec(recordList.find(i=>i.date===todayKey)?.seconds || 0);
    setTimeout(runTick, 3000);
}

reportBtn.onclick = ()=>{
    if(recordList.length === 0){
        alert("暂无记录，先开启监测！");
        return;
    }
    let totalSec = recordList.reduce((sum,item)=>sum+item.seconds,0);
    let maxItem = recordList.reduce((a,b)=> a.seconds > b.seconds ? a : b);
    alert(`==== 复盘报告 ====
记录天数：${recordList.length}天
总熬夜时长：${formatSec(totalSec)}
熬夜最多一天：${maxItem.date}，时长${formatSec(maxItem.seconds)}`);
    drawChart();
}

let chart;
function drawChart(){
    const ctx = document.getElementById("timeChart").getContext("2d");
    const labels = recordList.map(i=>i.date);
    const data = recordList.map(i=> (i.seconds / 3600).toFixed(2));
    if(chart) chart.destroy();
    chart = new Chart(ctx,{
        type:"line",
        data:{
            labels:labels,
            datasets:[{
                label:"每日深夜时长（h）",
                data:data,
                borderColor:"#b8a9c9",
                backgroundColor:"rgba(184,169,201,0.12)",
                fill:true,
                tension:0.45,
                pointRadius:3,
                pointHoverRadius:6,
                borderWidth:2
            }]
        },
        options:{
            plugins:{
                legend:{display:false}
            },
            scales:{
                x:{grid:{display:false},ticks:{color:"#8c8c9b"}},
                y:{grid:{color:"rgba(184,169,201,0.12)"},ticks:{color:"#8c8c9b"}}
            }
        }
    })
}

document.addEventListener("visibilitychange",()=>{
    if(!document.hidden && isRunning){
        startTime = Date.now() - (recordList.find(i=>i.date===todayKey)?.seconds || 0)*1000;
    }
})
