import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const root = path.dirname(new URL(import.meta.url).pathname);
const profileDir = path.join(root, ".reddit-profile");
const outputDir = path.join(root, "output");
const historyPath = path.join(root, "history.json");

function isEnglish(text) {
  const letters = text.match(/\p{L}/gu) ?? [];
  const ascii = text.match(/[A-Za-z]/g) ?? [];
  return letters.length >= 4 && ascii.length / letters.length >= 0.9;
}

function canonicalUrl(value) {
  try {
    const url = new URL(value, "https://www.reddit.com");
    const match = url.pathname.match(/^\/r\/[^/]+\/comments\/[^/]+(?:\/[^/]+)?/i);
    return match ? `https://www.reddit.com${match[0].replace(/\/$/, "")}/` : null;
  } catch {
    return null;
  }
}

function keywordScore(title, config) {
  const value = title.toLowerCase();
  if (config.excludeKeywords.some((word) => value.includes(word.toLowerCase()))) return -1;
  return config.includeKeywords.reduce(
    (score, word) => score + Number(value.includes(word.toLowerCase())),
    0,
  );
}

function hasContext(title, config) {
  const value = title.toLowerCase();
  return config.contextKeywords.some((word) => value.includes(word.toLowerCase()));
}

function parseCount(value) {
  const match = String(value).replaceAll(",", "").match(/^(\d+(?:\.\d+)?)([KM])?$/i);
  if (!match) return 0;
  return Math.round(Number(match[1]) * ({ K: 1_000, M: 1_000_000 }[match[2]?.toUpperCase()] ?? 1));
}

function validateConfig(config) {
  for (const key of ["queries", "includeKeywords", "contextKeywords", "excludeKeywords"]) {
    if (!Array.isArray(config[key]) || config[key].some((item) => typeof item !== "string")) {
      throw new Error(`config.json: ${key} 必须是字符串数组`);
    }
  }
  for (const key of ["maxResultsPerQuery", "maxCandidates", "maxAgeDays", "minKeywordMatches"]) {
    if (!Number.isInteger(config[key]) || config[key] < 1) {
      throw new Error(`config.json: ${key} 必须是正整数`);
    }
  }
  if (!config.queries.length || !config.includeKeywords.length) {
    throw new Error("config.json: queries 和 includeKeywords 不能为空");
  }
  return config;
}

async function loadConfig() {
  return validateConfig(JSON.parse(await readFile(path.join(root, "config.json"), "utf8")));
}

async function loadHistory(filePath = historyPath) {
  let history;
  try {
    history = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { items: [] };
    throw error;
  }
  if (!Array.isArray(history.items)) throw new Error("history.json: items 必须是数组");
  return history;
}

async function launch() {
  try {
    return await chromium.launchPersistentContext(profileDir, {
      channel: "chrome",
      headless: false,
      locale: "en-US",
      viewport: { width: 1440, height: 900 },
    });
  } catch (error) {
    throw new Error(`浏览器启动失败。请先关闭本工具打开的 Chrome 窗口，再重试。\n${error.message}`);
  }
}

async function login() {
  const context = await launch();
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("https://www.reddit.com/login/", { waitUntil: "domcontentloaded" });
  const rl = readline.createInterface({ input: stdin, output: stdout });
  await rl.question("请在浏览器中手动登录 Reddit，完成后回到这里按回车：");
  rl.close();
  await context.close();
  console.log("登录状态已保存在本机 .reddit-profile 目录。");
}

async function extractPosts(page) {
  const searchPosts = await page.locator('div[data-testid="search-post-unit"]').evaluateAll((nodes) =>
    nodes.map((node) => ({
      title: node.querySelector('a[data-testid="post-title"]')?.textContent?.trim() || "",
      url: node.querySelector('a[data-testid="post-title"]')?.getAttribute("href") || "",
      created: node.querySelector("time")?.getAttribute("datetime") || "",
      tracking:
        node
          .querySelector("search-telemetry-tracker[data-faceplate-tracking-context]")
          ?.getAttribute("data-faceplate-tracking-context") || "",
      stats: node.innerText || "",
    })),
  );
  if (searchPosts.length) {
    return searchPosts.map((post) => {
      let tracking = {};
      try {
        tracking = JSON.parse(post.tracking);
      } catch {}
      const stats = post.stats.match(/([\d,.]+[KM]?)\s+votes?·([\d,.]+[KM]?)\s+comments?/i);
      return {
        title: post.title,
        url: post.url,
        subreddit: tracking.subreddit?.name ? `r/${tracking.subreddit.name}` : "",
        author: tracking.profile?.name || "",
        created: post.created,
        score: parseCount(stats?.[1]),
        comments: parseCount(stats?.[2]),
      };
    });
  }

  const posts = await page.locator("shreddit-post").evaluateAll((nodes) =>
    nodes.map((node) => ({
      title:
        node.getAttribute("post-title")?.trim() ||
        node.querySelector('a[href*="/comments/"]')?.textContent?.trim() ||
        "",
      url:
        node.getAttribute("permalink") ||
        node.querySelector('a[href*="/comments/"]')?.getAttribute("href") ||
        "",
      subreddit: node.getAttribute("subreddit-prefixed-name") || "",
      author: node.getAttribute("author") || "",
      created: node.getAttribute("created-timestamp") || "",
      score: Number(node.getAttribute("score") || 0),
      comments: Number(node.getAttribute("comment-count") || 0),
    })),
  );
  if (posts.length) return posts;
  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (/blocked by network security/i.test(bodyText)) {
    throw new Error("Reddit 拦截了当前浏览器会话，请在可见窗口中确认登录状态");
  }
  const mainText = await page.locator("main").innerText().catch(() => "");
  if (/couldn.t find any results|no results|找不到.*结果/i.test(mainText)) return [];
  throw new Error("未识别到Reddit搜索结果结构，可能是页面改版或访问受限");
}

