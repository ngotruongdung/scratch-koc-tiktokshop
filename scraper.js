const { chromium } = require("playwright-core");
const fs = require("node:fs");
const path = require("node:path");

const ROW_SELECTOR = "tr.wrapper-row__StyledTr-yjKsO.cThaIh.cursor-pointer";
const USERNAME_SELECTOR = '[data-e2e="fbc99397-6043-1b37"]';
const DISPLAY_NAME_SELECTOR = '[data-e2e="3b9caa65-c65a-e9df"]';
const ZALO_SELECTOR = "svg.alliance-icon.alliance-icon-Zalo_Circle";

let browserContext = null;
let detailPage = null;
let isScrapingActive = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getValueForLabel(text, labels) {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLower = line.toLowerCase();
    
    const matchedLabel = labels.find(label => lineLower.includes(label.toLowerCase()));
    if (matchedLabel) {
      const labelIndex = lineLower.indexOf(matchedLabel.toLowerCase());
      const remainingText = line.slice(0, labelIndex) + " " + line.slice(labelIndex + matchedLabel.length);
      const cleanedRemaining = remainingText.trim();
      if (/[0-9]/.test(cleanedRemaining) && !cleanedRemaining.includes('%') && !cleanedRemaining.toLowerCase().includes('lượt') && !cleanedRemaining.toLowerCase().includes('views')) {
        const val = cleanedRemaining.replace(/^[:\-–\s]+/, '').trim();
        if (val) return val;
      }
      
      for (const offset of [1, 2]) {
        if (i + offset < lines.length) {
          const val = lines[i + offset];
          if (/[0-9]/.test(val) && !val.includes('%') && !val.toLowerCase().includes('lượt') && !val.toLowerCase().includes('views')) {
            return val;
          }
        }
      }
      
      for (const offset of [-1, -2]) {
        if (i + offset >= 0) {
          const val = lines[i + offset];
          if (/[0-9]/.test(val) && !val.includes('%') && !val.toLowerCase().includes('lượt') && !val.toLowerCase().includes('views')) {
            return val;
          }
        }
      }
    }
  }
  return null;
}

function parseSingleFormattedNumber(valStr) {
  if (!valStr) return 0;
  
  let clean = valStr.trim().toLowerCase();
  
  let multiplier = 1;
  if (clean.endsWith('k') || clean.includes('k ')) {
    multiplier = 1000;
  } else if (clean.endsWith('m') || clean.includes('m ') || clean.endsWith('tr') || clean.includes('tr ')) {
    multiplier = 1000000;
  } else if (clean.endsWith('b') || clean.includes('b ') || clean.endsWith('t') || clean.includes('t ')) {
    multiplier = 1000000000;
  }
  
  let numStr = clean.replace(/[^0-9.,]/g, '');
  
  if (multiplier > 1) {
    numStr = numStr.replace(',', '.');
    return parseFloat(numStr) * multiplier;
  } else {
    if (/^[0-9]+[.,][0-9]{3}$/.test(numStr)) {
      numStr = numStr.replace(/[.,]/g, '');
    } else {
      numStr = numStr.replace(',', '.');
    }
    return parseFloat(numStr);
  }
}

function parseFormattedNumber(valStr) {
  if (!valStr) return 0;
  
  let clean = valStr.trim();
  const rangeParts = clean.split(/[-–—]/);
  if (rangeParts.length === 2) {
    const minVal = parseSingleFormattedNumber(rangeParts[0]);
    const maxVal = parseSingleFormattedNumber(rangeParts[1]);
    if (minVal > 0 && maxVal > 0) {
      return (minVal + maxVal) / 2;
    } else if (minVal > 0) {
      return minVal;
    } else if (maxVal > 0) {
      return maxVal;
    }
  }
  
  return parseSingleFormattedNumber(clean);
}

function formatVnCurrency(num) {
  if (isNaN(num) || num === null || num === undefined) return "";
  const formatter = new Intl.NumberFormat('vi-VN');
  return formatter.format(Math.round(num)) + " ₫";
}


function isVietnamPhone(value) {
  return (
    value.length === 10 &&
    value[0] === "0" &&
    "235789".includes(value[1])
  );
}

