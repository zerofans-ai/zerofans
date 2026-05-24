import { useState, useCallback, useEffect } from "react";
import {
  generateKeypair,
  storeKeypair,
  loadPrivateKey,
  getPublicKey,
  hasKey,
  deleteKeypair,
  exportKeypair,
  parseImport,
  type Keypair,
} from "../lib/keys";

export interface KeypairState {
  hasKey: boolean;
  publicKey: string | null;
  isUnlocked: boolean;
  generate: (password: string) => Promise<string | null>; // returns public key
  unlock: (password: string) => Promise<boolean>;
  lock: () => void;
  remove: () => Promise<void>;
  doExport: () => string | null;
  doImport: (json: string, password: string) => Promise<boolean>;
}

export function useKeypair(agentId: string | null): KeypairState {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [keyExists, setKeyExists] = useState(false);

  useEffect(() => {
    if (!agentId) return;
    hasKey(agentId).then((exists) => {
      setKeyExists(exists);
      if (exists) {
        getPublicKey(agentId).then(setPublicKey);
      }
    });
  }, [agentId]);

  const generate = useCallback(
    async (password: string): Promise<string | null> => {
      if (!agentId) return null;
      const keypair = await generateKeypair();
      await storeKeypair(agentId, keypair, password);
      setPublicKey(keypair.publicKey);
      setPrivateKey(keypair.privateKey);
      setKeyExists(true);
      return keypair.publicKey;
    },
    [agentId],
  );

  const unlock = useCallback(
    async (password: string): Promise<boolean> => {
      if (!agentId) return false;
      const priv = await loadPrivateKey(agentId, password);
      if (!priv) return false;
      setPrivateKey(priv);
      return true;
    },
    [agentId],
  );

  const lock = useCallback(() => {
    setPrivateKey(null);
  }, []);

  const remove = useCallback(async () => {
    if (!agentId) return;
    await deleteKeypair(agentId);
    setPublicKey(null);
    setPrivateKey(null);
    setKeyExists(false);
  }, [agentId]);

  const doExport = useCallback((): string | null => {
    if (!privateKey || !publicKey) return null;
    return exportKeypair({ agentId: agentId ?? undefined, publicKey, privateKey });
  }, [agentId, publicKey, privateKey]);

  const doImport = useCallback(
    async (json: string, password: string): Promise<boolean> => {
      if (!agentId) return false;
      try {
        const keypair = parseImport(json);
        await storeKeypair(agentId, keypair, password);
        setPublicKey(keypair.publicKey);
        setPrivateKey(keypair.privateKey);
        setKeyExists(true);
        return true;
      } catch {
        return false;
      }
    },
    [agentId],
  );

  return {
    hasKey: keyExists,
    publicKey,
    isUnlocked: !!privateKey,
    generate,
    unlock,
    lock,
    remove,
    doExport,
    doImport,
  };
}
