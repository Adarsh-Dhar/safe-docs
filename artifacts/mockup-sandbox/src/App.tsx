import { useEffect, useState, type ComponentType } from "react";

import { modules as discoveredModules } from "./.generated/mockup-components";

type ModuleMap = Record<string, () => Promise<Record<string, unknown>>>;

function _resolveComponent(
  mod: Record<string, unknown>,
  name: string,
): ComponentType | undefined {
  const fns = Object.values(mod).filter(
    (v) => typeof v === "function",
  ) as ComponentType[];
  return (
    (mod.default as ComponentType) ||
    (mod.Preview as ComponentType) ||
    (mod[name] as ComponentType) ||
    fns[fns.length - 1]
  );
}

function PreviewRenderer({
  componentPath,
  modules,
}: {
  componentPath: string;
  modules: ModuleMap;
}) {
  const [Component, setComponent] = useState<ComponentType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setComponent(null);
    setError(null);

    async function loadComponent(): Promise<void> {
      const key = `./components/mockups/${componentPath}.tsx`;
      const loader = modules[key];
      if (!loader) {
        setError(`No component found at ${componentPath}.tsx`);
        return;
      }

      try {
        const mod = await loader();
        if (cancelled) {
          return;
        }
        const name = componentPath.split("/").pop()!;
        const comp = _resolveComponent(mod, name);
        if (!comp) {
          setError(
            `No exported React component found in ${componentPath}.tsx\n\nMake sure the file has at least one exported function component.`,
          );
          return;
        }
        setComponent(() => comp);
      } catch (e) {
        if (cancelled) {
          return;
        }

        const message = e instanceof Error ? e.message : String(e);
        setError(`Failed to load preview.\n${message}`);
      }
    }

    void loadComponent();

    return () => {
      cancelled = true;
    };
  }, [componentPath, modules]);

  if (error) {
    return (
      <pre style={{ color: "red", padding: "2rem", fontFamily: "system-ui" }}>
        {error}
      </pre>
    );
  }

  if (!Component) return null;

  return <Component />;
}

function getBasePath(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "");
}

function getPreviewExamplePath(): string {
  const basePath = getBasePath();
  return `${basePath}/preview/ComponentName`;
}