function extractPhones(text) {
  const source = normalizeText(text);
  const matches = source.match(/[+0-9][0-9 .-]{7,20}[0-9]/g) || [];
  const unique = new Map();

  for (const match of matches) {
    const raw = match.trim();
    let digits = raw.replace(/\D/g, "");

    if (digits.startsWith("84") && digits.length === 11) {
      digits = "0" + digits.slice(2);
    }
    if (digits.length === 9 && "235789".includes(digits[0])) {
      digits = "0" + digits;
    }
    if (!isVietnamPhone(digits)) {
      continue;
    }
    if (!unique.has(digits)) {
      unique.set(digits, {
        raw,
        normalized: digits,
      });
    }
  }
  return Array.from(unique.values());
}

function extractEmails(text) {
  const matches = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return Array.from(new Set(matches.map((email) => email.toLowerCase())));
}

function createDetailUrl(creatorId, listUrl) {
  const currentUrl = new URL(listUrl);
  const shopId = currentUrl.searchParams.get("shop_id");
  const shopRegion = currentUrl.searchParams.get("shop_region") || "VN";

  const detailUrl = new URL("https://affiliate.tiktok.com/connection/creator/detail");
  detailUrl.searchParams.set("cid", creatorId);
  detailUrl.searchParams.set("pair_source", "author_search");
  detailUrl.searchParams.set("enter_from", "affiliate_find_creators");
  detailUrl.searchParams.set("shop_region", shopRegion);

  if (shopId) {
    detailUrl.searchParams.set("shop_id", shopId);
  }
  return detailUrl.toString();
}

function parseCreatorInfoCellText(text, username, name) {
  let rest = normalizeText(text);

  if (username && rest.startsWith(username)) {
    rest = normalizeText(rest.slice(username.length));
  }
  if (name && rest.startsWith(name)) {
    rest = normalizeText(rest.slice(name.length));
  }

  const followerMatch = rest.match(/(\d+(?:[.,]\d+)?\s*[KMB]?)(?=,\s*)/i);
  const followers = followerMatch ? normalizeText(followerMatch[1]) : "";
  let category = rest;

  if (followerMatch) {
    category = normalizeText(rest.slice(0, followerMatch.index));
  }

  category = category.replace(/\s*,\s*$/, "").trim();

  return {
    followers,
    category,
  };
}

async function readCreatorsFromCurrentPage(page) {
  const rows = page.locator(ROW_SELECTOR);
  await rows.first().waitFor({
    state: "visible",
    timeout: 15000,
  });

  const creators = await rows.evaluateAll(
    (elements, selectors) => {
      const normalize = (value) =>
        String(value || "")
          .replace(/\u00A0/g, " ")
          .replace(/\s+/g, " ")
          .trim();

      return elements.map((row, index) => {
        const cells = Array.from(row.querySelectorAll(":scope > td"));
        const checkbox = row.querySelector('input[type="checkbox"]');
        const usernameElement = row.querySelector(selectors.username);
        const nameElement = row.querySelector(selectors.name);
        const avatarElement = row.querySelector("img");

        const getCellText = (cellIndex) => {
          const cell = cells[cellIndex];
          return normalize(cell ? cell.innerText : "");
        };

        return {
          index: index + 1,
          creatorId: checkbox ? String(checkbox.value || "").trim() : "",
          username: normalize(usernameElement ? usernameElement.innerText : ""),
          name: normalize(nameElement ? nameElement.innerText : ""),
          avatarUrl: avatarElement ? String(avatarElement.src || "") : "",
          infoCellText: getCellText(1),
          gmv: getCellText(3),
          itemsSold: getCellText(4),
          averageViews: getCellText(5),
          engagementRate: getCellText(6),
          rowText: normalize(row.innerText),
        };
      });
    },
    {
      username: USERNAME_SELECTOR,
      name: DISPLAY_NAME_SELECTOR,
    }
  );

  return creators
    .filter((creator) => creator.creatorId && creator.username)
    .map((creator) => {
      const parsed = parseCreatorInfoCellText(creator.infoCellText, creator.username, creator.name);
      return {
        ...creator,
        followers: parsed.followers,
        category: parsed.category,
      };
    });
}

async function closeOldPopups(page) {
  await page.keyboard.press("Escape").catch(() => null);
  await page
    .locator("body")
    .click({
      position: { x: 5, y: 5 },
      force: true,
    })
    .catch(() => null);
  await page.waitForTimeout(400);
}

