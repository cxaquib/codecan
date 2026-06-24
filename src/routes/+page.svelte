<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";
  import { checkConnectivity } from "$lib/scanner/connectivity";
  import type { ScanResult } from "$lib/scanner/types";
  import { AI_MODELS } from "$lib/scanner/ai-scanner";

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
  let darkMode = $state(typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
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
    } catch (e) {
      error = `Scan failed: ${e}`;
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
    try {
      const { ensureLocalModel } = await import("$lib/scanner/ai-scanner");
      await ensureLocalModel();
      await checkModel();
    } catch (e) {
      error = `Model download failed: ${e}`;
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

  function addApiKey() {
    if (!newKeyName || !newKeyValue) return;
    const id = crypto.randomUUID();
    apiKeys = [...apiKeys, { id, name: newKeyName, key: newKeyValue }];
    activeKeyId = id;
    newKeyName = "";
    newKeyValue = "";
    showAddKey = false;
    localStorage.setItem("codecan-api-keys", JSON.stringify(apiKeys));
    localStorage.setItem("codecan-active-key", id);
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
      const stored = localStorage.getItem("codecan-api-keys");
      const userKeys: ApiKeyEntry[] = stored ? JSON.parse(stored) : [];
      const active = localStorage.getItem("codecan-active-key") || "";

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
    }
  }

  $effect(() => {
    const model = localStorage.getItem("codecan-selected-model");
    if (model) selectedModelId = model;
    const gen = ++keyGen;
    refreshApiKeys(selectedDirectory, gen);
  });

  $effect(() => {
    const userKeys = apiKeys.filter(k => !k.predefined);
    localStorage.setItem("codecan-api-keys", JSON.stringify(userKeys));
  });

  $effect(() => {
    if (activeKeyId) localStorage.setItem("codecan-active-key", activeKeyId);
  });

  $effect(() => {
    localStorage.setItem("codecan-selected-model", selectedModelId);
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
    busy = true;
    isAIScanning = true;
    aiMode = true;
    error = "";
    const modelName = AI_MODELS.find(m => m.id === selectedModelId)?.name || selectedModelId;
    scanStatus = isLocalModel ? "Running local AI model..." : `Querying ${modelName}...`;
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
            (msg) => { scanStatus = msg; if (msg.includes("ERROR") || msg.includes("error")) scanInfo = msg; },
            (count) => { totalTokens = count; }
          );
          scanResults = [...scanResults, ...results];
        } else {
          const { scanWithAI } = await import("$lib/scanner/ai-scanner");
          const results = await scanWithAI(
            files,
            selectedModelId,
            activeApiKey(),
            (msg) => { scanStatus = msg; if (msg.includes("ERROR") || msg.includes("error") || msg.includes("no issues")) scanInfo = msg; },
            (count) => { totalTokens = count; }
          );
          scanResults = [...scanResults, ...results];
        }
      }
    } catch (e) {
      error = `AI scan failed: ${e}`;
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
          {#if totalTokens > 0}
            <span class="rounded-md bg-purple-100 px-2.5 py-1 text-xs font-medium tabular-nums text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
              {totalTokens.toLocaleString()} tokens
            </span>
          {/if}
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
              disabled={busy || isScanning || isAIScanning || !selectedDirectory || (isLocalModel ? !modelAvailable : (!activeApiKey() || !isOnline))}
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
            <select
              bind:value={activeKeyId}
              disabled={isScanActive}
              class="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-600"
            >
              <option value="">-- No key selected --</option>
              {#each apiKeys as k}
                <option value={k.id}>{k.name}{k.predefined ? ' (env)' : ''}</option>
              {/each}
            </select>
            <button
              onclick={() => showAddKey = !showAddKey}
              disabled={isScanActive}
              class="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              {showAddKey ? 'Cancel' : '+ Add Key'}
            </button>
            {#if showAddKey}
              <input
                bind:value={newKeyName}
                placeholder="Label"
                disabled={isScanActive}
                class="w-20 rounded border border-gray-300 bg-white px-2 py-1 text-xs disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950"
              />
              <input
                bind:value={newKeyValue}
                placeholder="hf_..."
                disabled={isScanActive}
                class="w-44 rounded border border-gray-300 bg-white px-2 py-1 text-xs disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950"
              />
              <button
                onclick={addApiKey}
                disabled={!newKeyName || !newKeyValue || isScanActive}
                class="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
              >
                Save
              </button>
            {/if}
            {#if activeKeyId && !apiKeys.find(k => k.id === activeKeyId)?.predefined}
              <button
                onclick={removeActiveKey}
                disabled={isScanActive}
                class="text-red-500 hover:text-red-400 disabled:opacity-50"
              >
                Remove
              </button>
            {/if}
          {/if}
        </div>
      </div>

      {#if error}
        <div class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      {/if}

      {#if scanInfo}
        <div class="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          {scanInfo}
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