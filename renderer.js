// Select DOM elements
const brandInput = document.getElementById("brandInput");
const maxInput = document.getElementById("maxInput");
const channelSelect = document.getElementById("channelSelect");
const apiUrlInput = document.getElementById("apiUrlInput");

const btnLaunch = document.getElementById("btnLaunch");
const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const btnOpenFolder = document.getElementById("btnOpenFolder");
const btnClearLogs = document.getElementById("btnClearLogs");
const btnUpdate = document.getElementById("btnUpdate");

const statusIndicator = document.getElementById("statusIndicator");
const statusLabel = document.getElementById("statusLabel");

const statCurrent = document.getElementById("statCurrent");
const statSent = document.getElementById("statSent");
const statSkipped = document.getElementById("statSkipped");

const terminalBody = document.getElementById("terminalBody");
let updateAction = "check";

// Clear console logs
btnClearLogs.addEventListener("click", () => {
  terminalBody.innerHTML = `
    <div class="log-line">
      <span class="log-time">[Hệ thống]</span>
      <span class="log-text system">Logs cleared.</span>
    </div>
  `;
});

// Helper: Append log line
function appendLog(text, type = "normal") {
  const line = document.createElement("div");
  line.className = "log-line";
  
  const timeSpan = document.createElement("span");
  timeSpan.className = "log-time";
  timeSpan.textContent = `[${new Date().toLocaleTimeString()}]`;
  
  const textSpan = document.createElement("span");
  textSpan.className = `log-text ${type}`;
  textSpan.textContent = text;
  
  line.appendChild(timeSpan);
  line.appendChild(textSpan);
  terminalBody.appendChild(line);
  
  // Auto scroll to bottom
  terminalBody.scrollTop = terminalBody.scrollHeight;
}

// Helper: Determine log type from message content
function getLogType(message) {
  if (message.includes("Thành công") || message.includes("hoàn tất") || message.includes("Hub thành công")) {
    return "success";
  }
  if (message.includes("Bỏ qua") || message.includes("Cảnh báo") || message.includes("skip")) {
    return "warning";
  }
  if (message.includes("Lỗi") || message.includes("error") || message.includes("fail")) {
    return "danger";
  }
  if (message.includes("Khởi động") || message.includes("Đang mở") || message.includes("đọc danh sách")) {
    return "info";
  }
  return "normal";
}

// 1. Launch Browser
btnLaunch.addEventListener("click", () => {
  const options = {
    channel: channelSelect.value,
  };
  window.api.launchBrowser(options);
});

// 2. Start Scraping
btnStart.addEventListener("click", () => {
  const options = {
    brand: brandInput.value.trim(),
    maxCreators: parseInt(maxInput.value) || 0,
    hubApiUrl: apiUrlInput.value.trim() || "https://hub.bomax.vn/bomax/api/koc",
  };
  
  // Reset UI stats
  statSent.textContent = "0";
  statSkipped.textContent = "0";
  statCurrent.textContent = "Bắt đầu...";
  
  window.api.startScraping(options);
});

// 3. Stop Scraping
btnStop.addEventListener("click", () => {
  window.api.stopScraping();
});

// 4. Open Output Folder
btnOpenFolder.addEventListener("click", () => {
  window.api.openOutputFolder();
});

function requestUpdateCheck() {
  updateAction = "check";
  btnUpdate.disabled = true;
  btnUpdate.textContent = "Đang kiểm tra...";
  window.api.checkForUpdates();
}

btnUpdate.addEventListener("click", () => {
  if (updateAction === "download" || updateAction === "install") {
    window.api.installUpdate();
    return;
  }

  requestUpdateCheck();
});

// IPC: Log Receiver
window.api.onLog((log) => {
  const type = getLogType(log.text);
  appendLog(log.text, type);
});

// IPC: Stats Receiver
window.api.onStats((stats) => {
  if (stats.sent !== undefined) statSent.textContent = stats.sent;
  if (stats.skipped !== undefined) statSkipped.textContent = stats.skipped;
  if (stats.currentCreator) statCurrent.textContent = stats.currentCreator;
});

// IPC: App State Change
window.api.onStateChange((state) => {
  // Reset classes
  statusIndicator.className = "status-indicator";
  statusIndicator.classList.add(state);
  
  switch(state) {
    case "idle":
      statusLabel.textContent = "Chưa khởi động";
      btnLaunch.disabled = false;
      btnStart.disabled = true;
      btnStop.disabled = true;
      
      brandInput.disabled = false;
      maxInput.disabled = false;
      channelSelect.disabled = false;
      apiUrlInput.disabled = false;
      break;
      
    case "launching-browser":
      statusLabel.textContent = "Đang mở trình duyệt...";
      btnLaunch.disabled = true;
      btnStart.disabled = true;
      btnStop.disabled = false;
      
      brandInput.disabled = true;
      maxInput.disabled = true;
      channelSelect.disabled = true;
      apiUrlInput.disabled = true;
      break;
      
    case "waiting-login":
      statusLabel.textContent = "Chờ đăng nhập / Lọc KOC";
      btnLaunch.disabled = true;
      btnStart.disabled = false;
      btnStop.disabled = false;
      
      // Keep inputs disabled to lock configuration
      brandInput.disabled = true;
      maxInput.disabled = true;
      channelSelect.disabled = true;
      apiUrlInput.disabled = true;
      break;
      
    case "scraping":
      statusLabel.textContent = "Đang cào dữ liệu...";
      btnLaunch.disabled = true;
      btnStart.disabled = true;
      btnStop.disabled = false;
      
      brandInput.disabled = true;
      maxInput.disabled = true;
      channelSelect.disabled = true;
      apiUrlInput.disabled = true;
      break;
  }
});

window.api.onUpdateState((state) => {
  if (!btnUpdate) return;

  if (state.status === "checking") {
    updateAction = "check";
    btnUpdate.disabled = true;
    btnUpdate.textContent = "Đang kiểm tra...";
    return;
  }

  if (state.status === "available") {
    updateAction = "download";
    btnUpdate.disabled = false;
    btnUpdate.textContent = state.version
      ? `Tải cập nhật ${state.version}`
      : "Tải cập nhật";
    return;
  }

  if (state.status === "downloading") {
    updateAction = "download";
    btnUpdate.disabled = true;
    btnUpdate.textContent = state.percent
      ? `Đang tải ${state.percent}%`
      : "Đang tải bản mới...";
    return;
  }

  if (state.status === "downloaded") {
    updateAction = "install";
    btnUpdate.disabled = false;
    btnUpdate.textContent = "Cập nhật & khởi động lại";
    return;
  }

  updateAction = "check";
  btnUpdate.disabled = false;
  btnUpdate.textContent = "Kiểm tra cập nhật";
});