async function clickZaloIcon(page) {
  const icons = page.locator(ZALO_SELECTOR);
  const count = await icons.count();

  if (count === 0) {
    throw new Error("Zalo icon not found");
  }

  let icon = null;
  for (let index = 0; index < count; index++) {
    const candidate = icons.nth(index);
    const visible = await candidate.isVisible().catch(() => false);
    if (visible) {
      icon = candidate;
      break;
    }
  }

  if (!icon) {
    throw new Error("Zalo icon exists but is not visible");
  }

  await icon.scrollIntoViewIfNeeded();

  const clickableAncestor = icon.locator(
    'xpath=ancestor::*[self::button or @role="button" or @tabindex][1]'
  );

  if ((await clickableAncestor.count()) > 0) {
    try {
      await clickableAncestor.first().click({
        force: true,
        timeout: 5000,
      });
      return;
    } catch (_) {}
  }

  try {
    await icon.click({
      force: true,
      timeout: 5000,
    });
    return;
  } catch (_) {}

  const box = await icon.boundingBox();
  if (!box) {
    throw new Error("Cannot get Zalo icon position");
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function captureVisibleContactCandidates(page) {
  return page.evaluate(() => {
    const normalize = (value) =>
      String(value || "")
        .replace(/\u00A0/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const selectors = [
      '[role="dialog"]',
      '[role="tooltip"]',
      '[role="menu"]',
      '[class*="popover"]',
      '[class*="popup"]',
      '[class*="tooltip"]',
      '[class*="dropdown"]',
      ".core-popover",
      ".arco-popover",
      ".pulse-popover",
    ];

    const elements = new Set();
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((element) => {
        elements.add(element);
      });
    }

    document.querySelectorAll("div, span, p").forEach((element) => {
      elements.add(element);
    });

    const results = [];
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue;
      if (element.closest("script, style, svg, defs, clipPath, noscript")) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);

      const visible =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.width < 900 &&
        rect.height < 600 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || 1) > 0;

      if (!visible) continue;

      const text = normalize(element.innerText);
      if (!text || text.length < 5 || text.length > 400) {
        continue;
      }

      results.push({
        text,
        html: element.outerHTML.slice(0, 10000),
        area: Math.round(rect.width * rect.height),
      });
    }
    return results;
  });
}

async function waitForContactPopup(page, beforeCandidates) {
  const beforeSet = new Set(beforeCandidates.map((item) => item.text));
  const startedAt = Date.now();
  const timeout = 5000;

  while (Date.now() - startedAt < timeout) {
    const candidates = await captureVisibleContactCandidates(page);
    const ranked = candidates
      .filter((item) => !beforeSet.has(item.text))
      .map((item) => {
        let score = 0;
        if (/zalo/i.test(item.text)) score += 100;
        if (/lien he|thong tin|contact/i.test(item.text)) score += 50;

        const phones = String(item.text).replace(/\D/g, "");
        if (phones.length >= 9 && phones.length <= 11) score += 120;

        score -= item.text.length / 10;
        score -= item.area / 100000;

        return {
          ...item,
          score,
        };
      })
      .sort((a, b) => b.score - a.score);

    for (const candidate of ranked) {
      const phones = extractPhones(candidate.text);
      const isTruncated = candidate.text.includes("...") || candidate.text.includes("…");
      if (phones.length > 0 || isTruncated) {
        return candidate;
      }
    }

    await page.waitForTimeout(250);
  }
  return null;
}

async function revealTruncatedPhoneByHover(page) {
  return page.evaluate(async () => {
    const selectors = [
      '[role="dialog"]',
      '[role="tooltip"]',
      '[role="menu"]',
      '[class*="popover"]',
      '[class*="popup"]',
      '[class*="tooltip"]',
      '[class*="dropdown"]',
      '.core-popover',
      '.arco-popover',
      '.pulse-popover'
    ];

    // Find the element containing "..." and numbers inside any active popup
    let foundTarget = null;
    for (const sel of selectors) {
      const popups = document.querySelectorAll(sel);
      for (const popup of popups) {
        const all = popup.querySelectorAll('*');
        for (const el of all) {
          const text = (el.innerText || el.textContent || "").trim();
          if (text.includes('...') && /[0-9]/.test(text) && el.children.length === 0) {
            foundTarget = el;
            break;
          }
        }
        if (foundTarget) break;
      }
      if (foundTarget) break;
    }

    if (!foundTarget) {
      return null;
    }

    // Trigger hover events
    const hoverEvents = ['mouseenter', 'mouseover', 'pointerover'];
    hoverEvents.forEach(evtName => {
      foundTarget.dispatchEvent(new MouseEvent(evtName, { bubbles: true, cancelable: true }));
      if (foundTarget.parentElement) {
        foundTarget.parentElement.dispatchEvent(new MouseEvent(evtName, { bubbles: true, cancelable: true }));
      }
    });

    // Wait for tooltip to appear in the DOM
    await new Promise(resolve => setTimeout(resolve, 600));

    // Capture text from all visible tooltips
    let tooltipText = "";
    for (const sel of selectors) {
      const popups = document.querySelectorAll(sel);
      for (const popup of popups) {
        const text = (popup.innerText || "").trim();
        // Look for tooltips containing numbers that don't have ellipses
        if (/[0-9]{9,11}/.test(text) && !text.includes('...')) {
          tooltipText = text;
          break;
        }
      }
      if (tooltipText) break;
    }

    return tooltipText ? { text: tooltipText } : null;
  });
}