async function loadSearch(page, query, config) {
  const url = new URL("https://www.reddit.com/search/");
  url.search = new URLSearchParams({
    q: query,
    sort: config.sort,
    t: config.time,
    type: "posts",
  });

  try {
    await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 45_000 });
  } catch (error) {
    if (!page.url().startsWith("https://www.reddit.com/search/")) throw error;
  }

  const searchUnits = page.locator('div[data-testid="search-post-unit"]');
  const shredditPosts = page.locator("shreddit-post");
  await Promise.race([
    searchUnits.first().waitFor({ state: "attached", timeout: 15_000 }).catch(() => {}),
    shredditPosts.first().waitFor({ state: "attached", timeout: 15_000 }).catch(() => {}),
  ]);
  for (let i = 0; i < 4; i += 1) {
    if (Math.max(await searchUnits.count(), await shredditPosts.count()) >= config.maxResultsPerQuery) break;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1_200);
  }
  return extractPosts(page);
}

async function withTimeout(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderHtml(items, generatedAt) {
  const rows = items
    .map(
      (item, index) => `<article>
  <h2>${index + 1}. <a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a></h2>
  <p>${escapeHtml(item.subreddit || "Reddit")} · ${escapeHtml(item.created ? new Date(item.created).toLocaleString("zh-CN") : "时间未知")} · 相关词 ${item.relevance} · ${item.score} 赞 · ${item.comments} 评论</p>
</article>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Reddit 行业候选帖</title>
<style>body{font:16px system-ui;max-width:900px;margin:40px auto;padding:0 20px;color:#202124}article{padding:16px 0;border-bottom:1px solid #ddd}h2{font-size:18px;margin:0 0 8px}a{color:#0b57d0}p{color:#666;margin:0}</style>
<h1>Reddit 行业候选帖</h1><p>生成时间：${escapeHtml(generatedAt)}；只提供链接，不会自动点赞或评论。</p>${rows || "<p>没有找到符合条件的英文帖子。</p>"}</html>`;
}

async function scan() {
  const config = await loadConfig();
  const history = await loadHistory();
  const handled = new Set(history.items.map((item) => canonicalUrl(item.url)).filter(Boolean));
  await mkdir(outputDir, { recursive: true });
  const context = await launch();
  const page = context.pages()[0] ?? (await context.newPage());
  const found = new Map();
  const errors = [];

  try {
    for (const query of config.queries) {
      console.log(`搜索：${query}`);
      try {
        const raw = await withTimeout(
          loadSearch(page, query, config),
          65_000,
          "该搜索超过 65 秒，已跳过",
        );
        for (const item of raw.slice(0, config.maxResultsPerQuery)) {
          const url = canonicalUrl(item.url);
          const relevance = keywordScore(item.title, config);
          const createdAt = Date.parse(item.created);
          const age = Date.now() - createdAt;
          if (!url || handled.has(url) || !isEnglish(item.title) || !hasContext(item.title, config) || relevance < config.minKeywordMatches) continue;
          if (!Number.isFinite(createdAt) || age < 0 || age > config.maxAgeDays * 86_400_000) continue;
          const previous = found.get(url);
          const subreddit = item.subreddit || `r/${url.split("/")[4]}`;
          if (!previous || relevance > previous.relevance) found.set(url, { ...item, subreddit, url, relevance });
        }
      } catch (error) {
        const screenshot = path.join(outputDir, `error-${Date.now()}.png`);
        await page.screenshot({ path: screenshot, fullPage: false }).catch(() => {});
        errors.push({ query, message: error.message, screenshot });
        console.warn(`跳过：${query}（${error.message}）`);
      }
    }
  } finally {
    await context.close();
  }

  const candidates = [...found.values()]
    .sort((a, b) => b.relevance - a.relevance || Date.parse(b.created || 0) - Date.parse(a.created || 0))
    .slice(0, config.maxCandidates);
  const generatedAt = new Date().toISOString();
  const jsonPath = path.join(outputDir, "candidates.json");
  const htmlPath = path.join(outputDir, "candidates.html");
  await writeFile(jsonPath, JSON.stringify({ generatedAt, errors, candidates }, null, 2));
  await writeFile(htmlPath, renderHtml(candidates, generatedAt));
  console.log(`完成：${candidates.length} 条候选帖，${errors.length} 个搜索失败\n打开：${htmlPath}`);
  if (!candidates.length && errors.length === config.queries.length) process.exitCode = 1;
}

async function shortlist() {
  const result = JSON.parse(await readFile(path.join(outputDir, "candidates.json"), "utf8"));
  if (!Array.isArray(result.candidates)) throw new Error("请先运行 npm run scan");
  for (const [index, item] of result.candidates.slice(0, 5).entries()) {
    console.log(`${index + 1}. [${item.subreddit}] ${item.title}\n   ${item.url}`);
  }
}

function addHistoryAction(history, candidate, action, note, at = new Date().toISOString()) {
  const url = canonicalUrl(candidate.url);
  if (!url) throw new Error("候选帖子URL无效");
  let item = history.items.find((entry) => canonicalUrl(entry.url) === url);
  if (!item) {
    item = { url, title: candidate.title, actions: [] };
    history.items.push(item);
  }
  if (!Array.isArray(item.actions)) throw new Error("history.json: actions 必须是数组");
  if (item.actions.some((entry) => entry.type === action)) return false;
  item.actions.push({ type: action, at, note });
  return true;
}

async function mark() {
  const [selection, action, ...noteParts] = process.argv.slice(3);
  if (!selection || !["upvote", "comment", "skip"].includes(action)) {
    throw new Error("用法：npm run mark -- 候选编号 upvote|comment|skip [备注]");
  }
  const result = JSON.parse(await readFile(path.join(outputDir, "candidates.json"), "utf8"));
  const index = Number(selection) - 1;
  const candidate = Number.isInteger(index) ? result.candidates?.[index] : null;
  if (!candidate) throw new Error("候选编号不存在，请先运行 npm run shortlist 核对编号");

  const history = await loadHistory();
  const added = addHistoryAction(history, candidate, action, noteParts.join(" "));
  if (!added) {
    console.log(`已有记录，未重复写入：${action} · ${candidate.title}`);
    return;
  }
  await writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`);
  console.log(`已记录：${action} · ${candidate.title}`);
}

async function selfTest() {
  const config = {
    includeKeywords: ["robot", "zinc"],
    contextKeywords: ["farm", "zinc"],
    excludeKeywords: ["game"],
  };
  console.assert(isEnglish("Autonomous farm robot navigation"));
  console.assert(!isEnglish("农业机器人导航"));
  console.assert(keywordScore("Autonomous robot", config) === 1);
  console.assert(keywordScore("Robot game", config) === -1);
  console.assert(hasContext("Farm robot", config));
  console.assert(!hasContext("Pet robot", config));
  console.assert(parseCount("1.2K") === 1200);
  console.assert(parseCount("38") === 38);
  console.assert(canonicalUrl("/r/ROS/comments/abc123/a_title/?x=1") === "https://www.reddit.com/r/ROS/comments/abc123/a_title/");
  const history = { items: [] };
  const candidate = { title: "Farm robot", url: "/r/ROS/comments/abc123/a_title/" };
  console.assert(addHistoryAction(history, candidate, "upvote", "", "2026-06-30T00:00:00Z"));
  console.assert(!addHistoryAction(history, candidate, "upvote", "", "2026-06-30T00:00:01Z"));
  console.assert(history.items[0].actions.length === 1);
  const automotive = {
    includeKeywords: ["used car", "car", "import"],
    contextKeywords: ["used car", "importing a car"],
    excludeKeywords: [],
  };
  console.assert(keywordScore("Importing a used car from Japan", automotive) === 3);
  console.assert(hasContext("Importing a used car from Japan", automotive));
  console.assert((await loadHistory(path.join(root, "__missing-history-test.json"))).items.length === 0);
  console.log("自检通过");
}

const command = process.argv[2];
if (command === "login") await login();
else if (command === "scan") await scan();
else if (command === "shortlist") await shortlist();
else if (command === "mark") await mark();
else if (command === "self-test") await selfTest();
else {
  console.error("用法：npm run login | npm run scan | npm run shortlist | npm run mark -- 编号 动作 | npm run codegen | npm test");
  process.exitCode = 1;
}