function getAvailablePreviewPaths(modules: ModuleMap): string[] {
  return Object.keys(modules)
    .filter((k) => k.startsWith("./components/mockups/") && k.endsWith(".tsx"))
    .map((k) => k.replace("./components/mockups/", "").replace(/\.tsx$/, ""))
    .sort();
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 1500,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function discoverApiBase(): Promise<string | null> {
  const hostCandidates = Array.from(new Set([
    window.location.hostname || "localhost",
    "127.0.0.1",
    "localhost",
  ]));

  const ports = Array.from({ length: 11 }, (_, i) => 5000 + i);

  for (const host of hostCandidates) {
    for (const port of ports) {
      try {
        const base = `http://${host}:${port}`;
        const res = await fetchWithTimeout(`${base}/api/health`, {}, 1200);
        if (res.ok) {
          return base;
        }
      } catch {
        // Try next candidate
      }
    }
  }

  return null;
}

function statusTextFor(value: unknown, ok: string, fail: string): string {
  return value === "ok" || value === "loaded" ? ok : fail;
}

function SafeLeakHome() {
  const [apiBase, setApiBase] = useState<string | null>(null);
  const [walrusStatus, setWalrusStatus] = useState("checking...");
  const [githubModelsStatus, setGithubModelsStatus] = useState("checking...");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHealth(): Promise<void> {
      const base = await discoverApiBase();
      if (cancelled) {
        return;
      }

      if (!base) {
        setWalrusStatus("offline");
        setGithubModelsStatus("unavailable");
        setMessage("Backend not found. Start run.sh first.");
        return;
      }

      setApiBase(base);

      try {
        const healthRes = await fetchWithTimeout(`${base}/api/health`, {}, 1500);
        if (!healthRes.ok) {
          setWalrusStatus("offline");
          setGithubModelsStatus("unavailable");
          return;
        }

        const health = (await healthRes.json()) as {
          walrus?: unknown;
          gemini?: unknown;
        };

        setWalrusStatus(statusTextFor(health.walrus, "online", "offline"));
        setGithubModelsStatus(statusTextFor(health.gemini, "available", "unavailable"));
      } catch {
        setWalrusStatus("offline");
        setGithubModelsStatus("unavailable");
      }
    }

    void loadHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onScrub(): Promise<void> {
    if (!selectedFile || !apiBase) {
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const form = new FormData();
      form.append("document", selectedFile);

      const res = await fetch(`${apiBase}/api/scrub`, {
        method: "POST",
        body: form,
      });

      const payload = (await res.json()) as {
        status?: string;
        error?: string;
        walrus_blob_id?: string | null;
      };

      if (!res.ok || payload.status !== "success") {
        setMessage(`Error: ${payload.error ?? "Scrub failed"}`);
        return;
      }

      if (payload.walrus_blob_id) {
        setMessage(`Success. Walrus blob: ${payload.walrus_blob_id}`);
      } else {
        setMessage("Success. Scrub completed.");
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setMessage(`Error: ${detail}`);
    } finally {
      setBusy(false);
    }
  }

  const previews = getAvailablePreviewPaths(discoveredModules);
  const basePath = getBasePath();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="text-3xl font-bold">🛡️ SafeLeak</div>
          <p className="text-slate-400 text-sm mt-2">
            // autonomous document metadata scrubber + decentralised storage
          </p>
          <div className="flex flex-wrap justify-center gap-2 mt-4 text-xs">
            <span className="px-2 py-1 rounded border border-emerald-400/40 bg-emerald-500/10 text-emerald-300">
              PRESIDIO AI
            </span>
            <span className="px-2 py-1 rounded border border-blue-400/40 bg-blue-500/10 text-blue-300">
              WALRUS TESTNET
            </span>
            <span className="px-2 py-1 rounded border border-violet-400/40 bg-violet-500/10 text-violet-300">
              SUI OVERFLOW 2026
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 mb-6 space-y-2 text-sm">
          <div>
            <span className="text-emerald-300">● Walrus:</span>{" "}
            <span className="text-slate-200">{walrusStatus}</span>
          </div>
          <div>
            <span className="text-amber-300">⚠ GitHub Models (gpt-4o):</span>{" "}
            <span className="text-slate-200">{githubModelsStatus}</span>
          </div>
          <p className="text-xs text-slate-500">
            Backend: {apiBase ?? 'not found — try hard-refresh (Cmd/Ctrl+Shift+R) or open the frontend URL shown by run.sh'}
          </p>
        </div>

        <div className="rounded-2xl border-2 border-dashed border-slate-700 bg-slate-900/70 p-8 text-center">
          <div className="text-4xl mb-3">📄</div>
          <label className="cursor-pointer block">
            <span className="text-lg font-medium">Drop document here or click to upload</span>
            <input
              type="file"
              className="hidden"
              accept=".pdf,.docx,.txt,.jpg,.jpeg,.png"
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <p className="text-slate-400 text-sm mt-2">Max 10 MB per file</p>
          <div className="flex flex-wrap justify-center gap-2 mt-4 text-xs text-slate-300">
            {[
              "PDF",
              "DOCX",
              "TXT",
              "JPG",
            ].map((fmt) => (
              <span key={fmt} className="px-2 py-1 rounded bg-slate-800 border border-slate-700">
                {fmt}
              </span>
            ))}
          </div>

          {selectedFile ? (
            <div className="mt-5 text-sm text-slate-300">
              Selected: {selectedFile.name} ({Math.ceil(selectedFile.size / 1024)} KB)
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => void onScrub()}
            disabled={!selectedFile || !apiBase || busy}
            className="mt-6 px-4 py-2 rounded-md bg-emerald-500 text-slate-950 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "Scrubbing..." : "Scrub + Upload"}
          </button>

          {message ? (
            <p className="mt-4 text-sm text-slate-200">{message}</p>
          ) : null}
        </div>

        <div className="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">
            Component Preview Server
          </p>
          <p className="text-sm text-slate-400 mb-3">
            Access component previews at {getPreviewExamplePath()}
          </p>
          <div className="flex flex-wrap gap-2">
            {previews.length > 0 ? (
              previews.map((name) => (
                <a
                  key={name}
                  href={`${basePath}/preview/${name}`}
                  className="text-blue-300 underline text-sm"
                >
                  /preview/{name}
                </a>
              ))
            ) : (
              <span className="text-sm text-slate-500">No extra preview components found.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function getPreviewPath(): string | null {
  const basePath = getBasePath();
  const { pathname } = window.location;
  const local =
    basePath && pathname.startsWith(basePath)
      ? pathname.slice(basePath.length) || "/"
      : pathname;
  const match = local.match(/^\/preview\/(.+)$/);
  return match ? match[1] : null;
}

function App() {
  const previewPath = getPreviewPath();

  if (previewPath) {
    return (
      <PreviewRenderer
        componentPath={previewPath}
        modules={discoveredModules}
      />
    );
  }

  return <SafeLeakHome />;
}

export default App;