function buildHubPayload(result, brand) {
  const phone = result.phones[0] ? result.phones[0].normalized : "";
  const email = result.emails[0] || "";

  return {
    username: result.username || "",
    ten: result.name || "",
    gmv: result.gmv || "",
    so_mon_ban_ra: result.itemsSold || "",
    danh_muc: result.category || "",
    nguoi_theo_doi: result.followers || "",
    zalo: phone,
    email: email,
    brand: brand,
    trang_thai_lien_he: "Chua lien he",
  };
}

function normalizeHubApiUrl(hubApiUrl) {
  const value = String(hubApiUrl || "").trim();
  if (!value) {
    return "https://hub.bomax.vn/bomax/api/koc";
  }
  if (value.startsWith("/")) {
    return "https://hub.bomax.vn" + value;
  }
  return value;
}

async function postToHub(payload, hubApiUrl) {
  const targetUrl = normalizeHubApiUrl(hubApiUrl);
  const response = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error("Hub API error " + response.status + " at " + targetUrl + ": " + text);
  }
  return text;
}

function csvEscape(value) {
  const text = Array.isArray(value)
    ? value.map(v => typeof v === 'object' ? v.normalized : v).join(" | ")
    : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function initializeCsv(csvPath) {
  if (fs.existsSync(csvPath)) {
    return;
  }
  const headers = [
    "creator_id",
    "username",
    "name",
    "phone",
    "email",
    "gmv",
    "items_sold",
    "followers",
    "category",
    "average_views",
    "engagement_rate",
    "status",
    "detail_url",
    "captured_at"
  ];
  fs.writeFileSync(
    csvPath,
    `\uFEFF${headers.map(csvEscape).join(",")}\n`,
    "utf8"
  );
}

function appendResult(result, csvPath, jsonlPath) {
  fs.appendFileSync(
    jsonlPath,
    `${JSON.stringify(result)}\n`,
    "utf8"
  );

  const csvRow = [
    result.creatorId,
    result.username,
    result.name,
    result.phones,
    result.emails,
    result.gmv,
    result.itemsSold,
    result.followers,
    result.category,
    result.averageViews,
    result.engagementRate,
    result.status,
    result.detailUrl,
    result.capturedAt,
  ];

  fs.appendFileSync(
    csvPath,
    `${csvRow.map(csvEscape).join(",")}\n`,
    "utf8"
  );
}

function loadProcessedCreatorIds(jsonlPath) {
  const ids = new Set();
  if (!fs.existsSync(jsonlPath)) {
    return ids;
  }

  const lines = fs
    .readFileSync(jsonlPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean);

  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      if (item.creatorId) {
        ids.add(String(item.creatorId));
      }
    } catch {
      // Ignore
    }
  }
  return ids;
}

async function launchBrowser(options, onLog) {
  const { profileDir, channel } = options;

  onLog("Khởi động trình duyệt...");
  onLog(`Profile folder: ${profileDir}`);
  if (channel) {
    onLog(`Browser channel: ${channel}`);
  }

  browserContext = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: null,
    channel: channel || undefined,
    args: ["--start-maximized", "--disable-notifications"],
  });

  browserContext.setDefaultTimeout(15000);

  // Block fonts/media to save bandwidth
  await browserContext.route("**/*", async (route) => {
    const type = route.request().resourceType();
    if (["font", "media"].includes(type)) {
      await route.abort();
      return;
    }
    await route.continue();
  });

  const page = browserContext.pages()[0] || (await browserContext.newPage());
  onLog("Đang mở trang danh sách TikTok Affiliate Creator...");
  await page.goto("https://affiliate.tiktok.com/connection/creator", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  onLog("Vui lòng đăng nhập TikTok Shop trên trình duyệt (nếu cần), sau đó lọc danh sách KOC.");
  return page;
}

