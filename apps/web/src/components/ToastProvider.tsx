import { AnimatePresence, motion } from "framer-motion";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

type ToastVariant = "success" | "error" | "info";

interface ToastPayload {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

function toastClassByVariant(variant: ToastVariant): string {
  if (variant === "success") {
    return "border-emerald-300/70 bg-emerald-50 text-emerald-800";
  }
  if (variant === "error") {
    return "border-red-300/70 bg-red-50 text-red-800";
  }
  return "border-sky-300/70 bg-sky-50 text-sky-800";
}

export function ToastProvider({ children }: PropsWithChildren) {
  const [toast, setToast] = useState<ToastPayload | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const showToast = useCallback((message: string, variant: ToastVariant = "info") => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }

    setToast({
      id: Date.now(),
      message,
      variant,
    });

    timeoutRef.current = window.setTimeout(() => {
      setToast(null);
    }, 2200);
  }, []);

  const contextValue = useMemo<ToastContextValue>(
    () => ({
      showToast,
    }),
    [showToast],
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[120]">
        <AnimatePresence>
          {toast ? (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className={[
                "rounded-xl border px-3 py-2 text-xs font-semibold shadow-card backdrop-blur-sm",
                toastClassByVariant(toast.variant),
              ].join(" ")}
              role="status"
              aria-live="polite"
            >
              {toast.message}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
