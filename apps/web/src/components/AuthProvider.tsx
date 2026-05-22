import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { apiRequest } from "../lib/api";
import { clearAuthToken, getAuthToken, setAuthToken } from "../lib/auth-storage";
import type { User } from "../lib/types";

interface AuthContextValue {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  setSession: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [token, setToken] = useState<string | null>(() => getAuthToken());
  const [user, setUser] = useState<User | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    async function bootstrap() {
      try {
        let nextToken = token;
        let nextUser = user;

        // Capture OAuth callback token from URL before creating guest account
        if (!nextToken && typeof window !== "undefined") {
          const params = new URLSearchParams(window.location.search);
          const urlToken = params.get("token");
          if (urlToken) {
            setAuthToken(urlToken);
            window.history.replaceState({}, "", window.location.pathname);
            nextToken = urlToken;
          }
        }

        if (!nextToken) {
          const deviceId =
            (typeof window !== "undefined" &&
              (window.localStorage.getItem("zerofans.deviceId") ||
                crypto.randomUUID())) ||
            crypto.randomUUID();

          if (typeof window !== "undefined") {
            window.localStorage.setItem("zerofans.deviceId", deviceId);
          }

          const response = await apiRequest<{ token: string; user: User }>("/api/auth/guest", {
            method: "POST",
            body: { deviceId },
          });

          nextToken = response.token;
          nextUser = response.user;
          setAuthToken(nextToken);
        }

        if (nextToken && !nextUser) {
          const me = await apiRequest<{ user: User }>("/api/auth/me", { token: nextToken });
          nextUser = me.user;
        }

        setToken(nextToken ?? null);
        setUser(nextUser ?? null);
      } catch {
        setToken(null);
        setUser(null);
        clearAuthToken();
      } finally {
        setInitialized(true);
      }
    }

    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      isAuthenticated: Boolean(token && user),
      setSession: (nextToken: string) => {
        setAuthToken(nextToken);
        setToken(nextToken);
      },
      logout: () => {
        clearAuthToken();
        setToken(null);
        setUser(null);
      },
    }),
    [token, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