async function startScrape(options, onLog, onStatsUpdate, onFinished) {
  if (!browserContext) {
    throw new Error("Trình duyệt chưa khởi động. Hãy nhấn 'Mở trình duyệt' trước.");
  }
  isScrapingActive = true;

  const { brand, maxCreators, hubApiUrl, csvPath, jsonlPath } = options;

  initializeCsv(csvPath);
  const processedIds = loadProcessedCreatorIds(jsonlPath);
  onLog(`Đã tải dữ liệu lịch sử. Đã có ${processedIds.size} Creator ID được cào.`);

  // Find creator list tab
  const listPage = browserContext.pages().find((currentPage) => {
    const url = currentPage.url();
    return (
      url.includes("/connection/creator") &&
      !url.includes("/connection/creator/detail")
    );
  });

  if (!listPage) {
    throw new Error("Không tìm thấy trang danh sách Creator. Hãy chắc chắn bạn đang mở trang danh sách.");
  }

  const listUrl = listPage.url();
  onLog("Đọc danh sách KOC từ trình duyệt...");
  let creators = await readCreatorsFromCurrentPage(listPage);
  
  // Filter out already processed
  const originalCount = creators.length;
  creators = creators.filter(c => !processedIds.has(c.creatorId));
  onLog(`Tìm thấy ${originalCount} KOC trên trang, lọc ra ${creators.length} KOC chưa xử lý.`);

  if (maxCreators > 0) {
    creators = creators.slice(0, maxCreators);
    onLog(`Giới hạn số lượng cào: Lấy ${creators.length} KOC.`);
  }

  if (creators.length === 0) {
    onLog("Không có KOC mới nào cần xử lý.");
    isScrapingActive = false;
    onFinished({ sent: 0, skipped: 0 });
    return;
  }

  detailPage = await browserContext.newPage();
  detailPage.setDefaultTimeout(15000);

  let sentCount = 0;
  let skippedCount = 0;

  for (let index = 0; index < creators.length; index++) {
    if (!isScrapingActive) {
      onLog("Dừng tiến trình theo yêu cầu của người dùng.");
      break;
    }

    const creator = creators[index];
    onLog(`[${index + 1}/${creators.length}] Đang xử lý: ${creator.username} (${creator.name || 'N/A'})`);

    const result = {
      creatorId: creator.creatorId,
      username: creator.username,
      name: creator.name,
      avatarUrl: creator.avatarUrl,
      gmv: creator.gmv,
      itemsSold: creator.itemsSold,
      followers: creator.followers,
      category: creator.category,
      averageViews: creator.averageViews,
      engagementRate: creator.engagementRate,
      phones: [],
      emails: [],
      contactText: "",
      detailUrl: createDetailUrl(creator.creatorId, listUrl),
      capturedAt: new Date().toISOString(),
      status: "pending",
      debug: {},
    };

    try {
      await detailPage.goto(result.detailUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      // Wait for either the Zalo icon or the contact section to load (up to 10 seconds)
      let hasZalo = true;
      try {
        const contactHeader = detailPage.locator('text="Thông tin liên hệ", text="Contact info", text="Contact information", text="Liên hệ", text="Zalo"');
        const zaloIcon = detailPage.locator(ZALO_SELECTOR).first();

        await Promise.race([
          zaloIcon.waitFor({ state: "visible", timeout: 10000 }),
          contactHeader.waitFor({ state: "visible", timeout: 10000 })
        ]);
      } catch (_) {
        // Timeout occurred
      }

      // Small buffer to ensure everything is rendered
      await sleep(400);

      hasZalo = await detailPage.locator(ZALO_SELECTOR).first().isVisible();

      if (!hasZalo) {
        onLog(`  ↳ Bỏ qua: Không có thông tin Zalo.`);
        result.status = "no_phone";
        appendResult(result, csvPath, jsonlPath);
        skippedCount++;
        onStatsUpdate({
          sent: sentCount,
          skipped: skippedCount,
          currentCreator: creator.username,
          progress: Math.round(((index + 1) / creators.length) * 100),
        });
        await sleep(400);
        continue;
      }

      // Extract and calculate GMV from detail page
      try {
        const statsEl = detailPage.locator('text="GMV từ mỗi khách hàng", text="GMV per customer", text="GMV per buyer", text="GMV/buyer"');
        await statsEl.waitFor({ state: "visible", timeout: 5000 }).catch(() => null);
      } catch (_) {}

      let calculatedGmv = "";
      try {
        const bodyText = await detailPage.innerText('body').catch(() => "");
        const itemsSoldValStr = getValueForLabel(bodyText, ["Số món bán ra", "Items sold", "Product sold", "Units sold", "Sales"]);
        const gmvPerCustomerValStr = getValueForLabel(bodyText, ["GMV từ mỗi khách hàng", "GMV per customer", "GMV per buyer", "GMV/buyer", "GMV per purchaser"]);

        if (itemsSoldValStr && gmvPerCustomerValStr) {
          const itemsSoldNum = parseFormattedNumber(itemsSoldValStr);
          const gmvPerCustomerNum = parseFormattedNumber(gmvPerCustomerValStr);
          if (itemsSoldNum > 0 && gmvPerCustomerNum > 0) {
            const calculatedGmvNum = itemsSoldNum * gmvPerCustomerNum;
            calculatedGmv = formatVnCurrency(calculatedGmvNum);
            onLog(`  ↳ Tính toán GMV: ${itemsSoldValStr} (${itemsSoldNum}) x ${gmvPerCustomerValStr} (${gmvPerCustomerNum}) = ${calculatedGmv}`);
          }
        }
        if (itemsSoldValStr) {
          result.itemsSold = itemsSoldValStr;
        }
      } catch (err) {
        onLog(`  ↳ Lỗi khi tính toán GMV: ${err.message}`);
      }

      if (calculatedGmv) {
        result.gmv = calculatedGmv;
      } else {
        onLog(`  ↳ Không tính được GMV mới, giữ nguyên GMV cũ: ${result.gmv}`);
      }

      await closeOldPopups(detailPage);
      const beforeCandidates = await captureVisibleContactCandidates(detailPage);
      let popupData = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await clickZaloIcon(detailPage);
          popupData = await waitForContactPopup(detailPage, beforeCandidates);
          if (popupData && popupData.text) {
            break;
          }
        } catch (error) {
          result.debug["attempt_" + attempt] = error.message;
          if (attempt < 3) {
            await closeOldPopups(detailPage);
            await sleep(700);
          }
        }
      }

      let popupText = popupData ? popupData.text : "";
      let phonesFromPopup = extractPhones(popupText);

      if (phonesFromPopup.length === 0 || popupText.includes("...")) {
        const hoverData = await revealTruncatedPhoneByHover(detailPage);
        if (hoverData && hoverData.text) {
          popupText = hoverData.text;
          popupData = hoverData;
          phonesFromPopup = extractPhones(popupText);
        }
      }

      result.contactText = popupText;
      result.phones = phonesFromPopup;
      result.emails = extractEmails(popupText);
      result.debug.popupFound = Boolean(popupData);
      result.debug.popupTextLength = popupText.length;
      result.debug.zaloIconCount = await detailPage.locator(ZALO_SELECTOR).count();

      if (result.phones.length === 0) {
        result.status = "no_phone";
        onLog(`  ↳ Bỏ qua: Không tìm thấy số điện thoại.`);
        appendResult(result, csvPath, jsonlPath);
        skippedCount++;
      } else {
        result.status = "success";
        const phoneStr = result.phones.map(p => p.normalized).join(", ");
        onLog(`  ↳ Thành công! SĐT: ${phoneStr}`);

        // Post to Hub
        const payload = buildHubPayload(result, brand);
        onLog(`  ↳ Gửi Hub URL: ${normalizeHubApiUrl(hubApiUrl)}`);
        await postToHub(payload, hubApiUrl);
        onLog(`  ↳ Gửi lên Hub thành công.`);
        appendResult(result, csvPath, jsonlPath);
        sentCount++;
      }
    } catch (error) {
      result.status = "error";
      result.error = error.message;
      onLog(`  ↳ Lỗi: ${error.message}`);
      appendResult(result, csvPath, jsonlPath);
      skippedCount++;
    }

    onStatsUpdate({
      sent: sentCount,
      skipped: skippedCount,
      currentCreator: creator.username,
      progress: Math.round(((index + 1) / creators.length) * 100),
    });

    await sleep(800);
  }

  if (detailPage) {
    await detailPage.close().catch(() => null);
    detailPage = null;
  }
  isScrapingActive = false;
  onFinished({ sent: sentCount, skipped: skippedCount });
}

async function stopScrape() {
  isScrapingActive = false;
  if (detailPage) {
    await detailPage.close().catch(() => null);
    detailPage = null;
  }
  if (browserContext) {
    await browserContext.close().catch(() => null);
    browserContext = null;
  }
}

module.exports = {
  launchBrowser,
  startScrape,
  stopScrape,
};
