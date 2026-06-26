<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";
  import { checkConnectivity } from "$lib/scanner/connectivity";
  import type { ScanResult } from "$lib/scanner/types";
  import { AI_MODELS } from "$lib/scanner/ai-scanner";
  import { Store } from "@tauri-apps/plugin-store";

  let store: Store;

  async function initStore() {
    try {
      store = await Store.load("settings.json");
      const savedKeys = await store.get<ApiKeyEntry[]>("api-keys");
      const savedActiveKey = await store.get<string>("active-key");
      const savedModel = await store.get<string>("selected-model");
      const savedDarkMode = await store.get<boolean>("dark-mode");
      if (savedKeys) apiKeys = savedKeys;
      if (savedActiveKey) activeKeyId = savedActiveKey;
      if (savedModel) selectedModelId = savedModel;
      if (savedDarkMode !== undefined) {
        darkMode = savedDarkMode;
      } else {
        darkMode = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
      refreshApiKeys(selectedDirectory, ++keyGen);
    } catch (e) {
      console.error("initStore error:", e);
      error = `initStore failed: ${e}`;
    }
  }

  function mapResult(r: Record<string, unknown>): ScanResult {
    return {
      file: r.file as string,
      type: r.type as ScanResult["type"],
      severity: r.severity as ScanResult["severity"],
      message: r.message as string,
      line: r.line as number | undefined,
      column: r.column as number | undefined,
      codeSnippet: r.code_snippet as string | undefined,
      suggestion: r.suggestion as string | undefined
    };
  }

  let selectedDirectory = $state("");
  let scanResults: ScanResult[] = $state([]);
  let totalTokens = $state(0);
  let isScanning = $state(false);
  let error = $state("");
  let scanInfo = $state("");
  let darkMode = $state(false);
  let showHelp = $state(false);
  let isOnline = $state(false);
  let isAIScanning = $state(false);
  let aiMode = $state(false);
  let busy = $state(false);
  let currentScanId = $state("");

  function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  let expandedCategories = $state(new Set(["duplicate", "unused", "redundant", "architecture", "dependency"]));
  let modelAvailable = $state(false);
  let modelSizeMb = $state(0);
  let isDownloadingModel = $state(false);
  let scanStatus = $state("");
  let elapsedSeconds = $state(0);
  let timerHandle: ReturnType<typeof setInterval> | undefined;
  let selectedModelId = $state("local");
  interface ApiKeyEntry { id: string; name: string; key: string; predefined?: boolean }
  let apiKeys = $state<ApiKeyEntry[]>([]);
  let activeKeyId = $state("");
  let showAddKey = $state(false);
  let newKeyName = $state("");
  let newKeyValue = $state("");
  let credits = $state(60);
  let showLog = $state(false);
  let showDocs = $state(false);
  let showDemo = $state(false);
  let logEntries = $state<{ time: string; message: string; type: "info" | "error" | "warning" }[]>([]);

  function addLog(message: string, type: "info" | "error" | "warning" = "info") {
    const now = new Date();
    const time = now.toLocaleTimeString();
    logEntries = [{ time, message, type }, ...logEntries];
  }

  let elapsedDisplay = $derived.by(() => {
    const m = Math.floor(elapsedSeconds / 60);
    const s = elapsedSeconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  });

  let isScanActive = $derived(isScanning || isAIScanning);

  function startTimer() {
    elapsedSeconds = 0;
    timerHandle = setInterval(() => { elapsedSeconds++; }, 1000);
  }

  function stopTimer() {
    if (timerHandle) {
      clearInterval(timerHandle);
      timerHandle = undefined;
    }
  }

  async function checkModel() {
    const { getLocalModelStatus } = await import("$lib/scanner/ai-scanner");
    const status = await getLocalModelStatus();
    modelAvailable = status.exists;
    modelSizeMb = status.size_mb;
  }

  $effect(() => {
    checkModel();
  });

  $effect(() => {
    checkConnectivity().then(setIsOnline);
    const goOnline = () => checkConnectivity().then(setIsOnline);
    const goOffline = () => isOnline = false;
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  });

  $effect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => darkMode = e.matches;
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  });

  function setIsOnline(v: boolean) { isOnline = v; }

  function toggleCategory(type: string) {
    if (expandedCategories.has(type)) {
      expandedCategories.delete(type);
    } else {
      expandedCategories.add(type);
    }
    expandedCategories = new Set(expandedCategories);
  }

  const categories = [
    {
      type: "duplicate",
      label: "Duplicate Code",
      icon: "\u{1F500}",
      emptyMsg: "No duplicate code found"
    },
    {
      type: "unused",
      label: "Unused Code",
      icon: "\u{1F503}",
      emptyMsg: "All imports and declarations are in use"
    },
    {
      type: "redundant",
      label: "Redundant Code",
      icon: "\u{1F504}",
      emptyMsg: "No redundant patterns detected"
    },
    {
      type: "architecture",
      label: "Architecture",
      icon: "\u{1F3D7}",
      emptyMsg: "Component architecture looks sound"
    },
    {
      type: "dependency",
      label: "Dependencies",
      icon: "\u{1F4E6}",
      emptyMsg: "No deprecated or malicious packages found"
    }
  ];

  function itemsByType(type: string): ScanResult[] {
    return scanResults.filter(r => r.type === type);
  }

  async function pickFolder() {
    try {
      const folder = await open({ directory: true, multiple: false, title: "Select a project folder" });
      if (folder) selectedDirectory = folder;
    } catch (e) {
      error = `Folder picker failed: ${e}`;
    }
  }

  async function pickFile() {
    try {
      const file = await open({
        multiple: false,
        title: "Select a file to scan",
        filters: [{ name: "Source Code", extensions: ["js", "ts", "svelte", "rs", "css", "html", "jsx", "tsx"] }]
      });
      if (file) selectedDirectory = file;
    } catch (e) {
      error = `File picker failed: ${e}`;
    }
  }

  async function runScan() {
    if (busy) return;
    if (!selectedDirectory) {
      error = "Please select a file or folder first";
      return;
    }
    busy = true;
    isScanning = true;
    error = "";
    scanStatus = "Scanning files...";
    addLog("Starting rule-based scan...", "info");
    scanResults = [];
    totalTokens = 0;
    currentScanId = generateId();
    startTimer();
    try {
      const results = await invoke<string>("scan_code", {
        path: selectedDirectory,
        scanId: currentScanId,
      });
      scanResults = (JSON.parse(results) as Record<string, unknown>[]).map(mapResult);
      addLog(`Rule-based scan complete: ${scanResults.length} issue(s) found`, "info");
    } catch (e) {
      error = `Scan failed: ${e}`;
      addLog(`Scan error: ${e}`, "error");
    } finally {
      stopTimer();
      isScanning = false;
      busy = false;
      scanStatus = "";
      currentScanId = "";
    }
  }

  async function stopScan() {
    if (!currentScanId) return;
    try {
      await invoke("cancel_scan", { scanId: currentScanId });
    } catch { /* ignore */ }
    stopTimer();
    isScanning = false;
    isAIScanning = false;
    busy = false;
    scanStatus = "";
    currentScanId = "";
    elapsedSeconds = 0;
  }

  async function scanCurrentProject() {
    if (busy) return;
    selectedDirectory = ".";
    await runScan();
  }

  async function downloadModel() {
    if (busy) return;
    busy = true;
    isDownloadingModel = true;
    scanStatus = "Downloading model (~350 MB)...";
    addLog("Downloading local AI model...", "info");
    try {
      const { ensureLocalModel } = await import("$lib/scanner/ai-scanner");
      await ensureLocalModel();
      await checkModel();
      addLog("Local AI model downloaded successfully", "info");
    } catch (e) {
      error = `Model download failed: ${e}`;
      addLog(`Model download error: ${e}`, "error");
    } finally {
      isDownloadingModel = false;
      scanStatus = "";
      busy = false;
    }
  }

  let isLocalModel = $derived(selectedModelId === "local");

  function activeApiKey(): string | undefined {
    return apiKeys.find(k => k.id === activeKeyId)?.key;
  }

  async function addApiKey() {
    if (!newKeyName || !newKeyValue) return;
    const id = crypto.randomUUID();
    apiKeys = [...apiKeys, { id, name: newKeyName, key: newKeyValue }];
    activeKeyId = id;
    newKeyName = "";
    newKeyValue = "";
    showAddKey = false;
    await store.set("api-keys", apiKeys.filter(k => !k.predefined));
    await store.set("active-key", id);
    await store.save();
  }

  function removeActiveKey() {
    const key = apiKeys.find(k => k.id === activeKeyId);
    if (key?.predefined) return;
    apiKeys = apiKeys.filter(k => k.id !== activeKeyId);
    activeKeyId = apiKeys.length > 0 ? apiKeys[apiKeys.length - 1].id : "";
  }

  let keyGen = 0;

  async function refreshApiKeys(dir: string, gen: number) {
    try {
      if (!store) return;
      const stored = await store.get<ApiKeyEntry[]>("api-keys");
      const userKeys: ApiKeyEntry[] = stored ?? [];
      const active = (await store.get<string>("active-key")) || "";

      console.log(`[refreshApiKeys] gen=${gen} dir="${dir}" active="${active}" userKeys=${userKeys.length}`);

      const seen = new Set(userKeys.map(k => k.key));
      const collected = [...userKeys];

      const envRaw = await invoke<string>("get_env_api_keys");
      if (gen !== keyGen) return;
      const envKeys: ApiKeyEntry[] = JSON.parse(envRaw);
      console.log(`[refreshApiKeys] envKeys=${envKeys.length}`);
      for (const ek of envKeys) {
        if (!seen.has(ek.key)) {
          collected.push(ek);
          seen.add(ek.key);
        }
      }

      const dirsToCheck = [...new Set([dir, "."].filter(Boolean))];
      console.log(`[refreshApiKeys] dirsToCheck=${JSON.stringify(dirsToCheck)}`);
      for (const d of dirsToCheck) {
        const dirRaw = await invoke<string>("get_dir_api_keys", { directory: d });
        if (gen !== keyGen) return;
        const dirKeys: ApiKeyEntry[] = JSON.parse(dirRaw);
        console.log(`[refreshApiKeys] dir="${d}" keys=${dirKeys.length}`);
        for (const dk of dirKeys) {
          if (!seen.has(dk.key)) {
            collected.push(dk);
            seen.add(dk.key);
          }
        }
      }

      apiKeys = collected;
      console.log(`[refreshApiKeys] collected=${collected.length} keys`, collected.map(k => ({ id: k.id, name: k.name, pre: k.predefined })));
      const preferred = collected.find(k => k.key === active || k.id === active);
      if (preferred) {
        console.log(`[refreshApiKeys] preferred match: ${preferred.id}`);
        activeKeyId = preferred.id;
      } else if (collected.length >= 1) {
        console.log(`[refreshApiKeys] no preferred match, using first: ${collected[0].id}`);
        activeKeyId = collected[0].id;
      } else {
        console.log(`[refreshApiKeys] no keys at all`);
      }
    } catch (e) {
      console.error("refreshApiKeys error:", e);
      error = `refreshApiKeys error: ${e}`;
    }
  }

  $effect(() => {
    initStore();
  });

  $effect(() => {
    const gen = ++keyGen;
    refreshApiKeys(selectedDirectory, gen);
  });

  $effect(() => {
    if (!store) return;
    const userKeys = apiKeys.filter(k => !k.predefined);
    store.set("api-keys", userKeys).then(() => store.save());
  });

  $effect(() => {
    if (!store) return;
    if (activeKeyId) store.set("active-key", activeKeyId).then(() => store.save());
  });

  $effect(() => {
    if (!store) return;
    store.set("selected-model", selectedModelId).then(() => store.save());
  });

  $effect(() => {
    if (!store) return;
    store.set("dark-mode", darkMode).then(() => store.save());
  });

  async function runAIScan() {
    if (busy) return;
    if (!selectedDirectory) {
      error = "Please select a file or folder first";
      return;
    }
    if (isLocalModel && !modelAvailable) {
      error = "Please download the local model first.";
      return;
    }
    if (!isLocalModel && !activeApiKey()) {
      error = "Please add a Hugging Face API key for cloud AI.";
      return;
    }
    if (!isLocalModel) {
      if (credits <= 0) {
        error = "No credits remaining. Restart the app to reset your 60 session credits.";
        return;
      }
      credits--;
    }
    busy = true;
    isAIScanning = true;
    aiMode = true;
    error = "";
    const modelName = AI_MODELS.find(m => m.id === selectedModelId)?.name || selectedModelId;
    scanStatus = isLocalModel ? "Running local AI model..." : `Querying ${modelName}...`;
    addLog(`Starting AI scan: ${modelName}`, "info");
    totalTokens = 0;
    currentScanId = generateId();
    startTimer();
    try {
      const filesJson = await invoke<string>("read_files_for_ai", {
        path: selectedDirectory,
        scanId: currentScanId,
      });
      if (currentScanId) {
        const files = JSON.parse(filesJson);
        totalTokens = 0;
        if (isLocalModel) {
          const { scanWithLocalAI } = await import("$lib/scanner/ai-scanner");
          const results = await scanWithLocalAI(
            files,
            (msg) => {
              scanStatus = msg;
              const type = msg.includes("ERROR") || msg.includes("error") ? "error" : "info";
              if (type === "error") { error = msg; addLog(msg, type); }
              else if (msg.includes("no issues")) addLog(msg, type);
            },
            (count) => { totalTokens = count; }
          );
          scanResults = [...scanResults, ...results];
          addLog(`Local AI scan complete: ${results.length} issue(s) found`, results.length > 0 ? "warning" : "info");
        } else {
          const { scanWithAI } = await import("$lib/scanner/ai-scanner");
          const results = await scanWithAI(
            files,
            selectedModelId,
            activeApiKey(),
            (msg) => {
              scanStatus = msg;
              const type = msg.includes("ERROR") || msg.includes("error") ? "error" : msg.includes("no issues") ? "warning" : "info";
              if (type === "error") {
                const summary = msg.match(/^AI scan completed with \d+ error\(s\)/);
                error = summary ? summary[0] + ". Check the log drawer for details." : msg;
              }
              addLog(msg, type);
            },
            (count) => { totalTokens = count; }
          );
          scanResults = [...scanResults, ...results];
          addLog(`Cloud AI scan complete: ${results.length} issue(s) found`, results.length > 0 ? "warning" : "info");
        }
      }
    } catch (e) {
      error = `AI scan failed: ${e}`;
      addLog(`AI scan error: ${e}`, "error");
    } finally {
      stopTimer();
      isAIScanning = false;
      busy = false;
      currentScanId = "";
    }
  }

  let totalResults = $derived(scanResults.length);

  function severityClass(s: string): string {
    if (s === "error") return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
    if (s === "warning") return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
    return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
  }
