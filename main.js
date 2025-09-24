// main.js — 前端图像 -> 曲线 -> 标定 -> 平滑 -> 峰值检测（纯 JS + Canvas + Chart.js）

// 主要数据存放
let state = {
  img: null,            // HTMLImageElement
  canvasScale: 1,       // canvas 相对于原始图片的缩放
  crop: null,           // {x,y,w,h} 裁剪到的画布区域（像素，canvas 坐标）
  pixels: null,         // 提取到的像素点数组（以 crop 宽度为长度）
  dataXY: null,         // [{x:..., y:...}, ...] 物理坐标数组（经标定后）
  calibA: null,         // {px:{x,y}, val:{x,y}}
  calibB: null,
  chart: null
};

// DOM
const fileInput = document.getElementById('fileInput');
const imgCanvas = document.getElementById('imgCanvas');
const ctx = imgCanvas.getContext('2d');
const autoCropBtn = document.getElementById('autoCropBtn');
const resetBtn = document.getElementById('resetBtn');
const detectBtn = document.getElementById('detectBtn');

const setA = document.getElementById('setA');
const setB = document.getElementById('setB');
const axSpan = document.getElementById('ax'), aySpan = document.getElementById('ay');
const bxSpan = document.getElementById('bx'), bySpan = document.getElementById('by');
const axVal = document.getElementById('axVal'), ayVal = document.getElementById('ayVal');
const bxVal = document.getElementById('bxVal'), byVal = document.getElementById('byVal');

const smoothWindowInput = document.getElementById('smoothWindow');
const minHeightInput = document.getElementById('minHeight');
const minDistanceInput = document.getElementById('minDistance');

const downloadCsvBtn = document.getElementById('downloadCsv');
const downloadPeaksBtn = document.getElementById('downloadPeaks');

const resultSummary = document.getElementById('resultSummary');
const peaksTableWrap = document.getElementById('peaksTableWrap');

// 变量定位：点击是记录 A 点 还是 B 点
let clickMode = null; // "A" or "B"

// helper: load image to canvas (fit to max width)
function loadImageToCanvas(img) {
  const maxW = 1200;
  const ratio = Math.min(1, maxW / img.width);
  imgCanvas.width = Math.round(img.width * ratio);
  imgCanvas.height = Math.round(img.height * ratio);
  state.canvasScale = ratio;
  ctx.clearRect(0,0,imgCanvas.width, imgCanvas.height);
  ctx.drawImage(img, 0, 0, imgCanvas.width, imgCanvas.height);
  state.crop = {x:0,y:0,w:imgCanvas.width, h:imgCanvas.height};
  drawMarkers();
}

// draw any markers (A, B, crop)
function drawMarkers() {
  // redraw image then markers
  if(!state.img) return;
  ctx.clearRect(0,0,imgCanvas.width, imgCanvas.height);
  ctx.drawImage(state.img, 0, 0, imgCanvas.width, imgCanvas.height);

  ctx.lineWidth = 2;
  if(state.calibA && state.calibA.px) {
    ctx.strokeStyle = '#ff6b6b';
    ctx.beginPath();
    ctx.arc(state.calibA.px.x, state.calibA.px.y, 6, 0, Math.PI*2);
    ctx.stroke();
  }
  if(state.calibB && state.calibB.px) {
    ctx.strokeStyle = '#2b7cff';
    ctx.beginPath();
    ctx.arc(state.calibB.px.x, state.calibB.px.y, 6, 0, Math.PI*2);
    ctx.stroke();
  }
  // crop rectangle
  if(state.crop) {
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.setLineDash([6,4]);
    ctx.strokeRect(state.crop.x, state.crop.y, state.crop.w, state.crop.h);
    ctx.setLineDash([]);
  }
}

