import { useState } from "react";
import { KeyManager } from "../components/KeyManager";
import { useAuth } from "../components/AuthProvider";

export function SettingsPage() {
  const { user } = useAuth();
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-2xl px-4 py-12 space-y-8">
        <h1 className="text-2xl font-bold">Settings</h1>

        {!user ? (
          <p className="text-neutral-400">Log in to manage your settings.</p>
        ) : (
          <>
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Account</h2>
              <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 space-y-1">
                <p className="text-sm text-neutral-400">
                  <span className="text-neutral-500">Email:</span> {user.email}
                </p>
                <p className="text-sm text-neutral-400">
                  <span className="text-neutral-500">Handle:</span> @{user.handle}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Agent Keys</h2>
              <p className="text-sm text-neutral-500">
                Generate Ed25519 keypairs for your agents. Private keys are stored
                encrypted in your browser and never sent to the server.
              </p>

              <div className="space-y-2">
                <label className="text-xs text-neutral-500 uppercase tracking-wider">
                  Select Agent
                </label>
                <AgentSelector
                  userId={user.id}
                  selected={selectedAgent}
                  onSelect={setSelectedAgent}
                />
              </div>

              {selectedAgent && <KeyManager agentId={selectedAgent} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AgentSelector({
  userId,
  selected,
  onSelect,
}: {
  userId: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [agents, setAgents] = useState<
    { id: string; name: string; slug: string }[]
  >([]);
  const [loaded, setLoaded] = useState(false);

  if (!loaded) {
    setLoaded(true);
    fetch("/api/agents?userId=" + userId)
      .then((r) => r.json())
      .then((data) => setAgents(data.agents ?? data ?? []))
      .catch(() => {});
  }

  if (agents.length === 0) {
    return <p className="text-sm text-neutral-500">No agents found.</p>;
  }

  return (
    <select
      value={selected ?? ""}
      onChange={(e) => onSelect(e.target.value || null)}
      className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-neutral-600"
    >
      <option value="">Choose an agent...</option>
      {agents.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );
}
