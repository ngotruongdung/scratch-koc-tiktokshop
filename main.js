const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const scraper = require("./scraper.js");

let mainWindow = null;
let appState = "idle"; // idle, waiting-login, scraping, completed
let updateReadyToInstall = false;

const isPackaged = app.isPackaged;
const appDir = isPackaged ? path.dirname(process.execPath) : process.cwd();

const defaultProfileDir = path.join(appDir, "tiktok-profile");
const defaultCsvPath = path.join(appDir, "results.csv");
const defaultJsonlPath = path.join(appDir, "results.jsonl");

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 750,
    title: "BOMAX KOC Worker",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
    backgroundColor: "#121212",
  });

  mainWindow.loadFile("index.html");

  mainWindow.on("closed", () => {
    mainWindow = null;
    scraper.stopScrape().catch(() => null);
  });
}

function updateState(newState) {
  appState = newState;
  if (mainWindow) {
    mainWindow.webContents.send("state-change", newState);
  }
}

function sendLog(message) {
  if (mainWindow) {
    mainWindow.webContents.send("log", {
      timestamp: new Date().toLocaleTimeString(),
      text: message,
    });
  }
}

function sendUpdateState(status, extra = {}) {
  if (mainWindow) {
    mainWindow.webContents.send("update-state", { status, ...extra });
  }
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    sendLog("Dang kiem tra phien ban moi...");
    sendUpdateState("checking");
  });

  autoUpdater.on("update-available", (info) => {
    sendLog(`Co phien ban moi ${info.version}. Dang tai cap nhat...`);
    sendUpdateState("downloading");
  });

  autoUpdater.on("update-not-available", () => {
    sendLog("Ban dang dung phien ban moi nhat.");
    sendUpdateState("idle");
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.round(progress.percent || 0);
    sendUpdateState("downloading", { percent });
  });

  autoUpdater.on("update-downloaded", async (info) => {
    updateReadyToInstall = true;
    sendLog(`Da tai xong phien ban ${info.version}.`);
    sendUpdateState("downloaded", { version: info.version });

    if (appState === "scraping") {
      sendLog("Cap nhat da san sang. Hay dung tien trinh cao roi bam cap nhat de khoi dong lai.");
      return;
    }

    if (!mainWindow) return;
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["Khoi dong lai ngay", "De sau"],
      defaultId: 0,
      cancelId: 1,
      title: "Cap nhat san sang",
      message: `BOMAX KOC Worker ${info.version} da tai xong.`,
      detail: "Khoi dong lai app de hoan tat cap nhat.",
    });

    if (result.response === 0) {
      autoUpdater.quitAndInstall(false, true);
    }
  });

  autoUpdater.on("error", (error) => {
    sendLog(`Loi cap nhat: ${error.message}`);
    sendUpdateState("idle");
  });
}

function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    sendLog("Auto update chi hoat dong tren ban da dong goi.");
    sendUpdateState("idle");
    return;
  }

  if (updateReadyToInstall) {
    sendUpdateState("downloaded");
    if (manual) {
      sendLog("Ban cap nhat da san sang. Bam cap nhat de khoi dong lai.");
    }
    return;
  }

  autoUpdater.checkForUpdates().catch((error) => {
    sendLog(`Loi kiem tra cap nhat: ${error.message}`);
    sendUpdateState("idle");
  });
}

app.whenReady().then(() => {
  setupAutoUpdater();
  createWindow();

  setTimeout(() => {
    checkForUpdates(false);
  }, 3000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

ipcMain.on("check-for-updates", () => {
  checkForUpdates(true);
});

ipcMain.on("install-update", () => {
  if (updateReadyToInstall) {
    autoUpdater.quitAndInstall(false, true);
  } else {
    checkForUpdates(true);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// IPC Handler: Launch Browser
ipcMain.on("launch-browser", async (event, options) => {
  try {
    updateState("launching-browser");
    sendLog("Đang chuẩn bị trình duyệt...");

    const runOptions = {
      profileDir: options.profileDir || defaultProfileDir,
      channel: options.channel || "",
    };

    await scraper.launchBrowser(runOptions, (logMsg) => {
      sendLog(logMsg);
    });

    updateState("waiting-login");
    sendLog("Trình duyệt đã mở. Vui lòng đăng nhập và chuẩn bị danh sách KOC.");
  } catch (error) {
    updateState("idle");
    sendLog(`Lỗi khi mở trình duyệt: ${error.message}`);
  }
});

// IPC Handler: Start Scraping
ipcMain.on("start-scraping", async (event, options) => {
  try {
    if (appState !== "waiting-login" && appState !== "idle") {
      sendLog("Không thể bắt đầu cào: Trình duyệt chưa sẵn sàng.");
      return;
    }

    updateState("scraping");
    sendLog("Bắt đầu tiến trình cào dữ liệu...");

    const runOptions = {
      brand: options.brand || "",
      maxCreators: Number(options.maxCreators || 0),
      hubApiUrl: options.hubApiUrl || "https://hub.bomax.vn/bomax/api/koc",
      csvPath: defaultCsvPath,
      jsonlPath: defaultJsonlPath,
      profileDir: options.profileDir || defaultProfileDir,
    };

    sendLog(`API Hub URL: ${runOptions.hubApiUrl}`);
    sendLog(`Brand phân loại: ${runOptions.brand || "(trống)"}`);

    await scraper.startScrape(
      runOptions,
      (logMsg) => {
        sendLog(logMsg);
      },
      (stats) => {
        if (mainWindow) {
          mainWindow.webContents.send("stats", stats);
        }
      },
      (summary) => {
        updateState("idle");
        sendLog(`Tiến trình hoàn tất! Thành công: ${summary.sent}, Bỏ qua: ${summary.skipped}`);
        sendLog(`Kết quả lưu tại: ${defaultCsvPath}`);
      }
    );
  } catch (error) {
    updateState("waiting-login");
    sendLog(`Lỗi tiến trình cào: ${error.message}`);
  }
});

// IPC Handler: Stop Scraping
ipcMain.on("stop-scraping", async () => {
  try {
    sendLog("Đang dừng tiến trình...");
    await scraper.stopScrape();
    updateState("idle");
    sendLog("Đã đóng trình duyệt và dừng tiến trình.");
  } catch (error) {
    sendLog(`Lỗi khi dừng: ${error.message}`);
  }
});

// IPC Handler: Open Output Folder
ipcMain.on("open-output-folder", () => {
  shell.openPath(appDir).catch((err) => {
    sendLog(`Lỗi mở thư mục: ${err.message}`);
  });
});
