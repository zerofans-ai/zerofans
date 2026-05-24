import { useState, useRef } from "react";
import { useKeypair } from "../hooks/useKeypair";
import { apiRequest } from "../lib/api";

interface KeyManagerProps {
  agentId: string;
}

export function KeyManager({ agentId }: KeyManagerProps) {
  const keys = useKeypair(agentId);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const showStatus = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), 4000);
  };

  const handleGenerate = async () => {
    if (!password || password.length < 6) {
      showStatus("Password must be at least 6 characters");
      return;
    }
    try {
      const pubKey = await keys.generate(password);
      if (pubKey) {
        // Upload public key to server
        await apiRequest(`/api/agents/${agentId}`, {
          method: "PATCH",
          body: { publicKey: pubKey },
        });
        showStatus("Keypair generated and public key uploaded");
      }
    } catch (err) {
      showStatus(`Error: ${err instanceof Error ? err.message : "Failed"}`);
    }
  };

  const handleUnlock = async () => {
    if (!password) {
      showStatus("Enter your password to unlock");
      return;
    }
    const ok = await keys.unlock(password);
    showStatus(ok ? "Keys unlocked" : "Wrong password or no keys found");
  };

  const handleExport = () => {
    const data = keys.doExport();
    if (!data) {
      showStatus("Unlock keys first to export");
      return;
    }
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `zerofans-keypair-${agentId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showStatus("Keypair exported");
  };

  const handleImport = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      showStatus("Select a keypair file");
      return;
    }
    if (!password || password.length < 6) {
      showStatus("Enter a password to encrypt the imported key");
      return;
    }
    try {
      const json = await file.text();
      const ok = await keys.doImport(json, password);
      showStatus(ok ? "Keypair imported" : "Invalid keypair file");
    } catch {
      showStatus("Failed to parse keypair file");
    }
  };

  const handleRemove = async () => {
    if (!confirm("Delete your local keypair? You won't be able to sign events or recover without a backup.")) return;
    await keys.remove();
    showStatus("Keypair deleted");
  };

  const copyKey = () => {
    if (keys.publicKey) {
      navigator.clipboard.writeText(keys.publicKey);
      showStatus("Public key copied");
    }
  };

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-6 space-y-4">
      <h3 className="text-lg font-semibold text-white">Ed25519 Keys</h3>

      {status && (
        <div className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-neutral-300">
          {status}
        </div>
      )}

      {keys.publicKey && (
        <div className="space-y-1">
          <label className="text-xs text-neutral-500 uppercase tracking-wider">
            Public Key
          </label>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-neutral-900 px-3 py-2 text-xs text-neutral-400 truncate">
              {keys.publicKey}
            </code>
            <button
              onClick={copyKey}
              className="rounded-lg bg-neutral-800 px-3 py-2 text-xs text-neutral-400 hover:text-white transition-colors"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            keys.isUnlocked
              ? "bg-green-500"
              : keys.hasKey
                ? "bg-yellow-500"
                : "bg-neutral-600"
          }`}
        />
        <span className="text-sm text-neutral-400">
          {keys.isUnlocked
            ? "Unlocked"
            : keys.hasKey
              ? "Locked"
              : "No keys"}
        </span>
      </div>

      <div className="space-y-2">
        <input
          type="password"
          placeholder="Password (min 6 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-neutral-600"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {!keys.hasKey && (
          <button
            onClick={handleGenerate}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            Generate New Key
          </button>
        )}

        {keys.hasKey && !keys.isUnlocked && (
          <button
            onClick={handleUnlock}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
          >
            Unlock
          </button>
        )}

        {keys.isUnlocked && (
          <>
            <button
              onClick={keys.lock}
              className="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-300 hover:text-white transition-colors"
            >
              Lock
            </button>
            <button
              onClick={handleExport}
              className="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-300 hover:text-white transition-colors"
            >
              Export
            </button>
          </>
        )}

        {keys.hasKey && (
          <button
            onClick={handleRemove}
            className="rounded-lg bg-red-900/50 px-4 py-2 text-sm font-medium text-red-400 hover:text-red-300 transition-colors"
          >
            Delete
          </button>
        )}
      </div>

      <div className="border-t border-neutral-800 pt-4 space-y-2">
        <p className="text-xs text-neutral-500 uppercase tracking-wider">
          Import Existing Key
        </p>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            className="text-sm text-neutral-400 file:mr-2 file:rounded-lg file:border-0 file:bg-neutral-800 file:px-3 file:py-1 file:text-xs file:text-neutral-300"
          />
          <button
            onClick={handleImport}
            className="rounded-lg bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:text-white transition-colors"
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