// 自动裁剪：找到非白（亮）像素的边界
function autoCrop() {
  if(!state.img) return;
  const w = imgCanvas.width, h = imgCanvas.height;
  const imgData = ctx.getImageData(0,0,w,h);
  const data = imgData.data;
  const isNonWhite = (i) => {
    const r = data[i], g = data[i+1], b = data[i+2];
    // 用灰度判断是否“非白”
    const gray = 0.299*r + 0.587*g + 0.114*b;
    return gray < 245; // 245 作为阈值（可调整）
  };
  let minX=w, maxX=0, minY=h, maxY=0;
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const idx = (y*w + x)*4;
      if(isNonWhite(idx)){
        if(x<minX) minX=x;
        if(x>maxX) maxX=x;
        if(y<minY) minY=y;
        if(y>maxY) maxY=y;
      }
    }
  }
  // 若找不到非白像素则保留整张图
  if(maxX<=minX || maxY<=minY){
    state.crop = {x:0,y:0,w:w,h:h};
  } else {
    // pad 少许
    const pad = 6;
    state.crop = {
      x: Math.max(0, minX - pad),
      y: Math.max(0, minY - pad),
      w: Math.min(w - 1, maxX + pad) - Math.max(0, minX - pad),
      h: Math.min(h - 1, maxY + pad) - Math.max(0, minY - pad)
    };
  }
  drawMarkers();
  resultSummary.innerText = `已自动裁剪：x=${state.crop.x}, y=${state.crop.y}, w=${state.crop.w}, h=${state.crop.h}`;
}

// 从裁剪区域按列提取曲线：每列取灰度最小（最暗）像素行
function extractCurveFromCanvas() {
  if(!state.crop) return;
  const {x,y,w,h} = state.crop;
  const imgData = ctx.getImageData(x, y, w, h);
  const data = imgData.data;
  const rows = h, cols = w;
  const arr = new Array(cols).fill(null);
  for(let col=0; col<cols; col++){
    let minVal = 255, minRow = -1;
    for(let row=0; row<rows; row++){
      const idx = (row*cols + col)*4;
      const r = data[idx], g = data[idx+1], b = data[idx+2];
      const gray = 0.299*r + 0.587*g + 0.114*b;
      if(gray < minVal){
        minVal = gray;
        minRow = row;
      }
    }
    // 如果整列都是白（minVal 很大），仍然取 argmin 以保证连续性
    if(minRow >= 0) arr[col] = {px: x + col, py: y + minRow, gray: minVal};
    else arr[col] = null;
  }
  // 插值填补 null
  for(let i=0;i<cols;i++){
    if(arr[i]===null){
      // 找左右最近非空
      let l=i-1; while(l>=0 && arr[l]===null) l--;
      let r=i+1; while(r<cols && arr[r]===null) r++;
      if(l>=0 && r<cols){
        // 线性插值
        const t = (i - l) / (r - l);
        const py = arr[l].py * (1-t) + arr[r].py * t;
        arr[i] = {px: x + i, py: Math.round(py), gray: 255};
      } else if(l>=0) arr[i] = {px:x+i, py: arr[l].py, gray:255};
      else if(r<cols) arr[i] = {px:x+i, py: arr[r].py, gray:255};
      else arr[i] = {px:x+i, py: y + rows/2, gray:255};
    }
  }
  state.pixels = arr;
  return arr;
}

// 将像素序列（crop 内每列的 py）映射到物理坐标（通过标定 A, B）
function mapPixelsToData() {
  if(!state.pixels) return;
  const A = state.calibA, B = state.calibB;
  const arr = state.pixels;
  // 默认：如果未标定，X: left->0 right->1; Y: bottom->0 top->1
  let mapX = (px) => px;
  let mapY = (py) => py;
  if(A && B && A.px && B.px && A.val && B.val &&
     Number.isFinite(A.val.x) && Number.isFinite(B.val.x) &&
     Number.isFinite(A.val.y) && Number.isFinite(B.val.y)) {
    // 像素坐标到数据坐标线性映射（独立 x,y 映射）
    const pxA = A.px.x, pxB = B.px.x;
    const valAx = A.val.x, valBx = B.val.x;
    const pxAy = A.px.y, pxBy = B.px.y;
    const valAy = A.val.y, valBy = B.val.y;
    const denomX = (pxB - pxA) || 1;
    const denomY = (pxBy - pxAy) || 1; // 注意：我们使用 px.y 映射到 y 值；y 像素向下为正
    mapX = (px) => valAx + ( (px - pxA) * (valBx - valAx) / denomX );
    // mapY 需考虑屏幕向下为正；这里直接做两点线性映射： pixel_y -> val_y
    mapY = (py) => valAy + ( (py - pxAy) * (valBy - valAy) / denomY );
  } else {
    // 默认映射
    const leftPX = state.crop.x;
    const rightPX = state.crop.x + state.crop.w - 1;
    mapX = (px) => (px - leftPX) / (rightPX - leftPX);
    const topPY = state.crop.y;
    const bottomPY = state.crop.y + state.crop.h - 1;
    mapY = (py) => (bottomPY - py) / (bottomPY - topPY); // invert so larger y value on top maps to larger number
  }

  const dataXY = arr.map(pt => {
    return { x: mapX(pt.px), y: mapY(pt.py) };
  });
  state.dataXY = dataXY;
  return dataXY;
}