</script>

<div class="{darkMode ? 'dark' : ''}">
  <div class="min-h-screen bg-white text-gray-900 transition-colors dark:bg-gray-950 dark:text-gray-100">
    <div class="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">

      <!-- Header -->
      <div class="mb-6 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white text-sm font-bold shadow-sm">
            C
          </div>
          <div>
            <h1 class="text-lg font-semibold">Codecan</h1>
            <p class="text-xs text-gray-500 dark:text-gray-500">Cut the clutter. Keep the logic.</p>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <span class="rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium tabular-nums dark:bg-gray-800">
            {totalResults} {totalResults === 1 ? "issue" : "issues"}
          </span>
          <span class="rounded-md bg-amber-100 px-2.5 py-1 text-xs font-medium tabular-nums text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" title="Session credits for cloud AI scans. Resets on app restart.">
            {credits}/60 credits
          </span>
          {#if totalTokens > 0}
            <span class="rounded-md bg-purple-100 px-2.5 py-1 text-xs font-medium tabular-nums text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
              {totalTokens.toLocaleString()} tokens
            </span>
          {/if}
          <button
            onclick={async () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}
            class="rounded-lg p-2 text-gray-500 hover:bg-gray-100 transition-colors dark:hover:bg-gray-800"
            aria-label="Toggle fullscreen"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
          <button
            onclick={() => darkMode = !darkMode}
            class="rounded-lg p-2 text-gray-500 hover:bg-gray-100 transition-colors dark:hover:bg-gray-800"
            aria-label="Toggle dark mode"
          >
            {#if darkMode}
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            {:else}
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            {/if}
          </button>
        </div>
      </div>

      <!-- Input Card -->
      <div class="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-4 transition-colors dark:border-gray-800 dark:bg-gray-900">
        <div class="flex flex-wrap gap-2 mb-3">
          <div class="relative flex-1 min-w-[200px]">
            <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <input
              type="text"
              bind:value={selectedDirectory}
              disabled={isScanActive}
              placeholder="Select a folder or enter a path..."
              class="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:focus:border-blue-400"
            />
          </div>
          <button onclick={pickFolder} disabled={isScanActive} class="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-gray-800">
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            Folder
          </button>
          <button onclick={pickFile} disabled={isScanActive} class="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-gray-800">
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            File
          </button>
        </div>
        <div class="flex gap-2">
          <button
            onclick={runScan}
            disabled={busy || isScanning || isAIScanning || !selectedDirectory}
            class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:pointer-events-none disabled:opacity-50"
          >
            {#if isScanning || isAIScanning}
              <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Scanning...
            {:else}
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              Scan
            {/if}
          </button>
          {#if isScanActive}
            <button
              onclick={stopScan}
              class="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Stop
              <span class="tabular-nums">{elapsedDisplay}</span>
            </button>
          {:else}
            <button
              onclick={runAIScan}
              disabled={busy || isScanning || isAIScanning || !selectedDirectory || (isLocalModel ? !modelAvailable : (!activeApiKey() || !isOnline || credits <= 0))}
              class="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:pointer-events-none disabled:opacity-50 {isLocalModel ? (modelAvailable ? 'bg-green-600 hover:bg-green-500' : 'bg-gray-400') : 'bg-green-600 hover:bg-green-500'}"
              title={isLocalModel ? (modelAvailable ? 'Scan with local AI' : 'Download model first') : (activeApiKey() ? 'Scan with cloud AI' : 'Add an API key first')}
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Scan with AI
            </button>
          {/if}
          <button
            onclick={scanCurrentProject}
            disabled={busy || isScanning || isAIScanning}
            class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-gray-800 disabled:pointer-events-none disabled:opacity-50"
          >
            Scan This Project
          </button>
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <!-- Model selector -->
          <select
            bind:value={selectedModelId}
            disabled={isScanActive}
            class="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-600"
          >
            {#each AI_MODELS as model}
              <option value={model.id}>{model.name}</option>
            {/each}
          </select>

          {#if isLocalModel}
            {#if modelAvailable}
              <span class="text-gray-400 dark:text-gray-500">Model ready ({modelSizeMb} MB)</span>
            {:else}
              <button
                onclick={downloadModel}
                disabled={busy || isDownloadingModel}
                class="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-50"
              >
                {isDownloadingModel ? 'Downloading... (~350 MB)' : 'Download Qwen2.5-0.5B Model'}
              </button>
            {/if}
          {:else}
            <!-- API key selector -->
            <div class="flex flex-wrap items-center gap-2">
              {#if apiKeys.length > 0}
                <select
                  bind:value={activeKeyId}
                  disabled={isScanActive}
                  class="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-600"
                >
                  <option value="">-- Select key --</option>
                  {#each apiKeys as k}
                    <option value={k.id}>{k.name}{k.predefined ? ' (predefined)' : ''}</option>
                  {/each}
                </select>
              {:else}
                <span class="text-xs text-amber-600 dark:text-amber-400">No API keys configured.</span>
              {/if}
              <button
                onclick={() => showAddKey = !showAddKey}
                disabled={isScanActive}
                class="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                {showAddKey ? 'Cancel' : '+ Add Key'}
              </button>
              {#if activeKeyId && !apiKeys.find(k => k.id === activeKeyId)?.predefined}
                <button
                  onclick={removeActiveKey}
                  disabled={isScanActive}
                  class="rounded bg-red-500 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  Remove
                </button>
              {/if}
            </div>
            {#if showAddKey}
              <div class="mt-2 space-y-1.5">
                <div class="flex gap-1.5">
                  <input
                    bind:value={newKeyName}
                    placeholder="Label (e.g. My HF Key)"
                    disabled={isScanActive}
                    class="min-w-0 flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950"
                  />
                  <input
                    bind:value={newKeyValue}
                    placeholder="hf_abc123..."
                    disabled={isScanActive}
                    class="min-w-0 flex-[2] rounded border border-gray-300 bg-white px-2 py-1 text-xs disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950"
                  />
                  <button
                    onclick={addApiKey}
                    disabled={!newKeyName || !newKeyValue || isScanActive}
                    class="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
                <div class="flex gap-3 text-xs text-gray-400 dark:text-gray-500">
                  <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener noreferrer" class="underline hover:text-blue-500">Get HF token</a>
                  <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" class="underline hover:text-blue-500">Get OpenRouter key</a>
                </div>
              </div>
            {/if}
          {/if}
        </div>
      </div>

      {#if error}
        <div class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      {/if}

      {#if isScanActive}
        <div class="flex justify-center py-20">
          <div class="text-center">
            <svg class="mx-auto mb-3 h-8 w-8 animate-spin {aiMode ? 'text-green-600' : 'text-blue-600'}" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p class="text-sm text-gray-500">{scanStatus || (aiMode ? 'AI is analyzing code...' : 'Scanning code...')}</p>
            <p class="mt-1 text-xs tabular-nums text-gray-400 font-mono">{elapsedDisplay}</p>
          </div>
        </div>

      {:else if scanResults.length > 0 || selectedDirectory}
        <div class="space-y-3">
          {#each categories as cat}
            {@const items = itemsByType(cat.type)}
            {@const expanded = expandedCategories.has(cat.type)}
            <div class="rounded-xl border border-gray-200 overflow-hidden transition-colors dark:border-gray-800">
              <button
                onclick={() => toggleCategory(cat.type)}
                class="flex w-full items-center justify-between bg-gray-50 px-4 py-3 border-b border-gray-200 transition-colors hover:bg-gray-100 dark:bg-gray-900 dark:border-gray-800 dark:hover:bg-gray-800/80"
              >
                <div class="flex items-center gap-2">
                  <span class="text-base">{cat.icon}</span>
                  <span class="text-sm font-medium">{cat.label}</span>
                  <span class="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium tabular-nums dark:bg-gray-800">
                    {items.length}
                  </span>
                </div>
                <svg
                  class="h-4 w-4 text-gray-400 transition-transform {expanded ? 'rotate-180' : ''}"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {#if expanded}
                {#if items.length === 0}
                  <div class="px-4 py-4 text-sm text-gray-500 italic">
                    {cat.emptyMsg}
                  </div>
                {:else}
                  <div class="divide-y divide-gray-100 dark:divide-gray-800/50">
                    {#each items as result}
                      <div class="px-4 py-3 hover:bg-gray-50 transition-colors dark:hover:bg-gray-900/50">
                        <div class="flex items-start gap-2.5">
                          <span class="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium {severityClass(result.severity)} shrink-0 mt-0.5">
                            {result.severity}
                          </span>
                          <div class="min-w-0 flex-1">
                            <p class="text-sm">{result.message}</p>
                            <p class="mt-0.5 text-xs text-gray-500 font-mono">
                              {result.file}{#if result.line}:{result.line}{/if}
                            </p>
                            {#if result.codeSnippet}
                              <pre class="mt-2 overflow-x-auto rounded-lg border border-gray-200 bg-gray-100 p-2.5 text-xs leading-relaxed dark:border-gray-800 dark:bg-gray-950"><code>{result.codeSnippet}</code></pre>
                            {/if}
                          </div>
                        </div>
                      </div>
                    {/each}
                  </div>
                {/if}
              {/if}
            </div>
          {/each}
        </div>

      {:else}
        <div class="flex flex-col items-center justify-center py-24">
          <svg class="mb-4 h-8 w-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
          <p class="text-sm text-gray-400">Select a folder or file to scan for issues</p>
        </div>
      {/if}
    </div>

    <!-- Floating demo button -->
    <button
      onclick={() => showDemo = !showDemo}
      class="fixed bottom-6 right-48 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-lg transition-colors hover:bg-gray-100 hover:text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
      aria-label="Demo"
    >
      <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </button>

    <!-- Floating docs button -->
    <button
      onclick={() => showDocs = !showDocs}
      class="fixed bottom-6 right-34 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-lg transition-colors hover:bg-gray-100 hover:text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
      aria-label="Documentation"
    >
      <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    </button>

    <!-- Floating log button -->
    <button
      onclick={() => showLog = !showLog}
      class="fixed bottom-6 right-20 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-lg transition-colors hover:bg-gray-100 hover:text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
      aria-label="Log"
    >
      <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
      </svg>
      {#if logEntries.length > 0}
        <span class="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">{logEntries.length > 99 ? "99+" : logEntries.length}</span>
      {/if}
    </button>

    <!-- Floating help button -->
    <button
      onclick={() => showHelp = !showHelp}
      class="fixed bottom-6 right-6 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-lg transition-colors hover:bg-gray-100 hover:text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
      aria-label="Help"
    >
      <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M12 17.75v.007" />
      </svg>
    </button>

    <!-- Log drawer -->
    {#if showLog}
      <div
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-label="Scan Log"
        class="fixed inset-0 z-40"
        onclick={(e) => e.target === e.currentTarget && (showLog = false)}
        onkeydown={(e) => e.key === 'Escape' && (showLog = false)}
      >
        <div class="fixed inset-0 bg-black/30"></div>
        <div class="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-2xl dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 flex flex-col">
          <div class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">Scan Log ({logEntries.length})</h2>
            <button
              onclick={() => showLog = false}
              class="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              aria-label="Close"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class="flex-1 overflow-y-auto p-3 space-y-2">
            {#if logEntries.length === 0}
              <p class="text-sm text-gray-400 text-center py-8">No log entries yet.</p>
            {:else}
              {#each logEntries as entry}
                <div class="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-950">
                  <div class="flex items-start gap-2">
                    <span class="shrink-0 mt-0.5 text-xs text-gray-400 font-mono tabular-nums">{entry.time}</span>
                    <span class="shrink-0 mt-0.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide {entry.type === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : entry.type === 'warning' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}">{entry.type}</span>
                    <p class="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{entry.message}</p>
                  </div>
                </div>
              {/each}
            {/if}
          </div>
          {#if logEntries.length > 0}
            <div class="border-t border-gray-200 px-4 py-2 dark:border-gray-700">
              <button
                onclick={() => logEntries = []}
                class="text-xs text-gray-500 hover:text-red-500 transition-colors"
              >
                Clear log
              </button>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Docs modal -->
    {#if showDocs}
      <div
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-label="Documentation"
        class="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
        onclick={(e) => e.target === e.currentTarget && (showDocs = false)}
        onkeydown={(e) => e.key === 'Escape' && (showDocs = false)}
      >
        <div
          class="w-full max-w-2xl max-h-[85vh] rounded-xl border border-gray-200 bg-white shadow-2xl transition-colors dark:border-gray-700 dark:bg-gray-900 flex flex-col"
        >
          <div class="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
            <h2 class="text-base font-semibold text-gray-900 dark:text-gray-100">Documentation</h2>
            <button
              onclick={() => showDocs = false}
              class="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              aria-label="Close"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class="overflow-y-auto p-6 space-y-5 text-sm text-gray-600 dark:text-gray-300">
            <section>
              <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1.5">What is Codecan?</h3>
              <p>Codecan is a desktop application that scans source code repositories for quality issues. It helps you find duplicate code, unused imports, redundant patterns, architecture violations, and risky dependencies — with optional AI-powered analysis for deeper insights.</p>
            </section>

            <section>
              <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1.5">Scan Types</h3>
              <div class="space-y-2">
                <div>
                  <span class="font-medium text-gray-900 dark:text-gray-100">Rule-based Scan</span>
                  <p class="text-xs mt-0.5">Works offline with no API key needed. Detects duplicate CSS rules, unused JS/TS/Rust imports, redundant code (deep nesting, long params), component architecture violations (dumb components with smart logic), file size issues, and dependency risks (deprecated/malicious npm packages, unpinned versions, typosquatting).</p>
                </div>
                <div>
                  <span class="font-medium text-gray-900 dark:text-gray-100">Cloud AI Scan</span>
                  <p class="text-xs mt-0.5">Uses OpenRouter or Hugging Face models to analyze code with natural language understanding. Requires an API key and internet connection. Supports 8 cloud models including Llama 3.3 70B, Gemma 4, Qwen2.5-Coder, and StarCoder2. 60 session credits included — 1 credit per scan, resets on app restart.</p>
                </div>
                <div>
                  <span class="font-medium text-gray-900 dark:text-gray-100">Local AI Scan</span>
                  <p class="text-xs mt-0.5">Runs a Qwen2.5-0.5B GGUF model (~350 MB) on your machine via llama.cpp. No internet or API key needed after download. Free to use with no credit cost. Best for privacy or offline use.</p>
                </div>
              </div>
            </section>

            <section>
              <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1.5">How to Use</h3>
              <ol class="list-decimal list-inside space-y-1 text-xs">
                <li>Select a folder or file using the text input or Browse buttons</li>
                <li>Click <strong>Scan</strong> for rule-based analysis, or select an AI model and click <strong>Scan with AI</strong></li>
                <li>For AI scans: add an API key (click "+ Add Key" under API Keys section)</li>
                <li>For local AI: click "Download Model" to download Qwen2.5-0.5B (~350 MB)</li>
                <li>View results grouped by category. Click a category to expand and see details</li>
                <li>Use the log drawer (floating button, bottom-right) to review scan messages</li>
              </ol>
            </section>

            <section>
              <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1.5">Supported File Types</h3>
              <p class="text-xs">JavaScript (.js, .jsx, .mjs), TypeScript (.ts, .tsx), Svelte (.svelte), Rust (.rs), CSS (.css), HTML (.html), JSON (.json), TOML (.toml).</p>
            </section>

            <section>
              <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1.5">API Keys</h3>
              <p class="text-xs">Codecan loads keys from multiple sources (in priority order):</p>
              <ol class="list-decimal list-inside text-xs mt-1 space-y-0.5">
                <li>Environment variables: <code class="text-blue-600 dark:text-blue-400">HF_API_KEY</code> and <code class="text-blue-600 dark:text-blue-400">OPENROUTER_API_KEY</code></li>
                <li>Config file path in <code class="text-blue-600 dark:text-blue-400">CODECAN_CONFIG</code> env var</li>
                <li><code class="text-blue-600 dark:text-blue-400">~/.codecan.json</code> in your home directory</li>
                <li><code class="text-blue-600 dark:text-blue-400">.codecan.json</code> in the project directory (auto-discovered by walking up)</li>
                <li>User-entered keys via the UI (stored in localStorage)</li>
              </ol>
              <p class="text-xs mt-1">Format: <code class="text-blue-600 dark:text-blue-400">{'{'}{" "}"apiKeys": [{'{'}{" "}"name": "...", "key": "..." }] }</code></p>
            </section>

            <section>
              <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1.5">Credits</h3>
              <p class="text-xs">Each session starts with <strong>60 credits</strong>. Cloud AI scans cost 1 credit each. Credits reset when the app is restarted. Local AI scans are free and do not consume credits.</p>
            </section>

            <section>
              <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1.5">CLI Usage</h3>
              <p class="text-xs">You can also run scans from the terminal:</p>
              <pre class="mt-1 rounded-lg border border-gray-200 bg-gray-100 p-2.5 text-xs dark:border-gray-800 dark:bg-gray-950"><code>npm run analyze            # Scan current directory (console)
npm run analyze:json       # Scan current directory (JSON)
npx tsx src/index.ts scan /path  # Scan specific path</code></pre>
            </section>

            <section>
              <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1.5">Tips</h3>
              <ul class="list-disc list-inside text-xs space-y-1">
                <li>Use the log drawer to track AI scan progress and debug errors</li>
                <li>OpenRouter free models may be rate-limited. Try a different model if one fails</li>
                <li>Local model is best for offline use but slower than cloud models</li>
                <li>Credits reset on restart — close and reopen the app to get a fresh 60</li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    {/if}

    <!-- Demo video modal -->
    {#if showDemo}
      <div
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-label="Demo Video"
        class="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
        onclick={(e) => e.target === e.currentTarget && (showDemo = false)}
        onkeydown={(e) => e.key === 'Escape' && (showDemo = false)}
      >
        <div
          class="w-full max-w-3xl rounded-xl border border-gray-200 bg-white shadow-2xl transition-colors dark:border-gray-700 dark:bg-gray-900"
        >
          <div class="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
            <h2 class="text-base font-semibold text-gray-900 dark:text-gray-100">Demo</h2>
            <button
              onclick={() => showDemo = false}
              class="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              aria-label="Close"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class="p-4">
            <video
              src="/demo.mp4"
              controls
              class="w-full rounded-lg"
              poster="/demo.gif"
              onerror={(e) => {
                const v = e.target as HTMLVideoElement;
                v.style.display = 'none';
                v.insertAdjacentHTML('afterend', '<img src="/demo.gif" class="w-full rounded-lg" alt="Demo animation" style="display:block" />');
              }}
            >
              <track kind="captions" src="" label="No captions" />
              <img src="/demo.gif" class="w-full rounded-lg" alt="Demo animation" />
            </video>
            <p class="mt-3 text-xs text-gray-400 text-center">A quick walkthrough of Codecan's key features.</p>
          </div>
        </div>
      </div>
    {/if}

    <!-- Help modal -->
    {#if showHelp}
      <div
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-label="About Codecan"
        class="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
        onclick={(e) => e.target === e.currentTarget && (showHelp = false)}
        onkeydown={(e) => e.key === 'Escape' && (showHelp = false)}
      >
        <div
          class="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-2xl transition-colors dark:border-gray-700 dark:bg-gray-900"
        >
          <div class="mb-4 flex items-center justify-between">
            <h2 class="text-base font-semibold text-gray-900 dark:text-gray-100">About Codecan</h2>
            <button
              onclick={() => showHelp = false}
              class="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              aria-label="Close"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="space-y-2 text-sm text-gray-600 dark:text-gray-300">
            <div class="flex gap-2">
              <span class="w-24 shrink-0 font-medium text-gray-500 dark:text-gray-400">Project</span>
              <span>Codecan</span>
            </div>
            <div class="flex gap-2">
              <span class="w-24 shrink-0 font-medium text-gray-500 dark:text-gray-400">Version</span>
              <span>0.1.0</span>
            </div>
            <div class="flex gap-2">
              <span class="w-24 shrink-0 font-medium text-gray-500 dark:text-gray-400">Author</span>
              <span>Aquib Shahbaz</span>
            </div>
            <div class="flex gap-2">
              <span class="w-24 shrink-0 font-medium text-gray-500 dark:text-gray-400">Description</span>
              <span>A code scanning application to detect vulnerabilities in source code, and find deprecated patterns.</span>
            </div>
          </div>

          <div class="mt-4 border-t border-gray-100 pt-3 dark:border-gray-800">
            <p class="text-xs text-gray-400 dark:text-gray-500">Scans for duplicate code, unused imports, redundant patterns, component architecture violations, dependency issues, and AI-powered code analysis.</p>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>