// 平滑（简单移动平均）
function smoothArray(yArr, window) {
  if(window<=1) return yArr.slice();
  if(window % 2 === 0) window += 1; // 强制奇数
  const half = Math.floor(window/2);
  const n = yArr.length;
  const out = new Array(n);
  for(let i=0;i<n;i++){
    let sum = 0, cnt = 0;
    for(let j = i-half; j <= i+half; j++){
      if(j>=0 && j<n){ sum += yArr[j]; cnt++; }
    }
    out[i] = sum / cnt;
  }
  return out;
}

// 峰检测：先找局部极大点，再按最小峰距和最小峰高筛选
function findPeaks(xArr, yArr, minHeight, minDistX) {
  const n = yArr.length;
  const candidates = [];
  for(let i=1;i<n-1;i++){
    if(yArr[i] > yArr[i-1] && yArr[i] >= yArr[i+1]) {
      candidates.push({idx:i, x:xArr[i], y:yArr[i]});
    }
  }
  // 过滤最小高度
  let filtered = candidates;
  if(Number.isFinite(minHeight)) {
    filtered = filtered.filter(p => p.y >= minHeight);
  }
  // 非极大抑制（按 y 排序，确保 minDistX）
  filtered.sort((a,b) => b.y - a.y);
  const kept = [];
  for(const cand of filtered){
    let ok = true;
    for(const k of kept){
      if(Math.abs(cand.x - k.x) < minDistX) { ok = false; break; }
    }
    if(ok) kept.push(cand);
  }
  // 按 x 升序返回
  kept.sort((a,b) => a.idx - b.idx);
  return kept;
}

// 绘图（Chart.js）
function plotData(rawXY, smoothY, peaks) {
  const ctxChart = document.getElementById('chart').getContext('2d');
  if(state.chart) state.chart.destroy();
  const labels = rawXY.map(p => p.x);
  const rawData = rawXY.map(p => p.y);
  const smoothData = smoothY;
  const peakPoints = peaks.map(p => ({x:p.x, y:p.y}));

  state.chart = new Chart(ctxChart, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        { label: '原始（映射后）', data: rawData, borderWidth:1, pointRadius:0, tension:0.2, fill:false },
        { label: '平滑后', data: smoothData, borderWidth:2, pointRadius:0, tension:0.25, fill:false, borderDash:[6,2] },
        { label: '峰值', data: peakPoints, type:'scatter', pointRadius:5, showLine:false, backgroundColor:'red' }
      ]
    },
    options: {
      parsing: false,
      animation:false,
      scales: {
        x: { title:{display:true, text:'X (物理单位)'} },
        y: { title:{display:true, text:'Y (物理单位)'} }
      },
      plugins: { legend:{position:'top'} },
      elements: { point: { radius: 0 } }
    }
  });
}

// 导出 CSV
function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(v => (typeof v === 'number' ? v : JSON.stringify(v))).join(',')).join('\n');
  const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// UI & 事件
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if(!file) return;
  const name = file.name.toLowerCase();
  if(name.endsWith('.csv')) {
    // 解析 CSV：假定两列 x,y（带或不带表头）
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      const lines = text.split(/\r?\n/).filter(Boolean);
      const rows = lines.map(l => l.split(',').map(s=>s.trim()));
      // 如果第一行包含非数字（表头），跳过
      let start = 0;
      if(rows.length && rows[0].some(c=>isNaN(Number(c)))) start = 1;
      const xy = [];
      for(let i=start;i<rows.length;i++){
        const r = rows[i];
        if(r.length>=2 && !isNaN(Number(r[0])) && !isNaN(Number(r[1]))){
          xy.push({x: Number(r[0]), y: Number(r[1])});
        }
      }
      if(xy.length===0){ alert('CSV 解析失败或格式不符合（需两列数字）'); return; }
      // 直接显示 CSV 数据（跳过图像流程）
      state.dataXY = xy;
      // 生成 simple plot
      const rawX = xy.map(p=>p.x), rawY = xy.map(p=>p.y);
      const smoothY = smoothArray(rawY, parseInt(smoothWindowInput.value||11));
      const minHeight = Number(minHeightInput.value) || undefined;
      const minDistX = Number(minDistanceInput.value) || 0;
      const peaks = findPeaks(rawX, smoothY, minHeight, minDistX);
      plotData(xy, smoothY, peaks);
      showPeaksTable(peaks);
    };
    reader.readAsText(file);
    return;
  }

  // 图片文件
  const img = new Image();
  const reader = new FileReader();
  reader.onload = () => {
    img.onload = () => {
      state.img = img;
      loadImageToCanvas(img);
      resultSummary.innerText = '图片已加载，请（可选）自动裁剪或直接点击图像做标定';
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

autoCropBtn.addEventListener('click', () => {
  autoCrop();
});

resetBtn.addEventListener('click', () => {
  // 清除标定、结果
  state.calibA = null; state.calibB = null;
  axSpan.textContent = '—'; aySpan.textContent = '—'; bxSpan.textContent = '—'; bySpan.textContent = '—';
  axVal.value = ayVal.value = bxVal.value = byVal.value = '';
  state.pixels = null; state.dataXY = null;
  if(state.chart) state.chart.destroy();
  peaksTableWrap.innerHTML = '';
  resultSummary.innerText = '已重置';
  drawMarkers();
});

// 点击画布设置标定点（取像素坐标）
imgCanvas.addEventListener('click', (ev) => {
  if(!state.img) return;
  const rect = imgCanvas.getBoundingClientRect();
  const cx = ev.clientX - rect.left;
  const cy = ev.clientY - rect.top;
  if(clickMode === 'A') {
    state.calibA = state.calibA || {};
    state.calibA.px = {x: Math.round(cx), y: Math.round(cy)};
    axSpan.textContent = state.calibA.px.x; aySpan.textContent = state.calibA.px.y;
    // 若用户已输入实际值，则存储
    state.calibA.val = { x: parseFloat(axVal.value) || null, y: parseFloat(ayVal.value) || null };
    clickMode = null;
  } else if(clickMode === 'B') {
    state.calibB = state.calibB || {};
    state.calibB.px = {x: Math.round(cx), y: Math.round(cy)};
    bxSpan.textContent = state.calibB.px.x; bySpan.textContent = state.calibB.px.y;
    state.calibB.val = { x: parseFloat(bxVal.value) || null, y: parseFloat(byVal.value) || null };
    clickMode = null;
  } else {
    // 默认点击不做设置，但仍显示点（方便手动标记）
    // 我们把它作为设置 A 点的快捷方式（可改）
    state.calibA = state.calibA || {};
    state.calibA.px = {x: Math.round(cx), y: Math.round(cy)};
    axSpan.textContent = state.calibA.px.x; aySpan.textContent = state.calibA.px.y;
  }
  drawMarkers();
});

setA.addEventListener('click', () => { clickMode = 'A'; resultSummary.innerText = '点击画布选择 A 点位置'; });
setB.addEventListener('click', () => { clickMode = 'B'; resultSummary.innerText = '点击画布选择 B 点位置'; });

axVal.addEventListener('change', () => {
  if(!state.calibA) state.calibA = {};
  state.calibA.val = { x: parseFloat(axVal.value) || null, y: parseFloat(ayVal.value) || null };
});
ayVal.addEventListener('change', () => {
  if(!state.calibA) state.calibA = {};
  state.calibA.val = { x: parseFloat(axVal.value) || null, y: parseFloat(ayVal.value) || null };
});
bxVal.addEventListener('change', () => {
  if(!state.calibB) state.calibB = {};
  state.calibB.val = { x: parseFloat(bxVal.value) || null, y: parseFloat(byVal.value) || null };
});
byVal.addEventListener('change', () => {
  if(!state.calibB) state.calibB = {};
  state.calibB.val = { x: parseFloat(bxVal.value) || null, y: parseFloat(byVal.value) || null };
});

// 主流程：提取 -> 标定映射 -> 平滑 -> 峰检 -> 绘图
detectBtn.addEventListener('click', () => {
  if(!state.img && !state.dataXY){ alert('请先上传图片或 CSV'); return; }

  // 若是图片流程
  if(state.img) {
    // 若未裁剪，先自动裁剪一次
    if(!state.crop) autoCrop();
    extractCurveFromCanvas();
    mapPixelsToData();
  }
  if(!state.dataXY || state.dataXY.length===0){ alert('未能提取到数据'); return; }
  const rawXY = state.dataXY.slice();
  const xArr = rawXY.map(p => p.x);
  const yArr = rawXY.map(p => p.y);

  // 平滑
  const w = Math.max(1, parseInt(smoothWindowInput.value) || 11);
  const smoothY = smoothArray(yArr, w);

  // 峰检参数
  const minHeight = Number(minHeightInput.value);
  const minDist = Number(minDistanceInput.value) || 0;

  // minDist（物理单位）转换为索引距离
  const xRange = xArr[xArr.length-1] - xArr[0] || 1;
  const dx = xRange / (xArr.length - 1);
  const minDistIdx = Math.max(1, Math.round(minDist / dx));

  // findPeaks expects xArr and yArr (这里传 xArr 和 smoothY)
  const peaks = findPeaks(xArr, smoothY, Number.isFinite(minHeight) ? minHeight : undefined, minDist);

  plotData(rawXY, smoothY, peaks);
  showPeaksTable(peaks);
  resultSummary.innerText = `检测完成：数据点 ${rawXY.length}，检测到峰 ${peaks.length}`;
});

// 显示峰表格
function showPeaksTable(peaks) {
  if(!peaks || peaks.length===0){ peaksTableWrap.innerHTML = '<p>未检测到峰值</p>'; return; }
  let html = '<table><thead><tr><th>#</th><th>X</th><th>Y</th></tr></thead><tbody>';
  peaks.forEach((p,i)=> {
    html += `<tr><td>${i+1}</td><td>${p.x}</td><td>${p.y}</td></tr>`;
  });
  html += '</tbody></table>';
  peaksTableWrap.innerHTML = html;
}

// 下载
downloadCsvBtn.addEventListener('click', () => {
  if(!state.dataXY) { alert('无曲线数据可导出'); return; }
  const rows = [['x','y']].concat(state.dataXY.map(p=>[p.x, p.y]));
  downloadCSV('curve.csv', rows);
});
downloadPeaksBtn.addEventListener('click', () => {
  if(!state.chart){ alert('请先检测峰值并绘图'); return; }
  // 从 peaksTableWrap 中读取或重算
  // 为简洁：重新计算 peaks
  const rawXY = state.dataXY;
  const xArr = rawXY.map(p=>p.x), yArr = rawXY.map(p=>p.y);
  const smoothY = smoothArray(yArr, parseInt(smoothWindowInput.value||11));
  const minHeight = Number(minHeightInput.value);
  const minDist = Number(minDistanceInput.value) || 0;
  const peaks = findPeaks(xArr, smoothY, Number.isFinite(minHeight) ? minHeight : undefined, minDist);
  if(!peaks.length) { alert('未检测到峰'); return; }
  const rows = [['index','x','y']].concat(peaks.map((p,i)=>[i+1, p.x, p.y]));
  downloadCSV('peaks.csv', rows);
});


// 页面刚打开时的初始化（清空）
function init() {
  imgCanvas.width = 800; imgCanvas.height = 400;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0,0,imgCanvas.width,imgCanvas.height);
  resultSummary.innerText = '请上传电化学图像或 CSV 数据开始';
}
init();
